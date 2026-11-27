import { findUnsupportedAbsolutes } from '~/lib/ai/skills/ideation/guard'
import {
  CAPABILITY_CLAIMS,
  CONTRAST_FRAME_PATTERNS,
  DEFAULT_REPETITION_LIMITS,
  EXPERIENCE_CLAIM_PATTERNS,
  FEATURE_SHEET_LIMITS,
  FEATURE_SHEET_PATTERNS,
  FILLER_PHRASE_PATTERNS,
  GENERIC_PHRASE_PATTERNS,
  LIST_LINE_PATTERN,
  MEDIA_NARRATION_PATTERNS,
  META_STATEMENT_PATTERNS,
  PROMOTIONAL_PHRASE_PATTERNS,
  REPETITION_FREE_OPENINGS,
  REPETITION_STOPWORDS,
  SEQUENCE_OPENING_PATTERN,
  SWEEPING_CLAIM_PATTERNS,
  VAGUE_ATTRIBUTION_PATTERNS,
  type RepetitionLimits
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

/** Hype, rankings, urgency and generic AI phrasing, as the post writes them. */
export function findPromotionalPhrases(text: string): string[] {
  return firstMatches(
    [...PROMOTIONAL_PHRASE_PATTERNS, ...GENERIC_PHRASE_PATTERNS],
    text
  )
}

/** Where a post narrates its media ("This video shows…") instead of talking to the reader. */
export function findMediaNarration(text: string): string[] {
  return firstMatches(MEDIA_NARRATION_PATTERNS, text)
}

/** A text's sentences: split after end punctuation and at line breaks. */
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.?!])\s+|\n+/)
    .map(s => s.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean)

/** "Here's what it does for you:", "Key features": a list announced. */
export function findFeatureSheetPhrases(text: string): string[] {
  return firstMatches(FEATURE_SHEET_PATTERNS, text)
}

/** Lines that are list items: a bullet, a dash, a number or an emoji first. */
export function countListLines(text: string): number {
  return text.split('\n').filter(line => LIST_LINE_PATTERN.test(line)).length
}

/** Words in a list item short enough to be a name, not a clause. */
const LIST_ITEM_WORDS = 4

/**
 * Sentences that name more than `maxItems` things in one comma-separated run
 * ("your logo, colours, font and button shape"): every control shown, where
 * a reader needs the group and an example or two. The first item may end a
 * longer clause ("set your brand colours, fonts…"); the ones after it are
 * short, and the last may follow "and" or "or". Each sentence with its count.
 */
export function findLongLists(
  text: string,
  maxItems: number = FEATURE_SHEET_LIMITS.itemsInSentence
): Array<{ text: string; items: number }> {
  const found: Array<{ text: string; items: number }> = []
  const isShort = (part: string) => {
    const n = words(part).length
    return n > 0 && n <= LIST_ITEM_WORDS
  }
  for (const sentence of sentencesOf(text)) {
    const parts = sentence.split(/\s*[,;]\s*/).filter(p => words(p).length > 0)
    let most = 0
    let run = 0
    for (const part of parts) {
      // "and social links sit on the page", or "a delivery promise and social links…"
      const closing = /^(?:and|or)\s/i.test(part)
        ? 1
        : (() => {
            const m = /^(.*?)\s+(?:and|or)\s+\S/i.exec(part)
            return m && isShort(m[1]!) ? 2 : 0
          })()
      if (run > 0 && closing > 0) {
        most = Math.max(most, run + closing)
        run = 0
        continue
      }
      if (run > 0 && isShort(part)) {
        run++
        most = Math.max(most, run)
        continue
      }
      // A new run starts here: this part's last words are its first item.
      run = 1
    }
    if (most > maxItems)
      found.push({ text: sentence.slice(0, 140), items: most })
  }
  return found
}

/** A rough stem: "leave" and "leaving", "store" and "stores" match. */
function roughStem(word: string): string {
  for (const suffix of ['ings', 'ing', 'ed', 'es', 's', 'e']) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix))
      return word.slice(0, -suffix.length)
  }
  return word
}

/**
 * Sentences that say again what an earlier paragraph said: the content
 * words of the shorter one (two or more) nearly all in the other ("That is
 * where they leave your brand." … "They get it without leaving your
 * brand."). `ignore` holds names expected to recur. Each pair, earlier first.
 */
