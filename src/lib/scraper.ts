import * as cheerio from 'cheerio'
import { readableText } from './html-text'
import { resolvePublicHttpUrl, safeFetch, UnsafeUrlError } from './safe-url'
import { extractSiteLinks, type SiteLink } from './site-links'

export type ScrapedContent = {
  title: string
  content: string
  wordCount: number
}

function cleanJinaMarkdown(md: string): string {
  return md
    .replace(/!\[Image \d+:[^\]]*\]\([^)]+\)/g, '') // remove base64/blob icon images
    .replace(/accessible mate[\s\S]*?zoom\s*screen/gi, '') // remove accessibility toolbar
    .replace(/\[toolbox\]\(https:\/\/mickidum\.github\.io\/acc_toolbar\/\)/gi, '')
    .replace(/\[accessibility statement\]\([^)]+\)/gi, '')
    .replace(/\[report an accessibility problem\]\([^)]+\)/gi, '')
    .replace(/reset settings[\s\S]*?learn more about/gi, '')
    .replace(/\[\.avif[^\]]*\]\([^)]+\)/g, '')
    .replace(/!\[Image \d+\]\([^)]+\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Error and placeholder pages scrape "successfully" and then sit in the
 * knowledge base as grounding evidence. Catching them at ingest keeps the
 * corpus honest.
 *
 * A title counts only when one part of it is nothing but these phrases and
 * status codes ("404: Page not found", "Attention Required! | Cloudflare"),
 * and the rest is short enough to be a site name. Matching the start of the
 * title alone rejected real articles such as "Error budgets: …" or
 * "Sign in with Apple: …".
 */
const PLACEHOLDER_TERM =
  '(?:page not found|not found|access denied|forbidden|error|just a moment|attention required|are you a robot|enable javascript|sign in|log in|[45]\\d\\d)'
const PLACEHOLDER_PART = new RegExp(
  `^${PLACEHOLDER_TERM}(?:[\\s:()]+${PLACEHOLDER_TERM})*[\\s!?.…()]*$`,
  'i'
)
/** The separators sites put between a page's title and their own name. */
const TITLE_SEPARATOR = /\s*[|·•]\s*|\s+[-–—]\s+/
const SITE_NAME_MAX_WORDS = 4

function isPlaceholderTitle(title: string): boolean {
  const parts = title.split(TITLE_SEPARATOR).map(part => part.trim())
  const placeholder = parts.findIndex(part => PLACEHOLDER_PART.test(part))
  return (
    placeholder !== -1 &&
    parts.every(
      (part, i) =>
        i === placeholder ||
        part.split(/\s+/).filter(Boolean).length <= SITE_NAME_MAX_WORDS
    )
  )
}

export function looksLikePlaceholderPage(
  title: string,
  content: string
): boolean {
  if (isPlaceholderTitle(title)) return true
  const body = content.slice(0, 600).toLowerCase()
  return (
    /\b(404|page (?:could not be|cannot be|not) found|this page (?:does not|doesn't) exist)\b/.test(
      body
    ) && content.split(/\s+/).filter(Boolean).length < 200
  )
}

/**
 * Pages fetched in the last few minutes. AI setup reads a page during analysis
 * and the user may add it to the knowledge base right after; this saves the
 * second download, which can take several seconds. Error and placeholder pages
 * are not kept, so a retry after the site recovers fetches the page again.
 */
const CACHE_TTL_MS = 10 * 60 * 1000
const recentPages = new Map<string, { at: number; page: ScrapedContent }>()

export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  // Rejects private-network and non-http targets before either strategy runs.
  const validUrl = (await resolvePublicHttpUrl(url)).toString()

  const cached = recentPages.get(validUrl)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.page
  const page = await scrapeUncached(validUrl)
  if (looksLikePlaceholderPage(page.title, page.content)) return page
  recentPages.set(validUrl, { at: Date.now(), page })
  if (recentPages.size > 50) {
    const oldest = recentPages.keys().next().value
    if (oldest) recentPages.delete(oldest)
  }
  return page
}

/** What a browser sends, so sites serve the page they show people. */
export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
}

/** A homepage with its scripts inlined can run to a few megabytes; menus come early. */
const MAX_HTML_CHARS = 3_000_000

/** A page's readable text from its HTML, or null when it has too little to read. */
function readHtml(html: string, pageUrl: string): ScrapedContent | null {
  const $ = cheerio.load(html)
  let bodyText = readableText($)

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    pageUrl

  const metaDesc =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''

  if (metaDesc && !bodyText.includes(metaDesc)) {
    bodyText = `**Overview:** ${metaDesc}\n\n${bodyText}`
  }

  const words = bodyText.split(/\s+/).filter(Boolean)
  if (
    words.length < 25 ||
    bodyText.toLowerCase().includes('enable javascript and cookies to continue')
  ) {
    return null
  }
  return {
    title,
    content: bodyText.slice(0, 50000),
    wordCount: words.length
  }
}

