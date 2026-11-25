import type { SiteLink } from '../site-links'
import { normalizeUrlForCompare } from '../urls'
import type { LinkCandidate, RelatedDraft } from './types'

/**
 * The pages a new blog could link to: the company's own site (its offerings,
 * its menu, its knowledge-base pages, its sitemap) and the identity's
 * published blogs. The planner picks a few of them; this only gathers and
 * cleans the list. Pure: ../ai/pipeline/blog-links.ts fetches the inputs.
 */

/** More than this and the planner reads a directory, not a choice. */
export const MAX_LINK_CANDIDATES = 60
const MAX_RELATED = 20
const MAX_TITLE = 120
const MAX_DESCRIPTION = 160

/** Path parts that mark a page nobody links to from an article. */
const NOT_CONTENT = new Set([
  'login',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'register',
  'account',
  'my-account',
  'cart',
  'basket',
  'checkout',
  'privacy',
  'privacy-policy',
  'terms',
  'terms-of-service',
  'terms-and-conditions',
  'cookie',
  'cookies',
  'cookie-policy',
  'legal',
  'imprint',
  'careers',
  'jobs',
  'wp-admin',
  'wp-login.php',
  'feed',
  'rss',
  'tag',
  'tags',
  'category',
  'categories',
  'author',
  'search',
  'cdn-cgi'
])

/** Link words that say nothing about the page. */
const GENERIC_LABELS = new Set([
  'click here',
  'learn more',
  'read more',
  'more',
  'here',
  'home'
])

const decodeEntities = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))

const locsIn = (xml: string, element: 'url' | 'sitemap') =>
  [...xml.matchAll(new RegExp(`<${element}\\b[^>]*>([\\s\\S]*?)</${element}>`, 'gi'))]
    .map(block => /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(block[1]!)?.[1] ?? '')
    .map(loc =>
      decodeEntities(loc.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')).trim()
    )
    .filter(loc => /^https?:\/\//i.test(loc))

/** A sitemap's pages, and the sitemaps a sitemap index points to. */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  return { urls: locsIn(xml, 'url'), sitemaps: locsIn(xml, 'sitemap') }
}

const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, '')

/**
 * A page of the company's own site worth linking to from an article: on its
 * host (with or without www), not a sign-in, cart, legal, archive or search
 * page, and a page rather than a file.
 */
export function isLinkablePage(url: string, ownHost: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (bareHost(parsed.hostname) !== bareHost(ownHost)) return false
  if (parsed.searchParams.has('s') || parsed.searchParams.has('q')) return false
  const parts = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map(part => decodeURIComponent(part).toLowerCase())
  if (parts.some(part => NOT_CONTENT.has(part))) return false
  const extension = /\.([a-z0-9]+)$/i.exec(parts[parts.length - 1] ?? '')?.[1]
  return !extension || ['html', 'htm', 'php'].includes(extension.toLowerCase())
}

/** A readable title from a page's address: its last path part, or its site. */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop()
    if (!last) return bareHost(parsed.hostname)
    const words = decodeURIComponent(last)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : bareHost(parsed.hostname)
  } catch {
    return url
  }
}

const tidy = (text: string | null | undefined, max: number) =>
  (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim()

const isHttp = (url: string | null | undefined): url is string =>
  Boolean(url && /^https?:\/\//i.test(url.trim()))

function hostOfWebsite(website: string | null): string | null {
  const raw = website?.trim()
  if (!raw) return null
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
}

export function buildLinkCandidates(input: {
  website: string | null
  homeLinks: SiteLink[]
  sitemapUrls: string[]
  offerings: Array<{ name: string; url: string | null; description?: string | null }>
  knowledgeDocs: Array<{ title: string; sourceUrl: string | null }>
  blogs: Array<{ id: string; title: string; status: string; publishedUrl: string | null }>
  currentBlogId: string
}): { candidates: LinkCandidate[]; related: RelatedDraft[] } {
  const host = hostOfWebsite(input.website)
  const candidates: Array<LinkCandidate & { fromPath: boolean }> = []
  const index = new Map<string, number>()

  const add = (
    url: string,
    label: string | null | undefined,
    kind: LinkCandidate['kind'],
    description?: string | null
  ) => {
    const named = tidy(label, MAX_TITLE)
    const fromPath = !named || GENERIC_LABELS.has(named.toLowerCase())
    const title = fromPath ? titleFromUrl(url) : named
    const key = normalizeUrlForCompare(url)
    const at = index.get(key)
    if (at !== undefined) {
      // The first place a page came from keeps its position; a real name
      // found later replaces one made from its address.
      const kept = candidates[at]!
      if (kept.fromPath && !fromPath) {
        candidates[at] = { ...kept, title, fromPath: false, ...(kind === 'blog' && { kind }) }
      }
      return
    }
    if (candidates.length >= MAX_LINK_CANDIDATES) return
    index.set(key, candidates.length)
    const about = tidy(description, MAX_DESCRIPTION)
    candidates.push({
      url: url.trim(),
      title,
      ...(about && { description: about }),
      kind,
      fromPath
    })
  }

  if (host) {
    for (const offering of input.offerings) {
      if (isHttp(offering.url) && isLinkablePage(offering.url.trim(), host)) {
        add(offering.url, offering.name, 'offering', offering.description)
      }
    }
    for (const link of input.homeLinks) {
      if (isLinkablePage(link.url, host)) {
        add(link.url, link.label, 'page', link.description)
      }
    }
    for (const doc of input.knowledgeDocs) {
      if (isHttp(doc.sourceUrl) && isLinkablePage(doc.sourceUrl.trim(), host)) {
        add(doc.sourceUrl, doc.title, 'page')
      }
    }
    for (const url of input.sitemapUrls) {
      if (isLinkablePage(url, host)) add(url, null, 'page')
    }
  }

  const related: RelatedDraft[] = []
  for (const blog of input.blogs) {
    if (blog.id === input.currentBlogId) continue
    const title = tidy(blog.title, MAX_TITLE)
    if (blog.status === 'published' && isHttp(blog.publishedUrl)) {
      add(blog.publishedUrl, title || null, 'blog')
    } else if (title && related.length < MAX_RELATED) {
      related.push({ blogId: blog.id, title })
    }
  }

  return {
    candidates: candidates.map(({ fromPath: _, ...candidate }) => candidate),
    related
  }
}
