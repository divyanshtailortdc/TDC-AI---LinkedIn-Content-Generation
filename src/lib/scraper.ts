import * as cheerio from 'cheerio'

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
 */
const PLACEHOLDER_TITLE =
  /^\s*(page not found|404|not found|error|access denied|forbidden|just a moment|attention required|are you a robot|enable javascript|sign in|log in)\b/i

export function looksLikePlaceholderPage(
  title: string,
  content: string
): boolean {
  if (PLACEHOLDER_TITLE.test(title)) return true
  const body = content.slice(0, 600).toLowerCase()
  return (
    /\b(404|page (?:could not be|cannot be|not) found|this page (?:does not|doesn't) exist)\b/.test(
      body
    ) && content.split(/\s+/).filter(Boolean).length < 200
  )
}

export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  let validUrl = url.trim()
  if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
    validUrl = `https://${validUrl}`
  }

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
    const response = await fetch(validUrl, {
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
