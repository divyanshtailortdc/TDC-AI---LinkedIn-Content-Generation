import { load } from 'cheerio'
import { INVISIBLE, readableText } from '../html-text'
import { canonicalArticleUrl, isFollowableLink } from './links'
import { EXTRACTION_SETTINGS } from './settings'

/**
 * A received email as the digest reads it: its visible text, with each link
 * worth following marked `[n]` after its words, and those links. Pure.
 *
 * Hidden preview text, tracking pixels and the footer (from "unsubscribe" or
 * "you received this" on) are left out, and so are links that act on the
 * subscription or account (links.ts), which are never followed.
 */

export type EmailLink = {
  /** The number of its `[n]` markers in the text, from 1. */
  n: number
  /** As written in the email: often a click tracker's address. */
  url: string
  /** Its words: the longest of the links to the same address. */
  text: string
}

export type EmailContent = { text: string; links: EmailLink[] }

/** Inline styles that hide an element: preview text, spacers, Outlook-only parts. */
const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|(?:max-height|font-size|opacity)\s*:\s*0(?:\.0+)?(?:px|em|rem|pt|%)?\s*(?:!important)?\s*)(?:;|$)/i

/** A line that starts the footer, when it comes in the second half of the email. */
const FOOTER_LINE =
  /\b(un-?subscribe|opt[\s-]?out|you('re| are)? receiv(ed|ing) this|you('re| are) (getting|reading) this|this email was sent to|was sent to [^\s@]+@|manage (your )?(subscription|preferences|email)|update your (email )?preferences|no longer (wish|want) to receive|why did i get this)\b/i

const URL_IN_TEXT = /https?:\/\/[^\s<>"'()[\]]*[^\s<>"'()[\].,;:!?]/gi
const LINK_TEXT_WORDS = 12

/** Numbers the links worth keeping, each address once, in reading order. */
class LinkNumbers {
  private readonly byAddress = new Map<string, EmailLink>()

  add(url: string, text: string): number | null {
    if (!isFollowableLink(url, text)) return null
    const key = canonicalArticleUrl(url) ?? url
    const words = text.replace(/\s+/g, ' ').trim().slice(0, 200)
    const known = this.byAddress.get(key)
    if (known) {
      // A headline and its "Read more" link: the headline says more.
      if (words.length > known.text.length) known.text = words
      return known.n
    }
    const link = { n: this.byAddress.size + 1, url, text: words }
    this.byAddress.set(key, link)
    return link.n
  }

  get all() {
    return [...this.byAddress.values()]
  }
}

/** `[3]` written in the email itself (a footnote) must not read as a marker. */
const escapeMarkers = (text: string) => text.replace(/\[(\d+)\]/g, '($1)')

function fromHtml(html: string) {
  const $ = load(escapeMarkers(html))
  $('head, title').remove()
  $('[style]').each((_, el) => {
    if (HIDDEN_STYLE.test($(el).attr('style') ?? '')) $(el).remove()
  })
  $('[hidden], [aria-hidden="true"]').remove()
  // A linked image tells what it links to through its alt text; any other
  // image, tracking pixels included, adds nothing to read.
  $('img').each((_, el) => {
    const img = $(el)
    const alt = (img.attr('alt') ?? '').trim()
    if (alt && img.closest('a').length > 0) img.replaceWith(` ${alt} `)
    else img.remove()
  })
  const numbers = new LinkNumbers()
  $('a[href]').each((_, el) => {
    const a = $(el)
    const n = numbers.add(a.attr('href') ?? '', a.text())
    if (n !== null) a.append(` [${n}]`)
  })
  return { text: readableText($), links: numbers.all }
}

/** Plain-text email: each address becomes a marker, named by the words before it. */
function fromText(text: string) {
  const numbers = new LinkNumbers()
  const marked = escapeMarkers(text)
    .split('\n')
    .map(line =>
      line.replace(URL_IN_TEXT, (url, offset: number) => {
        const before = line
          .slice(0, offset)
          .replace(URL_IN_TEXT, ' ')
          .trim()
          .split(/\s+/)
          .slice(-LINK_TEXT_WORDS)
          .join(' ')
        const n = numbers.add(url, before)
        return n === null ? '' : `[${n}]`
      })
    )
    .join('\n')
  return { text: marked, links: numbers.all }
}

function cutFooter(text: string) {
  const lines = text.split('\n')
  let offset = 0
  for (const [i, line] of lines.entries()) {
    if (offset >= text.length / 2 && FOOTER_LINE.test(line)) {
      return lines.slice(0, i).join('\n').trim()
    }
    offset += line.length + 1
  }
  return text
}

/**
 * The email's text and links. The HTML part is preferred: it names its
 * links. Links cut off with the footer are dropped, and the rest renumbered
 * in reading order, at most `maxLinks`.
 */
export function readEmailContent(
  email: { html: string | null; text: string | null },
  maxLinks: number = EXTRACTION_SETTINGS.maxLinksPerEmail
): EmailContent {
  const raw = email.html ? fromHtml(email.html) : fromText(email.text ?? '')
  const text = cutFooter(
    raw.text
      .replace(INVISIBLE, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )

  const order: number[] = []
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1])
    if (!order.includes(n)) order.push(n)
  }
  const kept = order.slice(0, maxLinks)
  const renumbered = new Map(kept.map((n, i) => [n, i + 1]))
  const byNumber = new Map(raw.links.map(link => [link.n, link]))

  return {
    text: text
      .replace(/ ?\[(\d+)\]/g, (_, n: string) => {
        const to = renumbered.get(Number(n))
        return to ? ` [${to}]` : ''
      })
      .trim(),
    links: kept.map((n, i) => ({ ...byNumber.get(n)!, n: i + 1 }))
  }
}

/** The text with its markers taken out, e.g. for showing or quoting. */
export function withoutMarkers(text: string) {
  return text.replace(/ ?\[\d+\]/g, '')
}

/**
 * What the email says around link `n`: the line its marker is on and the
 * lines after it, up to a blank line or the next link, without markers.
 * Null when that is too short to say anything.
 */
export function textAroundLink(text: string, n: number): string | null {
  const lines = text.split('\n')
  const start = lines.findIndex(line => line.includes(`[${n}]`))
  if (start === -1) return null
  const picked = [lines[start]!]
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /\[\d+\]/.test(line) || picked.join(' ').length > 400)
      break
    picked.push(line)
  }
  const around = withoutMarkers(picked.join(' ')).replace(/\s+/g, ' ').trim()
  return around.length >= 20 ? around.slice(0, 600) : null
}
