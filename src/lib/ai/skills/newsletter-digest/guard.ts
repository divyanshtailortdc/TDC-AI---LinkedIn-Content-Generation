import {
  textAroundLink,
  withoutMarkers,
  type EmailContent
} from '../../../intel/email-content'
import {
  MAX_DIGEST_ITEMS,
  type DigestItem,
  type NewsletterDigest
} from './schema'

/** Case, spacing and typographic quotes and dashes do not count when comparing. */
function comparable(text: string) {
  return withoutMarkers(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Share of a near-quote's words the email's sentences must hold. */
const NEAR_QUOTE_SHARE = 0.8
/** Sentences in a row a near-quote may span. */
const NEAR_QUOTE_SENTENCES = 3

const wordsOf = (text: string) =>
  comparable(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length > 1)

/**
 * The email's own words for a passage the model meant to copy but changed a
 * word or two of (models often do): the run of up to three sentences in the
 * email that holds most of its words, as the email has them. Null when no run
 * is that close. The blurb stored is then always the email's text.
 */
function nearQuote(blurb: string, sentences: string[]): string | null {
  const wanted = new Set(wordsOf(blurb))
  if (wanted.size < 5) return null
  const sentenceWords = sentences.map(sentence => new Set(wordsOf(sentence)))
  let best: { share: number; text: string } | null = null
  for (let start = 0; start < sentences.length; start++) {
    const found = new Set<string>()
    for (
      let n = 0;
      n < NEAR_QUOTE_SENTENCES && start + n < sentences.length;
      n++
    ) {
      for (const word of sentenceWords[start + n]!) {
        if (wanted.has(word)) found.add(word)
      }
      const share = found.size / wanted.size
      const text = sentences.slice(start, start + n + 1).join(' ')
      // Of runs that hold as many of the words, the shortest says it best.
      if (
        !best ||
        share > best.share ||
        (share === best.share && text.length < best.text.length)
      ) {
        best = { share, text }
      }
    }
  }
  return best && best.share >= NEAR_QUOTE_SHARE
    ? best.text.slice(0, 1000)
    : null
}

/**
 * The model's digest, kept to what the email supports. A link must be one of
 * the email's own numbers, and only one story keeps each. A blurb must be the
 * email's own words: copied exactly, or nearly (then the email's sentences
 * replace it); otherwise the email's text around the story's link stands in,
 * and a story with neither is dropped. Only a newsletter keeps stories.
 */
export function keepGroundedDigest(
  output: {
    kind: NewsletterDigest['kind']
    summary: string
    topics: string[]
    items: Array<{
      headline: string
      blurb: string
      link: number | null
      sponsored: boolean
    }>
  },
  content: EmailContent
): NewsletterDigest {
  const email = comparable(content.text)
  const sentences = withoutMarkers(content.text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const numbers = new Set(content.links.map(link => link.n))
  const taken = new Set<number>()

  const items: DigestItem[] = []
  if (output.kind === 'newsletter') {
    for (const item of output.items) {
      const headline = withoutMarkers(item.headline).trim().slice(0, 300)
      if (!headline) continue
      const link =
        item.link !== null && numbers.has(item.link) && !taken.has(item.link)
          ? item.link
          : null
      const quoted = comparable(item.blurb)
      const blurb =
        quoted.length >= 20 && email.includes(quoted)
          ? withoutMarkers(item.blurb).trim().slice(0, 1000)
          : (nearQuote(item.blurb, sentences) ??
            (link !== null ? textAroundLink(content.text, link) : null))
      if (link === null && blurb === null) continue
      if (link !== null) taken.add(link)
      items.push({ headline, blurb, link, sponsored: item.sponsored })
      if (items.length === MAX_DIGEST_ITEMS) break
    }
  }

  return {
    kind: output.kind,
    summary: output.summary.trim().slice(0, 600),
    topics: output.topics
      .map(topic => topic.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 6),
    items
  }
}
