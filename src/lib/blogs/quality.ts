import { extractNumbers } from '../ai/skills/ideation/guard'
import type { LintFinding } from '../lint/run-linter'
import { ctaSimilarity } from '../lint/writing-checks'
import {
  GENERIC_OPENING_PATTERNS,
  GENERIC_PHRASE_PATTERNS,
  RESEARCH_NARRATION_PATTERNS,
  VIEW_QUALIFIER_PATTERN
} from '../lint/writing-rules'
import { normalizeUrlForCompare } from '../urls'
import { docSentences, proseParagraphs, sentenceRanges, type DocSentence } from './citations'
import {
  blockText,
  countWords,
  docSections,
  docText,
  inlineText,
  type BlogDoc
} from './doc'
import { KIND_PROFILES } from './kinds'
import { isQuestionHeading } from './questions'
import { containsKeyword, keywordCount } from './seo'
import type {
  BlogKind,
  BlogSource,
  FaqItem,
  PlanEntity,
  SearchIntent,
  SearchQuestion
} from './types'

/**
 * The engine's quality checks beyond the truth, writing and SEO checks that
 * came before: invented attributions and quotations, weak or dated sources
 * behind claims, repetition, generic AI wording, how well the piece answers
 * (answer-first sections, question headings, entities, an early definition)
 * and keyword stuffing. Pure: the pipeline runs them after writing, the save
 * path after every edit. The sentence finders feed the pipeline's fix pass;
 * `runQualityChecks` turns everything into findings for the checks panel.
 */

// ---------------------------------------------------------------------------
// Groups (the checks panel)
// ---------------------------------------------------------------------------

export const CHECK_GROUPS = ['accuracy', 'sources', 'writing', 'search'] as const
export type CheckGroup = (typeof CHECK_GROUPS)[number]

export const CHECK_GROUP_LABELS: Record<CheckGroup, string> = {
  accuracy: 'Accuracy',
  sources: 'Sources',
  writing: 'Writing',
  search: 'Search & AI answers'
}

const ACCURACY_RULES = new Set([
  'unsupported_figures',
  'citation_figure',
  'uncited_figure',
  'unlabelled_specific',
  'invented_attribution',
  'unverified_quote',
  'seo_citations'
])
const SOURCE_RULES = new Set([
  'weak_source_claim',
  'dated_source',
  'source_diversity',
  'own_sources_only'
])
const SEARCH_RULES = new Set([
  'answer_first',
  'faq_non_answer',
  'question_headings',
  'entity_coverage',
  'definition_early'
])

