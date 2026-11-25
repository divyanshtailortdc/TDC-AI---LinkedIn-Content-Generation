import { findUnsupportedAbsolutes } from '~/lib/ai/skills/ideation/guard'
import {
  CONTRAST_FRAME_PATTERNS,
  EXPERIENCE_CLAIM_PATTERNS,
  FILLER_PHRASE_PATTERNS,
  META_STATEMENT_PATTERNS,
  SWEEPING_CLAIM_PATTERNS,
  VAGUE_ATTRIBUTION_PATTERNS
} from './writing-rules'

/**
 * Detectors for the habits that make a post read as machine-written, and for
 * claims the author cannot stand behind. Pure functions over text: the phrase
 * lists and thresholds are in ./writing-rules, and run-linter turns what these
 * find into findings.
 */

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[“”"‘’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** The first match of each pattern, lowercased and without repeats. */
function firstMatches(patterns: RegExp[], text: string): string[] {
  const found: string[] = []
  for (const pattern of patterns) {
    const m = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(text)
    if (m) found.push(m[0])
  }
  return Array.from(new Set(found.map(f => f.toLowerCase())))
}

/**
 * "It's not X. It's Y." and its variants. Counted per sentence pair, so two
 * patterns hitting the same pair count once.
 */
export function countContrastFrames(text: string): number {
  const sentences = text.split(/(?<=[.?!])\s+|\n+/)
  let count = 0
  for (let i = 0; i < sentences.length; i++) {
    const pair = `${sentences[i]} ${sentences[i + 1] ?? ''}`
    if (
      CONTRAST_FRAME_PATTERNS.some(p =>
        new RegExp(p.source, p.flags).test(pair)
      )
    ) {
      count++
      i++
    }
  }
  return count
}

export function findVagueAttributions(text: string): string[] {
  return firstMatches(VAGUE_ATTRIBUTION_PATTERNS, text)
}

/**
 * "Most teams can't", "everyone knows", and the absolutes ideation already
 * checks ("always fails", "proves that"). `knownText` is what the post may
 * say: a phrase that appears in it is not flagged.
 */
export function findSweepingClaims(text: string, knownText?: string | null): string[] {
  const found: string[] = []
  for (const pattern of SWEEPING_CLAIM_PATTERNS) {
    for (const m of text.matchAll(pattern)) found.push(m[0].toLowerCase())
  }
  found.push(
    ...findUnsupportedAbsolutes(text, knownText ? [knownText] : []).map(a =>
      a.toLowerCase()
    )
  )
  return Array.from(new Set(found))
}

export function findExperienceClaims(text: string): string[] {
  return firstMatches(EXPERIENCE_CLAIM_PATTERNS, text)
}

export function findMetaStatements(text: string): string[] {
  return firstMatches(META_STATEMENT_PATTERNS, text)
}

export function findFillerPhrases(text: string): string[] {
  return firstMatches(FILLER_PHRASE_PATTERNS, text)
}

export function countEmDashes(text: string): number {
  return (text.match(/—/g) || []).length
}

/**
 * Text between quotation marks blanked out, keeping every other character
 * where it was: copying a source is fine when it is a quote.
 */
function withoutQuotedText(text: string): string {
  const blank = (quoted: string) => ' '.repeat(quoted.length)
  return text.replace(/“[^”]*”/g, blank).replace(/"[^"]*"/g, blank)
}

/** The words of `text` as `words` splits them, each with where it is in `text`. */
function wordSpans(
  text: string
): Array<{ word: string; start: number; end: number }> {
  const spans: Array<{ word: string; start: number; end: number }> = []
  for (const match of text.matchAll(/[\p{L}\p{N}“”"‘’']+/gu)) {
    const word = match[0].toLowerCase().replace(/[“”"‘’']/g, '')
    if (word)
      spans.push({ word, start: match.index, end: match.index + match[0].length })
  }
  return spans
}

/**
 * The longest run of words the post shares with any one source: its length,
 * and its text as the post wrote it ("61% of B2B…", not "61 of b2b…").
 * Quoted passages are left out of the post first.
 */
export function longestSharedRun(
  post: string,
  sources: string[]
): { length: number; text: string } {
  const postSpans = wordSpans(withoutQuotedText(post))
  const postWords = postSpans.map(span => span.word)
  let best = { length: 0, text: '' }
  for (const source of sources) {
    const sourceWords = wordSpans(source).map(span => span.word)
    if (sourceWords.length === 0) continue
    const starts = new Map<string, number[]>()
    sourceWords.forEach((w, i) => {
      const at = starts.get(w)
      if (at) at.push(i)
      else starts.set(w, [i])
    })
    for (let i = 0; i < postWords.length; i++) {
      for (const j of starts.get(postWords[i]!) ?? []) {
        let k = 0
        while (
          i + k < postWords.length &&
          j + k < sourceWords.length &&
          postWords[i + k] === sourceWords[j + k]
        )
          k++
        if (k > best.length) {
          best = {
            length: k,
            text: post
              .slice(postSpans[i]!.start, postSpans[i + k - 1]!.end)
              .replace(/\s+/g, ' ')
          }
        }
      }
    }
  }
  return best
}

/** How alike two closing asks are, 0 to 1, ignoring short connective words. */
export function ctaSimilarity(a: string, b: string): number {
  const keep = (t: string) => new Set(words(t).filter(w => w.length > 3))
  const setA = keep(a)
  const setB = keep(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const w of setA) if (setB.has(w)) shared++
  return shared / Math.min(setA.size, setB.size)
}