export function findRestatedSentences(
  text: string,
  options: { ignore?: string[] } = {}
): Array<{ first: string; again: string }> {
  const ignored = new Set(
    (options.ignore ?? []).flatMap(name => words(name)).map(roughStem)
  )
  const sentences: Array<{ text: string; paragraph: number; stems: Set<string> }> =
    []
  text.split(/\n\s*\n/).forEach((paragraph, index) => {
    for (const sentence of sentencesOf(paragraph)) {
      const stems = new Set(
        words(sentence)
          .filter(w => isContentWord(w, 4))
          .map(roughStem)
          .filter(stem => !ignored.has(stem))
      )
      if (stems.size >= 2) sentences.push({ text: sentence, paragraph: index, stems })
    }
  })
  const found: Array<{ first: string; again: string }> = []
  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const a = sentences[i]!
      const b = sentences[j]!
      if (a.paragraph === b.paragraph) continue
      let shared = 0
      for (const stem of a.stems) if (b.stems.has(stem)) shared++
      if (shared >= 2 && shared / Math.min(a.stems.size, b.stems.size) >= 0.75) {
        found.push({ first: a.text, again: b.text })
      }
    }
  }
  return found
}

/**
 * Capabilities the post claims that `evidence` (what the media shows, the
 * author's notes) does not: an integration, analytics, AI and the like
 * (CAPABILITY_CLAIMS), as the post writes them.
 */
export function findUnsupportedCapabilities(
  text: string,
  evidence: string
): string[] {
  const found: string[] = []
  for (const { claim, evidence: support } of CAPABILITY_CLAIMS) {
    const m = claim.exec(text)
    if (m && !(support ?? claim).test(evidence)) found.push(m[0].toLowerCase())
  }
  return Array.from(new Set(found))
}

/** Sentences that open a step-by-step retelling: "First…", "Then…", "Finally…". */
export function countSequenceOpenings(text: string): number {
  return sentencesOf(text).filter(s => SEQUENCE_OPENING_PATTERN.test(s)).length
}

/**
 * Captions or on-screen lines (four words or more) a post repeats word for
 * word: all of a short one, or five words in a row of a longer one. Quoted
 * text is left out, as longestSharedRun does.
 */
export function findRetoldCaptions(post: string, captions: string[]): string[] {
  return captions.filter(caption => {
    const length = words(caption).length
    if (length < 4) return false
    return longestSharedRun(post, [caption]).length >= Math.min(5, length)
  })
}

export interface RepeatedWording {
  /** Content words used more often than the post's length allows. */
  words: Array<{ word: string; count: number }>
  /** Three-word phrases, with two content words or more, used twice or more. */
  phrases: string[]
  /** Words more sentences open on than the limit allows. */
  openings: string[]
}

/** "customers" and "customer" count as one word; "business" stays. */
const stemOf = (word: string) =>
  word.length > 5 && word.endsWith('s') && !word.endsWith('ss')
    ? word.slice(0, -1)
    : word

const isContentWord = (word: string, minLength: number) =>
  word.length >= minLength &&
  !REPETITION_STOPWORDS.has(word) &&
  /\p{L}/u.test(word)

/**
 * Wording a post leans on: one word used again and again, one phrase said
 * twice, sentences opening the same way. `ignore` holds names expected to
 * recur (the product's, the brand's), which are not counted.
 */
export function findRepeatedWording(
  text: string,
  options: { ignore?: string[]; limits?: Partial<RepetitionLimits> } = {}
): RepeatedWording {
  const limits = { ...DEFAULT_REPETITION_LIMITS, ...options.limits }
  const ignored = new Set(
    (options.ignore ?? []).flatMap(name => words(name)).map(stemOf)
  )
  const tokens = words(text)

  const counts = new Map<string, { word: string; count: number }>()
  for (const token of tokens) {
    if (!isContentWord(token, 5)) continue
    const stem = stemOf(token)
    if (ignored.has(stem)) continue
    const seen = counts.get(stem)
    if (seen) seen.count++
    else counts.set(stem, { word: token, count: 1 })
  }
  const allowed = Math.max(
    limits.wordUses,
    Math.ceil(tokens.length / limits.wordsPerUse)
  )
  const overused = Array.from(counts.values())
    .filter(entry => entry.count > allowed)
    .sort((a, b) => b.count - a.count)

  const phraseCounts = new Map<string, number>()
  for (let i = 0; i + 2 < tokens.length; i++) {
    const three = tokens.slice(i, i + 3)
    const content = three.filter(w => isContentWord(w, 4))
    if (content.length < 2) continue
    if (content.every(w => ignored.has(stemOf(w)))) continue
    const key = three.join(' ')
    phraseCounts.set(key, (phraseCounts.get(key) ?? 0) + 1)
  }
  const phrases = Array.from(phraseCounts)
    .filter(([, count]) => count >= 2)
    .map(([phrase]) => phrase)

  const openingCounts = new Map<string, number>()
  for (const sentence of sentencesOf(text)) {
    const first = words(sentence)[0]
    if (!first || REPETITION_FREE_OPENINGS.has(first)) continue
    openingCounts.set(first, (openingCounts.get(first) ?? 0) + 1)
  }
  const openings = Array.from(openingCounts)
    .filter(([, count]) => count > limits.sameOpenings)
    .map(([word]) => word)

  return { words: overused, phrases, openings }
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