/**
 * A page read straight from its HTML: its text, when it has enough to read,
 * and its links, menus that only open on a click included (see
 * site-links.ts). scrapeUrl prefers a reader that renders the page, which
 * suits sites built in the browser but gives text only, and can be slow; this
 * gives a business's own site both its links and a fallback for its text.
 * Null when the page is not HTML or turns the request away.
 */
export async function scrapeHtml(
  url: string
): Promise<{ page: ScrapedContent | null; links: SiteLink[] } | null> {
  const response = await safeFetch(url, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(10000)
  })
  if (
    !response.ok ||
    !/html/i.test(response.headers.get('content-type') ?? '')
  ) {
    return null
  }
  const html = (await response.text()).slice(0, MAX_HTML_CHARS)
  // Relative links resolve against where the page ended up after redirects.
  const pageUrl = response.url || url
  return { page: readHtml(html, pageUrl), links: extractSiteLinks(html, pageUrl) }
}

/**
 * Jina Reader renders the page first, so it reads sites built in the browser
 * and many behind Cloudflare. Null when it cannot read the page.
 */
async function readWithJina(validUrl: string): Promise<ScrapedContent | null> {
  try {
    const jinaResponse = await fetch(`https://r.jina.ai/${validUrl}`, {
      headers: {
        Accept: 'application/json',
        'X-No-Cache': 'true',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (jinaResponse.ok) {
      const jinaData = await jinaResponse.json()
      const payload = jinaData.data || jinaData
      const rawContent = (payload.content || '').trim()

      if (rawContent.length > 100) {
        const cleanedContent = cleanJinaMarkdown(rawContent)
        const title = payload.title?.trim() || validUrl
        const description = payload.description?.trim() || ''

        // Prepend overview if available and not already in text
        let fullText = cleanedContent
        if (description && !cleanedContent.includes(description)) {
          fullText = `**Overview:** ${description}\n\n${cleanedContent}`
        }

        const words = fullText.split(/\s+/).filter(Boolean)
        if (words.length >= 30) {
          return {
            title,
            content: fullText.slice(0, 50000),
            wordCount: words.length,
          }
        }
      }
    }
  } catch (jinaErr) {
    console.warn(`Jina reader proxy failed or timed out for ${validUrl}:`, jinaErr)
  }
  return null
}

async function scrapeUncached(validUrl: string): Promise<ScrapedContent> {

  // Strategy 1: Jina Reader (handles Client-Side SPAs, React hydration, and Cloudflare)
  const viaJina = await readWithJina(validUrl)
  if (viaJina) return viaJina

  // Strategy 2: Direct Fetch with Cheerio
  try {
    const response = await safeFetch(validUrl, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) {
      const page = readHtml(await response.text(), validUrl)
      if (page) return page
    }
  } catch (directErr) {
    console.warn(`Direct fetch failed for ${validUrl}:`, directErr)
  }

  throw new Error(
    'Unable to extract content from this URL. Please copy and paste the text directly into the "Add Custom Artifact" tab.'
  )
}

export type ScrapedArticle = ScrapedContent & {
  /** Where the page ended up after redirects. */
  url: string
  /** The address the page names as its own (rel=canonical or og:url). */
  canonicalUrl: string | null
  siteName: string | null
  author: string | null
  description: string | null
  publishedAt: Date | null
}

/** A page that could not be read; `permanent` when trying again will not help. */
export class ArticleFetchError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean
  ) {
    super(message)
    this.name = 'ArticleFetchError'
  }
}

/** Where an article's own text usually is, best first. */
const ARTICLE_BODY = [
  '[itemprop="articleBody"]',
  'article',
  'main',
  '[role="main"]',
  '.post-content',
  '.entry-content',
  '.article-body',
  '.article-content'
]
/** The page around an article: menus, footers, sidebars, forms. */
const PAGE_FURNITURE =
  'nav, header, footer, aside, form, [role="navigation"], [role="contentinfo"], [role="complementary"]'
const ARTICLE_BODY_MIN_WORDS = 80

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length

function absoluteHttpUrl(value: string | null | undefined, base: string) {
  if (!value) return null
  try {
    const url = new URL(value.trim(), base)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

/** A date a page gives for itself, when it is plausible: after 1995, not in the future. */
function pageDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const time = new Date(value.trim()).getTime()
  if (
    Number.isNaN(time) ||
    time < Date.UTC(1995, 0, 1) ||
    time > Date.now() + 24 * 60 * 60 * 1000
  ) {
    return null
  }
  return new Date(time)
}

/** The first article facts in the page's JSON-LD blocks. */
function readJsonLd($: cheerio.CheerioAPI) {
  const facts: { datePublished?: string; author?: string; headline?: string } =
    {}
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const item = node as Record<string, unknown>
    if (!facts.datePublished && typeof item.datePublished === 'string')
      facts.datePublished = item.datePublished
    if (!facts.headline && typeof item.headline === 'string')
      facts.headline = item.headline
    if (!facts.author && item.author) {
      const names = (Array.isArray(item.author) ? item.author : [item.author])
        .map(a => (typeof a === 'string' ? a : (a as { name?: unknown })?.name))
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
      if (names.length > 0) facts.author = names.join(', ')
    }
    visit(item['@graph'])
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()))
    } catch {
      // A broken block says nothing.
    }
  })
  return facts
}

