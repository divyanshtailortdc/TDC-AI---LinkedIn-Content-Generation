import * as cheerio from 'cheerio'
import { resolvePublicHttpUrl, safeFetch } from './safe-url'
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
const BROWSER_HEADERS = {
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

/**
 * Elements that end a line of text. Without a break after them, the text of
 * a page whose HTML has no whitespace between tags ran together, as in
 * "SolutionsIntegrations".
 */
const BLOCK_ELEMENTS =
  'address, article, aside, blockquote, br, dd, div, dl, dt, figcaption, figure, footer, form, h1, h2, h3, h4, h5, h6, header, hr, li, main, nav, ol, p, pre, section, table, td, th, tr, ul'

/** A page's readable text from its HTML, or null when it has too little to read. */
function readHtml(html: string, pageUrl: string): ScrapedContent | null {
  const $ = cheerio.load(html)

  // Remove noise tags
  $('script, style, noscript, svg, iframe, [role="banner"]').remove()
  $(BLOCK_ELEMENTS).after('\n')
  // Links and buttons side by side are separate words ("Solutions Pricing");
  // spans are not, as a heading may set each letter in its own.
  $('a, button').after(' ')

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text().trim() ||
    pageUrl

  const metaDesc =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''

  // Extract text comprehensively from body, headings, lists, and sections
  let bodyText = $('body')
    .text()
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

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

async function scrapeUncached(validUrl: string): Promise<ScrapedContent> {

  // Strategy 1: Jina Reader (handles Client-Side SPAs, React hydration, and Cloudflare)
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
