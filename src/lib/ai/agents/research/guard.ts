import type { Finding } from '@/lib/research/web-search'
import { MAX_FINDINGS } from './limits'

/** What the agent saw: every search result and page text, by URL. */
export type ResearchSeen = Map<string, { finding: Finding; text: string }>

const MIN_QUOTE_CHARS = 30
const MAX_QUOTE_CHARS = 600

const normalize = (value: string) =>
  value.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Keeps only findings the agent can prove: the URL came back from a search,
 * and the quote appears word for word in that result's snippet or the page it
 * read. The quote becomes the finding's text, so nothing the model wrote in
 * its own words reaches the writer.
 */
export function keepVerifiedFindings(
  proposed: Array<{ url: string; quote: string }>,
  seen: ResearchSeen
): { findings: Finding[]; rejected: number } {
  const findings: Finding[] = []
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
    if (findings.length >= MAX_FINDINGS) break
  }

  return { findings, rejected }
}
