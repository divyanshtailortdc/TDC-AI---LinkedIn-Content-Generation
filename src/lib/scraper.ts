import * as cheerio from 'cheerio'
import { resolvePublicHttpUrl, safeFetch } from './safe-url'

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
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (response.ok) {
      const html = await response.text()
      const $ = cheerio.load(html)

      // Remove noise tags
      $('script, style, noscript, svg, iframe, [role="banner"]').remove()

      const title =
        $('meta[property="og:title"]').attr('content') ||
        $('title').text().trim() ||
        validUrl

      const metaDesc =
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''

      // Extract text comprehensively from body, headings, lists, and sections
      let bodyText = $('body').text()
        .replace(/\r\n|\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim()

      if (metaDesc && !bodyText.includes(metaDesc)) {
        bodyText = `**Overview:** ${metaDesc}\n\n${bodyText}`
      }

      const words = bodyText.split(/\s+/).filter(Boolean)

      if (
        words.length >= 25 &&
        !bodyText.toLowerCase().includes('enable javascript and cookies to continue')
      ) {
        return {
          title,
          content: bodyText.slice(0, 50000),
          wordCount: words.length,
        }
      }
    }
  } catch (directErr) {
    console.warn(`Direct fetch failed for ${validUrl}:`, directErr)
  }

  throw new Error(
    'Unable to extract content from this URL. Please copy and paste the text directly into the "Add Custom Artifact" tab.'
  )
}
