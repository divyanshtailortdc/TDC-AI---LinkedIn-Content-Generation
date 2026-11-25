import type { Finding } from '@/lib/research/web-search'
import { looksLikePlaceholderPage } from '@/lib/scraper'
import { MAX_FINDINGS } from './limits'

/**
 * What the agent saw, by URL: the search result, the text a quote may come
 * from (its snippet, and the page once read), and the page's own text alone.
 */
export type ResearchSeen = Map<
  string,
  { finding: Finding; text: string; pageText?: string }
>

const MIN_QUOTE_CHARS = 30
const MAX_QUOTE_CHARS = 600

const normalize = (value: string) =>
  value.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Keeps only findings the agent can prove: the URL came back from a search,
 * and the quote appears word for word in that result's snippet or the page it
 * read. The quote becomes the finding's text, so nothing the model wrote in
 * its own words reaches the writer. `pageVerified[i]` says whether finding i
 * was found on the page itself, not only in a search snippet.
 */
export function keepVerifiedFindings(
  proposed: Array<{ url: string; quote: string }>,
  seen: ResearchSeen,
  maxFindings: number = MAX_FINDINGS
): { findings: Finding[]; rejected: number; pageVerified: boolean[] } {
  const findings: Finding[] = []
  const pageVerified: boolean[] = []
  const used = new Set<string>()
  let rejected = 0

  for (const item of proposed) {
    const source = seen.get(item.url.trim())
    const quote = item.quote.trim()
    const key = `${item.url}\n${normalize(quote)}`
    if (
      !source ||
      quote.length < MIN_QUOTE_CHARS ||
      quote.length > MAX_QUOTE_CHARS ||
      !normalize(source.text).includes(normalize(quote)) ||
      used.has(key)
    ) {
      rejected++
      continue
    }
    used.add(key)
    findings.push({ ...source.finding, snippet: quote })
    pageVerified.push(
      Boolean(source.pageText) &&
        normalize(source.pageText!).includes(normalize(quote))
    )
    if (findings.length >= maxFindings) break
  }

  return { findings, rejected, pageVerified }
}

/**
 * A page read as the page itself: its title and text, or null when what came
 * back was a bot check, an error or a placeholder ("Just a moment…"), whose
 * title must not name a source and whose text proves nothing.
 */
export function usablePage(page: {
  title: string
  content: string
}): { title: string; text: string } | null {
  if (looksLikePlaceholderPage(page.title ?? '', page.content ?? '')) return null
  return { title: page.title.trim(), text: page.content }
}