/**
 * An article page's text and what it says about itself, from its HTML. The
 * text is its article element's when that has enough words, otherwise the
 * whole page's without menus and footer. Null when there is too little.
 */
export function readArticleHtml(
  html: string,
  pageUrl: string
): Omit<ScrapedArticle, 'url'> | null {
  const $ = cheerio.load(html.slice(0, MAX_HTML_CHARS))
  const meta = (selector: string) =>
    $(selector).first().attr('content')?.trim() || null
  const ld = readJsonLd($)

  const title =
    meta('meta[property="og:title"]') ||
    meta('meta[name="twitter:title"]') ||
    ld.headline?.trim() ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    pageUrl
  const author =
    [
      meta('meta[name="author"]'),
      meta('meta[property="article:author"]'),
      ld.author?.trim()
    ].find(name => name && !/^https?:\/\//i.test(name)) ?? null
  const publishedAt = pageDate(
    meta('meta[property="article:published_time"]') ??
      meta('meta[name="date"]') ??
      meta('meta[itemprop="datePublished"]') ??
      ld.datePublished ??
      $('time[datetime]').first().attr('datetime')
  )
  const description =
    meta('meta[name="description"]') || meta('meta[property="og:description"]')
  const canonicalUrl =
    absoluteHttpUrl($('link[rel="canonical"]').attr('href'), pageUrl) ??
    absoluteHttpUrl(meta('meta[property="og:url"]'), pageUrl)
  const siteName = meta('meta[property="og:site_name"]')

  $(PAGE_FURNITURE).remove()
  const body = ARTICLE_BODY.map(selector => $(selector).first()).find(
    el => el.length > 0 && countWords(el.text()) >= ARTICLE_BODY_MIN_WORDS
  )
  const content = readableText(
    body ? cheerio.load(`<body>${$.html(body)}</body>`) : $
  )
  const wordCount = countWords(content)
  if (wordCount < 25) return null
  return {
    title,
    content: content.slice(0, 50000),
    wordCount,
    canonicalUrl,
    siteName,
    author,
    description,
    publishedAt
  }
}

/** Gone for good: Jina would not find it either. */
const GONE_STATUSES = new Set([404, 410, 451])

/**
 * An article's text and facts, for the newsletter pipeline (src/lib/intel).
 * The page is read directly first, which gives its canonical address, date
 * and author; Jina Reader fills in when the site turns the request away,
 * builds the page in the browser, or gives too little text. Throws
 * ArticleFetchError, permanent when the page is gone, unsafe, not a web page
 * or unreadable both ways, and otherwise worth retrying later.
 */
export async function scrapeArticle(
  url: string,
  opts: { minWords: number; maxRedirects: number; timeoutMs: number }
): Promise<ScrapedArticle> {
  let direct: Omit<ScrapedArticle, 'url'> | null = null
  let finalUrl = url
  let failure: ArticleFetchError | null = null
  try {
    const response = await safeFetch(
      url,
      { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(opts.timeoutMs) },
      opts.maxRedirects
    )
    finalUrl = response.url || url
    const type = response.headers.get('content-type') ?? ''
    if (GONE_STATUSES.has(response.status)) {
      await response.body?.cancel()
      throw new ArticleFetchError(
        `The page is gone (HTTP ${response.status}).`,
        true
      )
    }
    if (!response.ok) {
      await response.body?.cancel()
      const retryable =
        [408, 425, 429].includes(response.status) || response.status >= 500
      failure = new ArticleFetchError(
        `The site answered HTTP ${response.status}.`,
        !retryable
      )
    } else if (!/html/i.test(type)) {
      await response.body?.cancel()
      throw new ArticleFetchError(
        `Not a web page (${type.split(';')[0] || 'unknown type'}).`,
        true
      )
    } else {
      direct = readArticleHtml(await response.text(), finalUrl)
      if (direct && direct.wordCount >= opts.minWords) {
        return { ...direct, url: finalUrl }
      }
    }
  } catch (err) {
    if (err instanceof ArticleFetchError) throw err
    if (err instanceof UnsafeUrlError) {
      throw new ArticleFetchError(err.message, true)
    }
    failure = new ArticleFetchError(
      `Could not reach the page: ${err instanceof Error ? err.message : String(err)}`,
      false
    )
  }

  const viaReader = await readWithJina(finalUrl)
  if (viaReader && viaReader.wordCount >= opts.minWords) {
    return {
      title: direct?.title ?? viaReader.title,
      content: viaReader.content,
      wordCount: viaReader.wordCount,
      url: finalUrl,
      canonicalUrl: direct?.canonicalUrl ?? null,
      siteName: direct?.siteName ?? null,
      author: direct?.author ?? null,
      description: direct?.description ?? null,
      publishedAt: direct?.publishedAt ?? null
    }
  }
  throw (
    failure ??
    new ArticleFetchError(
      'Too little text to read: a paywall, a sign-in page or a teaser.',
      true
    )
  )
}
