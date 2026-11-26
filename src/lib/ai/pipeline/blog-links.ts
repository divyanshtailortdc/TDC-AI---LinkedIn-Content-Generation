import 'server-only'

import { db } from '@/db'
import { blogsTable } from '@/db/schema'
import { buildLinkCandidates, parseSitemap } from '@/lib/blogs/link-candidates'
import type { LinkCandidate, RelatedDraft } from '@/lib/blogs/types'
import { BROWSER_HEADERS } from '@/lib/scraper'
import { extractSiteLinks } from '@/lib/site-links'
import { eq } from 'drizzle-orm'
import type { GenerationContext } from '../context-blocks'

/**
 * The pages of the identity's site a blog could link to, read while the
 * research runs: its homepage's links, its sitemap (one child sitemap when
 * it is an index), its offerings and knowledge pages, and its published
 * blogs. Never fails: whatever cannot be read in time adds nothing.
 */

/** How long reading the site may take, all of it. */
export const LINK_CANDIDATES_TIMEOUT_MS = 8_000
/** Sitemap entries read at most; a big shop's sitemap lists every product. */
const MAX_SITEMAP_URLS = 500
/** Pages are downloaded no further than this. */
const MAX_TEXT_CHARS = 3_000_000

export type LinkGatherDeps = {
  /** A page's text and the address it was served from, or null. */
  fetchText: (
    url: string,
    signal: AbortSignal
  ) => Promise<{ url: string; text: string } | null>
  loadBlogs: (
    accountId: string
  ) => Promise<
    Array<{ id: string; title: string; status: string; publishedUrl: string | null }>
  >
}

const quietly = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    console.warn('Reading the site for internal links failed:', error)
    return fallback
  }
}

/** The sitemap's pages; for an index, the pages sitemap (else the posts one, else the first). */
async function sitemapUrls(
  deps: LinkGatherDeps,
  origin: string,
  signal: AbortSignal
): Promise<string[]> {
  const top = await deps.fetchText(`${origin}/sitemap.xml`, signal)
  if (!top) return []
  const parsed = parseSitemap(top.text)
  if (parsed.urls.length > 0) return parsed.urls.slice(0, MAX_SITEMAP_URLS)
  const child =
    parsed.sitemaps.find(url => /page/i.test(url)) ??
    parsed.sitemaps.find(url => /post/i.test(url)) ??
    parsed.sitemaps[0]
  if (!child) return []
  const nested = await deps.fetchText(child, signal)
  return nested ? parseSitemap(nested.text).urls.slice(0, MAX_SITEMAP_URLS) : []
}

export async function gatherLinkCandidatesWith(
  deps: LinkGatherDeps,
  ctx: Pick<GenerationContext, 'account' | 'offerings' | 'knowledgeDocs'>,
  input: { blogId: string; timeoutMs?: number }
): Promise<{ candidates: LinkCandidate[]; related: RelatedDraft[] }> {
  const signal = AbortSignal.timeout(input.timeoutMs ?? LINK_CANDIDATES_TIMEOUT_MS)
  const website = ctx.account.websiteUrl?.trim() || null
  let origin: string | null = null
  if (website) {
    try {
      origin = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
        .origin
    } catch {
      origin = null
    }
  }
  const [home, sitemap, blogs] = await Promise.all([
    origin ? quietly(() => deps.fetchText(`${origin}/`, signal), null) : null,
    origin ? quietly(() => sitemapUrls(deps, origin!, signal), []) : [],
    quietly(() => deps.loadBlogs(ctx.account.id), [])
  ])
  return buildLinkCandidates({
    website: origin,
    homeLinks: home ? extractSiteLinks(home.text, home.url) : [],
    sitemapUrls: sitemap,
    offerings: ctx.offerings.map(o => ({
      name: o.name,
      url: o.url ?? null,
      description: o.description ?? null
    })),
    knowledgeDocs: ctx.knowledgeDocs.map(d => ({
      title: d.title,
      sourceUrl: d.sourceUrl ?? null
    })),
    blogs,
    currentBlogId: input.blogId
  })
}

const DEFAULT_DEPS: LinkGatherDeps = {
  fetchText: async (url, signal) => {
    const response = await fetch(url, {
      redirect: 'follow',
      signal,
      headers: BROWSER_HEADERS
    })
    if (!response.ok) return null
    const text = (await response.text()).slice(0, MAX_TEXT_CHARS)
    return { url: response.url || url, text }
  },
  loadBlogs: accountId =>
    db
      .select({
        id: blogsTable.id,
        title: blogsTable.title,
        status: blogsTable.status,
        publishedUrl: blogsTable.publishedUrl
      })
      .from(blogsTable)
      .where(eq(blogsTable.accountId, accountId))
      .limit(200)
}

export function gatherLinkCandidates(
  ctx: GenerationContext,
  input: { blogId: string; timeoutMs?: number }
): Promise<{ candidates: LinkCandidate[]; related: RelatedDraft[] }> {
  return gatherLinkCandidatesWith(DEFAULT_DEPS, ctx, input)
}
