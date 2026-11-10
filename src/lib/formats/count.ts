import type { CountMode } from './types'

/**
 * A post's length as its platform counts it. `String.length` is right for
 * LinkedIn but wrong for X, which counts every link as 23 and emoji and most
 * non-Latin characters as 2, and for platforms that count what a reader sees
 * as one character (a flag, a family emoji) once.
 */

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const URL_PATTERN = /\bhttps?:\/\/[^\s<>]+|\bwww\.[^\s<>]+/gi
const EMOJI = /\p{Extended_Pictographic}/u

/** X's link length: every URL is shortened to one of this many characters. */
export const X_URL_LENGTH = 23

/**
 * X's weight for one code point: Latin, most punctuation and the general
 * spacing marks count 1, everything else (CJK, most other scripts) 2. These
 * are the ranges in X's published counting configuration (twitter-text v3).
 */
function xWeight(codePoint: number): number {
  return codePoint <= 4351 ||
    (codePoint >= 8192 && codePoint <= 8205) ||
    (codePoint >= 8208 && codePoint <= 8223) ||
    (codePoint >= 8242 && codePoint <= 8247)
    ? 1
    : 2
}

function xWeighText(text: string): number {
  let total = 0
  for (const { segment } of graphemes.segment(text)) {
    // An emoji counts 2 however many code points make it up.
    if (EMOJI.test(segment)) total += 2
    else for (const ch of segment) total += xWeight(ch.codePointAt(0)!)
  }
  return total
}

export function countChars(text: string, mode: CountMode): number {
  if (mode === 'utf16') return text.length
  if (mode === 'graphemes') return [...graphemes.segment(text)].length

  const normalized = text.normalize('NFC')
  let total = 0
  let last = 0
  for (const match of normalized.matchAll(URL_PATTERN)) {
    total += xWeighText(normalized.slice(last, match.index)) + X_URL_LENGTH
    last = match.index + match[0].length
  }
  return total + xWeighText(normalized.slice(last))
}
