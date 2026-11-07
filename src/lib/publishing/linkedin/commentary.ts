/**
 * A post's text in LinkedIn's "little" format, which the Posts API's
 * `commentary` uses. Reserved characters must be escaped even in plain text:
 * unescaped, LinkedIn reads them as markup and can cut the post short.
 * Hashtags become the documented template, so they stay links.
 *
 * https://learn.microsoft.com/linkedin/marketing/community-management/shares/little-text-format
 */

const RESERVED = /[\\|{}@[\]()<>#*_~]/g

/** LinkedIn's limit for `commentary`. */
export const COMMENTARY_MAX_LENGTH = 3000

// A hashtag as LinkedIn and the copy text treat one (see post-text.ts).
const HASHTAG = /(?<![\p{L}\p{N}_&])#(?=[\p{N}_]*\p{L})([\p{L}\p{N}\p{M}_]+)/gu

const escapeLittleText = (text: string) => text.replace(RESERVED, '\\$&')

export function toLittleText(text: string): string {
  let out = ''
  let last = 0
  for (const match of text.matchAll(HASHTAG)) {
    out += escapeLittleText(text.slice(last, match.index))
    out += `{hashtag|\\#|${escapeLittleText(match[1]!)}}`
    last = match.index + match[0].length
  }
  return out + escapeLittleText(text.slice(last))
}

/** Characters as a reader counts them: one per emoji or bold letter. */
export const visibleLength = (text: string) => [...text].length