/** The group a check belongs to; anything unknown reads as writing. */
export function checkGroup(rule: string): CheckGroup {
  if (ACCURACY_RULES.has(rule)) return 'accuracy'
  if (SOURCE_RULES.has(rule)) return 'sources'
  if (SEARCH_RULES.has(rule) || rule.startsWith('seo_')) return 'search'
  return 'writing'
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const lower = (text: string) => text.toLowerCase()

/** Text reduced to lowercase words and digits, one space apart ("Sana's" reads as "sana"). */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/(\p{L})['’]s\b/gu, '$1')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const excerpt = (sentence: string, max = 90) =>
  sentence.length > max ? `${sentence.slice(0, max - 3)}…` : sentence

const quoteList = (values: string[]) => values.map(v => `"${v}"`).join(', ')

/** Sentences of the FAQ answers, as plain text. */
function faqSentences(faq: FaqItem[]): string[] {
  return faq.flatMap(item =>
    sentenceRanges(item.answer)
      .map(([from, to]) => item.answer.slice(from, to).trim())
      .filter(Boolean)
  )
}

/** Sentences a reader takes as the author's own claims: not in example boxes or quotes. */
const claimSentences = (doc: BlogDoc) =>
  docSentences(doc).filter(sentence => !sentence.inExample && !sentence.inQuote)

/** Everything a source says about itself: title, publisher, page address, passages. */
function sourceText(source: BlogSource): string {
  return [
    source.title,
    source.publisher ?? '',
    source.url ?? '',
    ...(source.quotes ?? []),
    source.quote
  ].join('\n')
}

/** Sources by the page they link to. */
const byPage = (sources: BlogSource[]) =>
  new Map(
    sources
      .filter(source => source.url)
      .map(source => [normalizeUrlForCompare(source.url!), source])
  )

const linkedSources = (sentence: DocSentence, pages: Map<string, BlogSource>) =>
  sentence.links
    .map(href => pages.get(normalizeUrlForCompare(href)))
    .filter((source): source is BlogSource => Boolean(source))

// ---------------------------------------------------------------------------
// Accuracy: invented attributions and quotations
// ---------------------------------------------------------------------------

/** A run of capitalised words (with the small joining words names carry). */
const NAME = String.raw`((?:[A-Z][\p{L}\p{N}&.'’-]*|[A-Z]{2,})(?:\s+(?:[A-Z][\p{L}\p{N}&.'’-]*|of|for|and|&|de|du|la|the|on)){0,5})`

const ATTRIBUTION_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b[Aa]ccording\s+to\s+(?:the\s+|a\s+|an\s+)?(?:\d{4}\s+)?${NAME}`, 'gu'),
  new RegExp(
    String.raw`\b(?:study|survey|report|analysis|poll|paper|research|index|census|white\s*paper|benchmark|forecast)\s+(?:by|from)\s+(?:the\s+)?${NAME}`,
    'gu'
  ),
  new RegExp(
    String.raw`${NAME}(?:'s|’s)\s+(?:\d{4}\s+)?(?:\p{L}+\s+){0,2}(?:study|survey|report|research|analysis|data|index|poll|forecast|findings|benchmark)\b`,
    'gu'
  ),
  new RegExp(
    String.raw`${NAME}\s+(?:found|finds|reports|reported|estimates|estimated|says|said|surveyed|predicts|predicted|notes|noted|projects|projected|calculated)\b`,
    'gu'
  )
]

/** Which of ATTRIBUTION_PATTERNS is "X's study". */
const POSSESSIVE_PATTERN = 2

/** Words that open sentences or describe groups: never a named source on their own. */
const NOT_A_NAME = new Set(
  'the this that these those it its they we our you your i a an one some many most more few each every all any no research studies study surveys survey reports report data experts analysts sources buyers customers companies businesses teams retailers leaders managers owners users people firms brands organizations organisations industry market markets government governments according however yet but and so also then first second third finally overall today recently here there when while if as in on at by for with what how why who which where'.split(
    ' '
  )
)

/** Words a source's name shares with many others: no evidence the name is known. */
const GENERIC_NAME_WORDS = new Set(
  'report reports survey surveys study studies institute research group company companies association council global international national bureau department center centre university foundation index data business review annual state inc ltd llc corp corporation the of and for on de du la'.split(
    ' '
  )
)

/** The words of a name that identify it: capitalised, not generic. */
function identifyingWords(name: string): string[] {
  return words(name)
    .split(' ')
    .filter(word => word.length >= 2 && !GENERIC_NAME_WORDS.has(word))
}

/** A named source the piece could not have got from its sources or the author. */
function looksLikeName(name: string, atSentenceStart: boolean): boolean {
  const parts = name.trim().split(/\s+/)
  const first = parts[0] ?? ''
  if (parts.length === 1) {
    if (NOT_A_NAME.has(first.toLowerCase())) return false
    // A lone capitalised word opening a sentence is usually just a word,
    // unless it is written like a name: an acronym or a capital inside it.
    if (atSentenceStart && !/^[A-Z]{2,}$/.test(first) && !/\p{Ll}\p{Lu}/u.test(first)) {
      return false
    }
  }
  if (NOT_A_NAME.has(first.toLowerCase()) && parts.length <= 2) return false
  return identifyingWords(name).length > 0
}

export type InventedAttribution = { sentence: string; name: string }

/**
 * Sentences that credit a named organisation, study or person no source,
 * nor the author's details, mentions: "according to Forrester", "a study by
 * MIT", "Gartner found". A fabricated authority reads as real; this is the
 * hallucination a figure check cannot see.
 */
export function findInventedAttributions(input: {
  doc: BlogDoc
  faq: FaqItem[]
  sources: BlogSource[]
  /** The author's details, brief and company: names they may cite. */
  authorText: string
}): InventedAttribution[] {
  const known = words([input.authorText, ...input.sources.map(sourceText)].join('\n'))
  const knownWords = new Set(known.split(' '))
  const knownCompact = known.replace(/ /g, '')
  const isKnown = (name: string) => {
    const ids = identifyingWords(name)
    if (ids.length === 0) return true
    if (known.includes(words(name))) return true
    // "The Economic Times" is economictimes.indiatimes.com.
    if (ids.join('').length >= 6 && knownCompact.includes(ids.join(''))) return true
    return ids.some(word => word.length >= 3 && knownWords.has(word))
  }
  const sentences = [
    ...claimSentences(input.doc).map(sentence => sentence.text),
    ...faqSentences(input.faq)
  ]
  const found: InventedAttribution[] = []
  const seen = new Set<string>()
  for (const sentence of sentences) {
    for (const [index, pattern] of ATTRIBUTION_PATTERNS.entries()) {
      for (const match of sentence.matchAll(new RegExp(pattern.source, pattern.flags))) {
        const name = (match[1] ?? '').replace(/[.,;:]+$/, '').trim()
        const atStart = sentence.slice(0, match.index).trim() === ''
        // "Gartner's survey": a possessive before a study names its owner,
        // wherever it sits; "Retailers found" opening a sentence does not.
        const possessive = index === POSSESSIVE_PATTERN
        if (!name || !looksLikeName(name, atStart && !possessive && match[0].startsWith(name))) continue
        if (isKnown(name)) continue
        const key = `${sentence}\n${name}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ sentence, name })
      }
    }
  }
  return found
}

/** Quoted words: straight or curly double quotes around them. */
const QUOTED = /[“"]([^“”"]{3,400})[”"]/g
/** A quotation this long is a claim that someone said it. */
const QUOTE_MIN_WORDS = 6

export type UnverifiedQuote = { sentence: string; quote: string }

/**
 * Quotations of six words or more that appear in no source, nor in the
 * author's details or brief: words put in someone's mouth. Hypothetical
 * example boxes may quote their made-up people.
 */
export function findUnverifiedQuotes(input: {
  doc: BlogDoc
  faq: FaqItem[]
  sources: BlogSource[]
  authorText: string
}): UnverifiedQuote[] {
  const known = words([input.authorText, ...input.sources.map(sourceText)].join('\n'))
  const sentences = [
    ...docSentences(input.doc)
      .filter(sentence => !sentence.inExample)
      .map(sentence => sentence.text),
    ...faqSentences(input.faq)
  ]
  const found: UnverifiedQuote[] = []
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(QUOTED)) {
      const quote = (match[1] ?? '').trim()
      if (countWords(quote) < QUOTE_MIN_WORDS) continue
      if (known.includes(words(quote))) continue
      found.push({ sentence, quote })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Ratings that do not carry a figure on their own. */
const WEAK_TIERS = new Set(['social', 'forum'])
/** Newsletters carry a figure only when the sentence names them. */
const NAMED_ONLY_TIERS = new Set(['newsletter'])
/** Figures older than this, with no year in the sentence, read as current when they are not. */
const DATED_YEARS = 5
const YEAR = /\b(?:19|20)\d{2}\b/

/** Whether a sentence names a source: its publisher, a title word, or its site. */
function namesSource(sentence: string, source: BlogSource): boolean {
  const text = lower(sentence)
  if (source.publisher && text.includes(lower(source.publisher))) return true
  if (/\baccording to\b/i.test(sentence)) return true
  try {
    const host = new URL(source.url ?? '').hostname.replace(/^www\./, '')
    const label = host.split('.')[0]
    if (label && label.length >= 3 && text.includes(label)) return true
  } catch {
    // Not a page: nothing to name.
  }
  return identifyingWords(source.title)
    .filter(word => word.length >= 5)
    .some(word => words(text).split(' ').includes(word))
}

export type WeakSourceClaim = { sentence: string; sourceId: string; why: string }

/**
 * Figures resting only on weak footing: a social post or forum thread, a
 * newsletter the sentence does not name, or a snippet seen only in search
 * results and stated as plain fact. An unrated site is not weak by itself:
 * it is the default for most primary publishers.
 */
export function findWeakSourceClaims(doc: BlogDoc, sources: BlogSource[]): WeakSourceClaim[] {
  const pages = byPage(sources)
  const found: WeakSourceClaim[] = []
  for (const sentence of claimSentences(doc)) {
    if (extractNumbers(sentence.text).length === 0) continue
    const linked = linkedSources(sentence, pages)
    if (linked.length === 0) continue
    const reasons = linked.map(source => {
      const tier = source.rating?.tier
      if (tier && WEAK_TIERS.has(tier)) return `a ${tier} source`
      if (tier && NAMED_ONLY_TIERS.has(tier) && !namesSource(sentence.text, source)) {
        return 'a newsletter the sentence does not name'
      }
      if (source.verifiedOn === 'snippet' && !namesSource(sentence.text, source)) {
        return 'a search snippet, stated as plain fact'
      }
      return null
    })
    // One sound source behind the sentence is enough.
    if (reasons.some(reason => reason === null)) continue
    found.push({ sentence: sentence.text, sourceId: linked[0]!.id, why: reasons[0]! })
  }
  return found
}

/** A figure that is a statistic (a share, an amount, a magnitude), not an age or a count. */
const isStatistic = (figure: string) =>
  /%|[$£€₹¥]|million|billion|trillion|thousand|lakh|crore/i.test(figure)

/** Statistics from sources older than DATED_YEARS whose sentence gives no year. */
export function findDatedClaims(
  doc: BlogDoc,
  sources: BlogSource[],
  now: Date
): Array<{ sentence: string; sourceId: string; year: number }> {
  const pages = byPage(sources)
  const cutoff = now.getUTCFullYear() - DATED_YEARS
  const found: Array<{ sentence: string; sourceId: string; year: number }> = []
  for (const sentence of claimSentences(doc)) {
    if (!extractNumbers(sentence.text).some(isStatistic) || YEAR.test(sentence.text)) continue
    for (const source of linkedSources(sentence, pages)) {
      const year = Number.parseInt((source.publishedAt ?? '').slice(0, 4), 10)
      if (Number.isFinite(year) && year < cutoff) {
        found.push({ sentence: sentence.text, sourceId: source.id, year })
        break
      }
    }
  }
  return found
}

/** The site a source is: its publisher, else its host. */
function publisherOf(source: BlogSource): string {
  if (source.publisher?.trim()) return lower(source.publisher.trim())
  try {
    return new URL(source.url ?? '').hostname.replace(/^www\./, '')
  } catch {
    return source.id
  }
}

const isOwnSource = (source: BlogSource) =>
  source.origin === 'knowledge' || source.ownPage === true || source.rating?.tier === 'own'

// ---------------------------------------------------------------------------
// Writing: repetition and generic wording
// ---------------------------------------------------------------------------

const PHRASE_WORDS = 4
const PHRASE_REPEATS = 3
const STOP = new Set(
  'a an the of to in on for and or is are was were be been it its this that with as at by from your you we our their they not can will more than but if so do does'.split(
    ' '
  )
)

/**
 * Four-word phrases used three times or more, keywords and entity names
 * aside (a piece repeats its subject on purpose). The most repeated first.
 */
export function findRepeatedPhrases(
  paragraphs: string[],
  exempt: string[]
): Array<{ phrase: string; count: number }> {
  const blocked = exempt.map(words).filter(Boolean)
  const counts = new Map<string, number>()
  for (const paragraph of paragraphs) {
    let text = words(paragraph)
    for (const phrase of blocked) text = text.split(phrase).join(' | ')
    for (const sentence of text.split('|')) {
      const tokens = sentence.split(' ').filter(Boolean)
      for (let i = 0; i + PHRASE_WORDS <= tokens.length; i++) {
        const gram = tokens.slice(i, i + PHRASE_WORDS)
        if (gram.filter(token => !STOP.has(token)).length < 2) continue
        const key = gram.join(' ')
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }
  const repeated = [...counts.entries()]
    .filter(([, count]) => count >= PHRASE_REPEATS)
    .sort((a, b) => b[1] - a[1])
  // A longer repeated run shows up as several overlapping phrases: keep one.
  const kept: Array<{ phrase: string; count: number }> = []
  for (const [phrase, count] of repeated) {
    const tokens = phrase.split(' ')
    const overlaps = kept.some(k => {
      const theirs = k.phrase.split(' ')
      return tokens.slice(1).join(' ') === theirs.slice(0, -1).join(' ') ||
        theirs.slice(1).join(' ') === tokens.slice(0, -1).join(' ')
    })
    if (!overlaps) kept.push({ phrase, count })
  }
  return kept
}

/** Articles say nothing about how a sentence opens. */
const OPENER_SKIP = new Set(['the', 'a', 'an'])
const OPENER_SHARE = 0.15
const OPENER_MIN_SENTENCES = 20

/** Three sentences in a row opening the same way, or one opening word everywhere. */
export function findRepeatedOpeners(sentences: string[]): string | null {
  const openers = sentences.map(sentence => words(sentence).split(' ')[0] ?? '')
  for (let i = 0; i + 2 < openers.length; i++) {
    const word = openers[i]!
    if (word && !OPENER_SKIP.has(word) && openers[i + 1] === word && openers[i + 2] === word) {
      return `Three sentences in a row open with "${word}".`
    }
  }
  if (openers.length >= OPENER_MIN_SENTENCES) {
    const counts = new Map<string, number>()
    for (const word of openers) {
      if (word && !OPENER_SKIP.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
    }
    for (const [word, count] of counts) {
      if (count / openers.length > OPENER_SHARE) {
        return `${count} of ${openers.length} sentences open with "${word}".`
      }
    }
  }
  return null
}

/** Generic AI phrases the author's own posts do not use, with the sentences they are in. */
export function findGenericWording(
  sentences: string[],
  authorPosts: string
): Array<{ sentence: string; phrases: string[] }> {
  const author = lower(authorPosts)
  const found: Array<{ sentence: string; phrases: string[] }> = []
  for (const sentence of sentences) {
    const phrases: string[] = []
    for (const pattern of GENERIC_PHRASE_PATTERNS) {
      const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(sentence)
      if (!match) continue
      const phrase = lower(match[0].trim())
      if (author && author.includes(phrase)) continue
      if (!phrases.includes(phrase)) phrases.push(phrase)
    }
    if (phrases.length > 0) found.push({ sentence, phrases })
  }
  return found
}

/** Generic phrases a piece may hold before the check speaks: one per 800 words. */
export const genericAllowance = (wordCount: number) => Math.floor(wordCount / 800)

// ---------------------------------------------------------------------------
// Confidence: the subject, not the research
// ---------------------------------------------------------------------------

/** Sentences about the research or the writing instead of the subject, with the phrases. */
export function findResearchNarration(
  sentences: string[]
): Array<{ sentence: string; phrases: string[] }> {
  const found: Array<{ sentence: string; phrases: string[] }> = []
  for (const sentence of sentences) {
    const phrases = RESEARCH_NARRATION_PATTERNS.flatMap(pattern => {
      const match = pattern.exec(sentence)
      return match ? [lower(match[0].trim())] : []
    })
    if (phrases.length > 0) found.push({ sentence, phrases: Array.from(new Set(phrases)) })
  }
  return found
}

/** "In our view" and its kin a piece may use: a contested call or two. */
export const VIEW_QUALIFIER_ALLOWANCE = 2

/**
 * The sentences that mark a judgment as the author's beyond the allowance,
 * in order, with the qualifier each uses: the first ones are kept.
 */
export function findStackedQualifiers(
  sentences: string[]
): Array<{ sentence: string; phrase: string }> {
  const marked = sentences.flatMap(sentence => {
    const match = new RegExp(VIEW_QUALIFIER_PATTERN.source, 'i').exec(sentence)
    return match ? [{ sentence, phrase: lower(match[0]) }] : []
  })
  return marked.slice(VIEW_QUALIFIER_ALLOWANCE)
}

/** How often the body may state one statistic: where it lands, and once more. */
const FIGURE_REPEATS = 2

/**
 * Statistics the body states again and again (a live article gave "$13
 * billion" five times, each time re-explaining where it came from): each
 * sentence past the second that restates one, with the figure and the
 * sentence that gave it first. The key-takeaways box, tables, quotes and
 * examples do not count.
 */
export function findRepeatedFigures(
  doc: BlogDoc
): Array<{ sentence: string; figure: string; first: string }> {
  const seen = new Map<string, { first: string; count: number }>()
  const found: Array<{ sentence: string; figure: string; first: string }> = []
  for (const sentence of docSentences(doc)) {
    if (sentence.inTable || sentence.inQuote || sentence.inExample || sentence.inTakeaways) continue
    const figures = Array.from(
      new Set(extractNumbers(sentence.text).filter(isStatistic).map(lower))
    )
    let flagged = false
    for (const figure of figures) {
      const kept = seen.get(figure)
      if (!kept) {
        seen.set(figure, { first: sentence.text, count: 1 })
        continue
      }
      kept.count++
      if (kept.count > FIGURE_REPEATS && !flagged) {
        found.push({ sentence: sentence.text, figure, first: kept.first })
        flagged = true
      }
    }
  }
  return found
}

/** How alike two sentences of a paragraph must be to echo, and how long. */
const ECHO_SIMILARITY = 0.5
const ECHO_MIN_WORDS = 12

/**
 * How many content words two sentences share, out of the longer one's, a
 * plural read as its singular ("prices" is "price"), so a reworded echo
 * matches while a short sentence inside a longer one's words does not.
 */
function echoSimilarity(a: string, b: string): number {
  const content = (text: string) =>
    new Set(words(text).split(' ').filter(w => w.length > 3).map(w => w.replace(/s$/, '')))
  const setA = content(a)
  const setB = content(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let shared = 0
  for (const w of setA) if (setB.has(w)) shared++
  return shared / Math.max(setA.size, setB.size)
}

/**
 * A sentence that says again what an earlier sentence of the same paragraph
 * just said, in other words (a live article: "…which quotes a view that a
 * price floor may hurt investment… It quotes a view that a floor on prices
 * may affect investment…"), with the sentence it echoes. Short sentences are
 * left alone: parallel ones ("Supplier A measures… Supplier B measures…")
 * share most of their words on purpose.
 */
export function findEchoedSentences(doc: BlogDoc): Array<{ sentence: string; echoes: string }> {
  const found: Array<{ sentence: string; echoes: string }> = []
  for (const paragraph of proseParagraphs(doc)) {
    const sentences = sentenceRanges(paragraph)
      .map(([from, to]) => paragraph.slice(from, to).trim())
      .filter(sentence => countWords(sentence) >= ECHO_MIN_WORDS)
    sentences.forEach((sentence, i) => {
      const echoed = sentences
        .slice(0, i)
        .find(before => echoSimilarity(before, sentence) >= ECHO_SIMILARITY)
      if (echoed) found.push({ sentence, echoes: echoed })
    })
  }
  return found
}

/** First sentences of an FAQ answer that answer nothing. */
const NON_ANSWER =
  /^(?:(?:we|i)\s+(?:can't|can’t|cannot|can\s+not)\s+say|no\s+one\s+(?:knows|can\s+say)|(?:there\s+is|we\s+have)\s+no\s+(?:single\s+|simple\s+|reliable\s+|clear\s+)*(?:published\s+)?(?:answer|figure|data|number)|no\s+(?:source|study|published\s+figure)\s+(?:we\s+know\s+of\s+)?(?:settles|answers|gives|says)|it\s+(?:varies|depends)\s*[.!]?$|(?:it\s+)?(?:varies|depends)(?:\s+(?:a\s+lot|widely|greatly))?\s*,?\s*and\s+(?:we|there)\b)/i

/**
 * FAQ answers that open without answering ("We can't say", "It varies, and
 * we have no figure"): useless to a reader and to an answer engine, which
 * quotes the first sentence. With the sentence to rewrite.
 */
export function findFaqNonAnswers(
  faq: FaqItem[]
): Array<{ question: string; sentence: string }> {
  return faq.flatMap(item => {
    const [range] = sentenceRanges(item.answer)
    const first = range ? item.answer.slice(range[0], range[1]).trim() : ''
    return first && NON_ANSWER.test(first) ? [{ question: item.question, sentence: first }] : []
  })
}

/**
 * The piece's last sentence when it is a question to the reader: a social
 * post's engagement ask ("What does your own count show?"), which a web page
 * cannot answer. Null when it ends on a statement.
 */
export function closingQuestion(doc: BlogDoc): string | null {
  const last = docSentences(doc)
    .filter(sentence => !sentence.inTable && !sentence.inQuote && !sentence.inExample)
    .at(-1)
  return last && /\?["'”’)]*$/.test(last.text.trim()) ? last.text : null
}

// ---------------------------------------------------------------------------
// Search & AI answers
// ---------------------------------------------------------------------------

/** Openings that point back to something the lifted paragraph will not have. */
const BACK_REFERENCE =
  /^(?:this|that|these|those|it|they|such|as\s+(?:mentioned|noted|discussed|we\s+saw)|building\s+on|similarly|likewise|also|additionally|moreover|furthermore)\b/i
const LEAD_MIN_WORDS = 15
const LEAD_MAX_WORDS = 90

/**
 * Sections that do not open with a self-contained answer: the first thing
 * under the H2 is not a paragraph, is too short or too long to answer, or
 * points back to the text before it.
 */
export function findWeakLeads(doc: BlogDoc): Array<{ heading: string; why: string }> {
  const out: Array<{ heading: string; why: string }> = []
  for (const section of docSections(doc).slice(1)) {
    const heading = section.heading ?? ''
    const first = section.blocks.slice(1).find(block => block.type !== 'image')
    if (!first) continue
    if (first.type !== 'paragraph') {
      out.push({ heading, why: 'opens with a list, table or box instead of an answer' })
      continue
    }
    const text = inlineText(first.content).trim()
    const count = countWords(text)
    if (count < LEAD_MIN_WORDS) out.push({ heading, why: `opens with only ${count} words` })
    else if (count > LEAD_MAX_WORDS) out.push({ heading, why: `opens with a ${count}-word paragraph` })
    else if (BACK_REFERENCE.test(text)) {
      out.push({ heading, why: `opens by pointing back ("${text.split(/\s+/).slice(0, 2).join(' ')}…")` })
    }
  }
  return out
}

/**
 * The ways a text may name an entity: its full name, the part before a colon
 * or bracket ("NICE guideline NG143: Fever in under 5s" → "NICE guideline
 * NG143"), and an abbreviation it gives in brackets ("(NICE)").
 */
export function entityNames(name: string): string[] {
  const short = name.split(/\s*[:(–—]\s*/)[0] ?? ''
  const bracketed = /\(([^)]{2,40})\)/.exec(name)?.[1] ?? ''
  return Array.from(new Set([name, short, bracketed].map(words).filter(n => n.length >= 2)))
}

/** Planned entities the text never names. */
export function missingEntities(doc: BlogDoc, faq: FaqItem[], entities: PlanEntity[]): string[] {
  const text = ` ${words([docText(doc), ...faq.map(f => `${f.question} ${f.answer}`)].join(' '))} `
  return entities
    .filter(entity => {
      const names = entityNames(entity.name)
      return names.length > 0 && !names.some(name => text.includes(` ${name} `))
    })
    .map(entity => entity.name)
}

const DEFINING = /\b(?:is|are|refers\s+to|means|describes|is\s+defined\s+as|stands\s+for)\b/i

/**
 * The term a planned definition defines: its words before "is", "means" and
 * the like, without a lead-in ("According to the NHS, a high temperature
 * (fever) in a child is …" → "a high temperature (fever) in a child").
 */
export function definedTerm(definition: string): string {
  const body = definition.replace(/^\s*according\s+to\s+[^,]{1,80},\s*/i, '')
  const match = DEFINING.exec(body)
  if (!match || match.index === 0) return ''
  const term = body.slice(0, match.index).trim().replace(/^(?:an?|the)\s+/i, '')
  return term.split(/\s+/).length <= 8 ? term : ''
}

/**
 * Whether the first 200 words define the term ("X is …"): the term the
 * plan's definition defines, else the keyword. A bracketed alternative in
 * the term ("high temperature (fever)") counts too.
 */
export function definesEarly(doc: BlogDoc, term: string): boolean {
  const names = [term, ...entityNames(term)].filter(Boolean)
  const sentences = docSentences(doc).map(sentence => sentence.text)
  let seen = 0
  for (const sentence of sentences) {
    if (seen >= 200) break
    seen += countWords(sentence)
    if (DEFINING.test(sentence) && names.some(name => containsKeyword(sentence, name))) return true
  }
  return false
}

const SECTION_DENSITY_PCT = 3
const SECTION_MAX_USES = 4
const SECTION_MIN_WORDS = 100
const SECONDARY_DENSITY_PCT = 1.5

/** What makes the keyword use read as stuffing, one line each; empty when it reads naturally. */
export function keywordStuffing(input: {
  doc: BlogDoc
  primaryKeyword: string
  keywords: string[]
}): { problems: string[]; sentences: string[] } {
  const keyword = input.primaryKeyword.trim()
  const problems: string[] = []
  const flagged = new Set<string>()
  if (!keyword) return { problems, sentences: [] }
  const sections = docSections(input.doc).slice(1)
  for (const section of sections) {
    const body = section.blocks.slice(1).map(blockText).join('\n')
    const count = keywordCount(body, keyword)
    const total = countWords(body)
    if (total < SECTION_MIN_WORDS) continue
    if ((count / total) * 100 > SECTION_DENSITY_PCT || count >= SECTION_MAX_USES) {
      problems.push(
        `"${section.heading}" uses the keyword ${count} times in ${total} words.`
      )
    }
  }
  const headings = sections.map(section => section.heading ?? '')
  const inHeadings = headings.filter(heading => containsKeyword(heading, keyword)).length
  if (headings.length >= 2 && inHeadings > headings.length / 2) {
    problems.push(`The keyword is in ${inHeadings} of ${headings.length} section headings.`)
  }
  const sentences = docSentences(input.doc).map(sentence => sentence.text)
  for (let i = 0; i + 2 < sentences.length; i++) {
    const run = sentences.slice(i, i + 3)
    if (run.every(sentence => containsKeyword(sentence, keyword))) {
      problems.push(`Three sentences in a row use the keyword ("${excerpt(run[0]!, 60)}").`)
      run.slice(1).forEach(sentence => flagged.add(sentence))
      break
    }
  }
  const body = [
    ...sections.flatMap(section => section.blocks.slice(1).map(blockText)),
    ...docSections(input.doc)[0]!.blocks.map(blockText)
  ].join('\n')
  const total = countWords(body)
  for (const secondary of input.keywords) {
    const count = keywordCount(body, secondary)
    if (total > 0 && count > 2 && (count / total) * 100 > SECONDARY_DENSITY_PCT) {
      problems.push(`"${secondary}" appears ${count} times (${((count / total) * 100).toFixed(1)}% of words).`)
    }
  }
  return { problems, sentences: [...flagged] }
}

// ---------------------------------------------------------------------------
// The findings
// ---------------------------------------------------------------------------

export type QualityInput = {
  kind: BlogKind
  content: BlogDoc
  faq: FaqItem[]
  sources: BlogSource[]
  primaryKeyword: string
  keywords: string[]
  searchIntent: SearchIntent | ''
  /** The author's details, brief and company: what they may state and cite. */
  authorText: string
  /** The author's own posts: phrases they use are their voice, not generic. */
  authorPosts?: string
  /** The voice's formality, 1-5; null when never analysed. */
  formality?: number | null
  /** Web research ran for this piece. */
  researchUsed: boolean
  /** Questions people search, gathered for the piece. */
  questions?: SearchQuestion[]
  /** What the plan said the piece covers. */
  entities?: PlanEntity[]
  /** The definition the plan wanted early. */
  definition?: string
  now?: Date
}

const MAX_LISTED = 3

export function runQualityChecks(input: QualityInput): LintFinding[] {
  const findings: LintFinding[] = []
  const pass = (rule: string, message: string) =>
    findings.push({ rule, severity: 'info', message, passed: true })
  const fail = (rule: string, severity: 'error' | 'warning', message: string) =>
    findings.push({ rule, severity, message, passed: false })
  const profile = KIND_PROFILES[input.kind]
  const sentences = docSentences(input.content)
  const prose = sentences.filter(sentence => !sentence.inTable)
  const paragraphs = proseParagraphs(input.content)
  const wordCount = countWords(paragraphs.join(' '))
  const hasWords = wordCount > 0
  if (!hasWords) return findings

  // Accuracy
  const evidence = {
    doc: input.content,
    faq: input.faq,
    sources: input.sources,
    authorText: input.authorText
  }
  const invented = findInventedAttributions(evidence)
  if (invented.length > 0) {
    for (const found of invented.slice(0, MAX_LISTED)) {
      fail(
        'invented_attribution',
        'error',
        `"${excerpt(found.sentence)}" credits ${found.name}, which no source or detail of yours mentions. Link the source that says it, or remove the attribution.`
      )
    }
  } else pass('invented_attribution', 'Every named source is one the piece was given.')

  const quotes = findUnverifiedQuotes(evidence)
  if (quotes.length > 0) {
    for (const found of quotes.slice(0, MAX_LISTED)) {
      fail(
        'unverified_quote',
        'error',
        `The quotation "${excerpt(found.quote, 70)}" is in no source. Quote only words a source has, or paraphrase without quotation marks.`
      )
    }
  } else pass('unverified_quote', 'Every quotation is word for word from a source.')

  // Sources
  const weak = findWeakSourceClaims(input.content, input.sources)
  if (weak.length > 0) {
    for (const found of weak.slice(0, MAX_LISTED)) {
      fail(
        'weak_source_claim',
        'warning',
        `"${excerpt(found.sentence)}" rests only on ${found.why}. Name the source in the sentence, or use a stronger one that gives the figure.`
      )
    }
  } else pass('weak_source_claim', 'No figure rests only on a weak source.')

  const dated = findDatedClaims(input.content, input.sources, input.now ?? new Date())
  if (dated.length > 0) {
    for (const found of dated.slice(0, MAX_LISTED)) {
      fail(
        'dated_source',
        'warning',
        `"${excerpt(found.sentence)}" uses a figure from ${found.year} without saying so. Give the year, or find newer data.`
      )
    }
  }

  const pages = byPage(input.sources)
  const citations = prose.flatMap(sentence => linkedSources(sentence, pages))
  if (input.researchUsed && citations.length > 0) {
    const publishers = new Set(citations.filter(s => !isOwnSource(s)).map(publisherOf))
    const needed = input.kind === 'article' ? 3 : 2
    const counts = new Map<string, number>()
    for (const source of citations) counts.set(source.id, (counts.get(source.id) ?? 0) + 1)
    const top = Math.max(...counts.values())
    if (publishers.size < needed) {
      fail(
        'source_diversity',
        'warning',
        `The piece cites ${publishers.size} outside publisher${publishers.size === 1 ? '' : 's'}; ${input.kind === 'article' ? 'an article' : 'a post'} should draw on at least ${needed}.`
      )
    } else if (citations.length >= 4 && top / citations.length > 0.5) {
      fail(
        'source_diversity',
        'warning',
        `One source carries ${top} of ${citations.length} citations. Spread the evidence across your sources.`
      )
    } else pass('source_diversity', `${publishers.size} publishers cited.`)

    const informational = !input.searchIntent || input.searchIntent === 'informational'
    if (informational && citations.length >= 2 && citations.every(isOwnSource)) {
      fail(
        'own_sources_only',
        'warning',
        'Every citation is your own site. An informational piece earns trust with independent sources.'
      )
    }
  }

  // Writing
  const exempt = [
    input.primaryKeyword,
    ...input.keywords,
    ...(input.entities ?? []).map(entity => entity.name)
  ].filter(Boolean)
  const repeated = findRepeatedPhrases(paragraphs, exempt)
  if (repeated.length > 0) {
    fail(
      'repeated_phrase',
      'warning',
      `${repeated
        .slice(0, MAX_LISTED)
        .map(r => `"${r.phrase}" (${r.count}×)`)
        .join(', ')} repeat${repeated.length === 1 ? 's' : ''}. Say it once, or vary the wording.`
    )
  }
  const openers = findRepeatedOpeners(prose.map(sentence => sentence.text))
  if (openers) fail('repeated_openers', 'warning', `${openers} Vary how sentences start.`)

  const longParagraphs = paragraphs.filter(p => countWords(p) >= 20)
  const echoes = input.faq.filter(item =>
    longParagraphs.some(p => ctaSimilarity(item.answer, p) >= 0.75)
  )
  if (echoes.length > 0) {
    fail(
      'faq_repeats_body',
      'warning',
      `The FAQ answer to "${excerpt(echoes[0]!.question, 70)}" repeats a paragraph of the piece. Answer something the body does not, or cut the question.`
    )
  }

  const generic = findGenericWording(
    [...prose.map(sentence => sentence.text), ...faqSentences(input.faq)],
    input.authorPosts ?? ''
  )
  const genericCount = generic.reduce((sum, found) => sum + found.phrases.length, 0)
  if (genericCount > genericAllowance(wordCount)) {
    const phrases = Array.from(new Set(generic.flatMap(found => found.phrases)))
    fail(
      'generic_wording',
      'warning',
      `${quoteList(phrases.slice(0, 5))} ${phrases.length === 1 ? 'is' : 'are'} generic AI wording. Say the specific thing instead.`
    )
  } else pass('generic_wording', 'No generic AI wording to speak of.')

  const opening = paragraphs[0] ?? ''
  if (GENERIC_OPENING_PATTERNS.some(pattern => pattern.test(opening.trim()))) {
    fail(
      'generic_opening',
      'warning',
      `The piece opens on a stock line ("${excerpt(opening, 60)}"). Open on the answer, a specific situation or a figure.`
    )
  }

  const proseTexts = prose.filter(s => !s.inQuote).map(sentence => sentence.text)
  const narration = findResearchNarration([...proseTexts, ...faqSentences(input.faq)])
  if (narration.length > 0) {
    fail(
      'research_narration',
      'warning',
      `${narration.length} sentence${narration.length === 1 ? ' talks' : 's talk'} about the research instead of the subject (${quoteList(
        narration.slice(0, MAX_LISTED).map(found => excerpt(found.sentence, 60))
      )}). Say the point about the subject, or cut the sentence.`
    )
  } else pass('research_narration', 'The piece talks about its subject, not its research.')

  const echoed = findEchoedSentences(input.content)
  if (echoed.length > 0) {
    fail(
      'echoed_sentence',
      'warning',
      `"${excerpt(echoed[0]!.sentence, 70)}" says again what the sentence before it said. Cut it or make it add something.`
    )
  }

  const stacked = findStackedQualifiers(proseTexts)
  if (stacked.length > 0) {
    fail(
      'view_qualifiers',
      'warning',
      `"In our view" and the like appear ${stacked.length + VIEW_QUALIFIER_ALLOWANCE} times. Keep them for the one or two calls people dispute; state the rest with their reasons.`
    )
  }

  const restated = findRepeatedFigures(input.content)
  if (restated.length > 0) {
    fail(
      'repeated_figure',
      'warning',
      `${quoteList(Array.from(new Set(restated.map(found => found.figure))).slice(0, MAX_LISTED))} ${restated.length === 1 ? 'is' : 'are'} stated again and again. Give a figure once, then build on it.`
    )
  }

  const ending = closingQuestion(input.content)
  if (ending) {
    fail(
      'closing_question',
      'warning',
      `The piece ends on a question ("${excerpt(ending, 70)}"). A reader of a page cannot answer it: end on the next step.`
    )
  }

  // Voice fit for the kind
  const proseSentences = prose.filter(s => !s.inQuote)
  if (profile.checks.maxAverageSentenceWords && proseSentences.length >= 10) {
    const average =
      proseSentences.reduce((sum, s) => sum + countWords(s.text), 0) / proseSentences.length
    if (average > profile.checks.maxAverageSentenceWords) {
      fail(
        'voice_fit',
        'warning',
        `Sentences average ${Math.round(average)} words: heavy for a blog post. Break up the longest ones.`
      )
    }
  }
  if (
    profile.checks.minReaderAddressShare &&
    (input.formality ?? 3) <= 3 &&
    proseSentences.length >= 10
  ) {
    const addressed = proseSentences.filter(s => /\byou(?:r|rs|'re|’re|'ll|’ll|'ve|’ve)?\b/i.test(s.text)).length
    if (addressed / proseSentences.length < profile.checks.minReaderAddressShare) {
      fail(
        'voice_fit',
        'warning',
        'The post barely speaks to the reader. A blog post reads better addressed to "you".'
      )
    }
  }
  if (profile.checks.sourcePerSection && citations.length > 0) {
    const sections = docSections(input.content).slice(1, -1)
    const bare = sections.filter(section => {
      const doc: BlogDoc = { type: 'doc', content: section.blocks }
      return !docSentences(doc).some(sentence => linkedSources(sentence, pages).length > 0)
    })
    if (bare.length > 0 && sections.length > 0) {
      fail(
        'voice_fit',
        'warning',
        `${bare.length} main section${bare.length === 1 ? ' has' : 's have'} no sourced point (${quoteList(bare.slice(0, 2).map(s => s.heading ?? ''))}). An article backs each section with evidence.`
      )
    }
  }
  if (profile.checks.minSentencesPerParagraph && paragraphs.length >= 5) {
    const average =
      paragraphs.reduce((sum, p) => sum + Math.max(1, sentenceRanges(p).length), 0) /
      paragraphs.length
    if (average < profile.checks.minSentencesPerParagraph) {
      fail(
        'voice_fit',
        'warning',
        'Paragraphs are mostly one sentence: choppy for an article. Develop each idea over a few sentences.'
      )
    }
  }

  // Search & AI answers
  const leads = findWeakLeads(input.content)
  if (leads.length > 0) {
    fail(
      'answer_first',
      'warning',
      `${leads.length} section${leads.length === 1 ? '' : 's'} do${leads.length === 1 ? 'es' : ''} not open with a direct answer: ${leads
        .slice(0, MAX_LISTED)
        .map(l => `"${l.heading}" ${l.why}`)
        .join('; ')}.`
    )
  } else pass('answer_first', 'Every section opens with a direct answer.')

  const asked = (input.questions ?? []).filter(q => q.origin === 'people_also_ask')
  const headings = docSections(input.content)
    .slice(1)
    .map(section => section.heading ?? '')
  const intentWantsQuestions =
    !input.searchIntent || input.searchIntent === 'informational' || input.searchIntent === 'commercial'
  if (intentWantsQuestions && asked.length > 0 && headings.length > 0) {
    if (headings.some(isQuestionHeading)) {
      pass('question_headings', 'Headings answer questions people search.')
    } else {
      fail(
        'question_headings',
        'warning',
        `No heading asks a question, though people search ${quoteList(asked.slice(0, 2).map(q => q.text))}. Phrase the sections that answer them as those questions.`
      )
    }
  }

  const nonAnswers = findFaqNonAnswers(input.faq)
  if (nonAnswers.length > 0) {
    fail(
      'faq_non_answer',
      'warning',
      `The FAQ answer to ${quoteList(nonAnswers.slice(0, 2).map(found => excerpt(found.question, 60)))} does not open with an answer. Answer it in the first sentence, or replace the question with one the piece can answer.`
    )
  } else if (input.faq.length > 0) {
    pass('faq_non_answer', 'Every FAQ answer opens with the answer.')
  }

  const entities = input.entities ?? []
  if (entities.length > 0) {
    const missing = missingEntities(input.content, input.faq, entities)
    if (missing.length > 0) {
      fail(
        'entity_coverage',
        'warning',
        `${quoteList(missing.slice(0, 4))} ${missing.length === 1 ? 'is' : 'are'} planned but never named. Name ${missing.length === 1 ? 'it' : 'them'} in full where the piece covers ${missing.length === 1 ? 'it' : 'them'}.`
      )
    } else pass('entity_coverage', 'Every planned entity is named.')
  }

  const term = input.definition?.trim()
    ? definedTerm(input.definition) || input.primaryKeyword.trim()
    : ''
  if (term) {
    if (definesEarly(input.content, term)) {
      pass('definition_early', 'The main term is defined early.')
    } else {
      fail(
        'definition_early',
        'warning',
        `Define "${term}" in the first 200 words ("${term} is …"): answer engines quote definitions.`
      )
    }
  }

  const stuffing = keywordStuffing({
    doc: input.content,
    primaryKeyword: input.primaryKeyword,
    keywords: input.keywords
  })
  if (stuffing.problems.length > 0) {
    fail(
      'seo_keyword_stuffing',
      'warning',
      `${stuffing.problems.slice(0, MAX_LISTED).join(' ')} Use the secondary keywords and plain synonyms instead.`
    )
  } else if (input.primaryKeyword.trim()) {
    pass('seo_keyword_stuffing', 'Keywords read naturally.')
  }

  return findings
}

