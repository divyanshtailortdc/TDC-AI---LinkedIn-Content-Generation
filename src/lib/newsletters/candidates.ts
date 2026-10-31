import { parsePublicHttpUrl } from '@/lib/safe-url'
import { normalizeUrlForCompare } from '@/lib/urls'
import * as cheerio from 'cheerio'

/**
 * Reading a search result's page for signs of a newsletter: a subscribe form,
 * a link to one, and the feed it declares. Plain code over HTML, no network,
 * so discovery.ts can fetch and this can be tested on fixtures.
 */

/**
 * Sites that come up for "… newsletter" searches but are not where a
 * newsletter is signed up for: social networks, video, forums, encyclopedias,
 * job boards and app stores.
 */
const EXCLUDED_HOSTS = [
  'linkedin.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'threads.net',
  'tiktok.com',
  'youtube.com',
  'reddit.com',
  'quora.com',
  'pinterest.com',
  'wikipedia.org',
  'github.com',
  'apps.apple.com',
  'play.google.com',
  'indeed.com',
  'glassdoor.com',
  'amazon.com',
  'feedspot.com'
]

/** Hosts whose pages are newsletters by construction, with a subscribe form. */
const NEWSLETTER_PLATFORMS = [
  'substack.com',
  'beehiiv.com',
  'ghost.io',
  'buttondown.com',
  'buttondown.email',
  'kit.com',
  'convertkit.com',
  'list-manage.com',
  'mailerlite.com'
]

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const isOnHost = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

export function isExcludedHost(url: string): boolean {
  const host = hostOf(url)
  return !host || EXCLUDED_HOSTS.some(domain => isOnHost(host, domain))
}

export function isNewsletterPlatform(url: string): boolean {
  const host = hostOf(url)
  return !!host && NEWSLETTER_PLATFORMS.some(domain => isOnHost(host, domain))
}

/**
 * The key one signup page is stored under, however its URL was written.
 * Publishers tag signup links with where they were clicked
 * ("/signup/?signup_location=header"), so the query is dropped, except on a
 * newsletter platform, where it names the list ("list-manage.com/subscribe?u=…&id=…").
 */
export function signupUrlKey(url: string): string {
  const key = normalizeUrlForCompare(url)
  return isNewsletterPlatform(url) ? key : key.replace(/\?.*$/, '')
}

/** Last two labels of a host: news.example.com and example.com are one site. */
function siteOf(host: string): string {
  return host.split('.').slice(-2).join('.')
}

export type FeedLink = { url: string; type: 'rss' | 'atom' }

export type PageAnalysis = {
  title: string
  /** og:site_name, when the page gives one. */
  siteName: string | null
  description: string
  /** An email field or a platform's subscribe embed is on the page. */
  hasSignupForm: boolean
  /** The page reads as a newsletter's own page (mentions subscribing to one). */
  mentionsNewsletter: boolean
  /** Links on the same site that look like they lead to a subscribe form, best first. */
  subscribeLinks: string[]
  feeds: FeedLink[]
  /** The start of the page's text, for the classifier. */
  excerpt: string
}

const SUBSCRIBE_TEXT =
  /subscribe|newsletter|sign[\s-]?up|join (?:the |our )?(?:list|newsletter)|get (?:the|our) (?:newsletter|briefing)/i
const NOT_SUBSCRIBE =
  /unsubscribe|log[\s-]?in|sign[\s-]?in|account|preferences|privacy|terms|podcast|careers|jobs/i
const EXCERPT_CHARS = 700

/** A link the page declares as safe to show: http(s), public host, no credentials. */
function publicUrl(href: string | undefined, base: string): string | null {
  if (!href) return null
  try {
    return parsePublicHttpUrl(new URL(href, base).toString()).toString()
  } catch {
    return null
  }
}

function hasEmailField($: cheerio.CheerioAPI): boolean {
  if ($('input[type="email"]').length > 0) return true
  if ($('input[name*="email" i], input[placeholder*="email" i]').length > 0) {
    return true
  }
  // Substack, beehiiv and Mailchimp embed their forms in a frame.
  return $('iframe[src]')
    .toArray()
    .some(el => {
      const src = $(el).attr('src') ?? ''
      return isNewsletterPlatform(src) && /embed|subscribe|form/i.test(src)
    })
}

function findFeeds($: cheerio.CheerioAPI, pageUrl: string): FeedLink[] {
  const feeds: FeedLink[] = []
  const seen = new Set<string>()
  $('link[rel~="alternate"][href]').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase()
    const kind = type.includes('atom')
      ? 'atom'
      : type.includes('rss')
        ? 'rss'
        : null
    if (!kind) return
    const url = publicUrl($(el).attr('href'), pageUrl)
    // A blog's comment feed is not the newsletter.
    if (!url || /\/comments?\/feed|comments\.xml/i.test(url)) return
    if (seen.has(url)) return
    seen.add(url)
    feeds.push({ url, type: kind })
  })
  return feeds
}

function findSubscribeLinks($: cheerio.CheerioAPI, pageUrl: string): string[] {
  const pageHost = hostOf(pageUrl)
  if (!pageHost) return []
  const scored = new Map<string, number>()
  $('a[href]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    const href = $(el).attr('href') ?? ''
    const label = `${text} ${href}`
    if (!SUBSCRIBE_TEXT.test(label) || NOT_SUBSCRIBE.test(label)) return
    const url = publicUrl(href, pageUrl)
    const host = url && hostOf(url)
    if (!url || !host) return
    // The publisher's own pages, or the platform that hosts its list.
    if (siteOf(host) !== siteOf(pageHost) && !isNewsletterPlatform(url)) return
    if (signupUrlKey(url) === signupUrlKey(pageUrl)) return
    const score =
      (/subscribe/i.test(label) ? 2 : 0) +
      (/newsletter/i.test(label) ? 2 : 0) +
      (/sign[\s-]?up/i.test(label) ? 1 : 0)
    scored.set(url, Math.max(score, scored.get(url) ?? 0))
  })
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .slice(0, 3)
}

/** What a fetched page says about being, or leading to, a newsletter signup. */
export function analyzePage(html: string, pageUrl: string): PageAnalysis {
  const $ = cheerio.load(html)
  const meta = (selector: string) =>
    ($(selector).attr('content') ?? '').replace(/\s+/g, ' ').trim()

  const title =
    meta('meta[property="og:title"]') ||
    $('title').first().text().replace(/\s+/g, ' ').trim()
  const description =
    meta('meta[name="description"]') || meta('meta[property="og:description"]')
  const feeds = findFeeds($, pageUrl)
  const subscribeLinks = findSubscribeLinks($, pageUrl)
  const hasSignupForm = hasEmailField($)

  $('script, style, noscript, svg, nav, footer').remove()
  const text = $('body').text().replace(/\s+/g, ' ').trim()

  return {
    title,
    siteName: meta('meta[property="og:site_name"]') || null,
    description,
    hasSignupForm,
    mentionsNewsletter: /newsletter|subscribe|weekly|daily brief|digest/i.test(
      `${title} ${description} ${text.slice(0, 4000)}`
    ),
    subscribeLinks,
    feeds,
    excerpt: text.slice(0, EXCERPT_CHARS)
  }
}

/** A page's own URL path says it is about a newsletter or subscribing. */
export function isNewsletterPath(url: string): boolean {
  try {
    return /newsletter|subscribe|signup|sign-up/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** The site root of `url`, shown as the publisher's website. */
export function websiteOf(url: string): string {
  const parsed = new URL(url)
  return `${parsed.origin}/`
}
