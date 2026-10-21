import { isGenericPage } from '@/lib/urls'
import { countryName, countryOfUrl, type Region } from '../../region'
import type {
  CorpusEvidenceSource,
  GeneratedIdeaItem,
  IdeaGenerationItem
} from './schema'

/**
 * Grounding checks for generated ideas.
 *
 * This module deliberately does NOT rewrite prose. An earlier version ran blind
 * regex substitutions over the idea text ("every" -> "many", "never" -> "rarely",
 * and numbers -> "scale"), which produced sentences like "many single day" and
 * "10 minutes" -> "scale minutes". Detection is reliable; regex rewriting of
 * natural language is not. Problems are now reported so the human sees them at
 * the approval gate, and unverifiable evidence is dropped rather than reworded.
 */

export interface GroundingCorpus {
  verifiedClaims: Array<{
    claim: string
    quote?: string
    sourceUrl?: string
    sourceTitle?: string
    sourceId?: string
    publishedAt?: string
    /** Dated within the run's freshness window, and not a homepage or index. */
    isFresh?: boolean
    /**
     * Where the text came from. Web text is copied from pages nobody on this
     * account vetted, so a claim that matches it is "sourced", not "verified".
     */
    origin?: 'own' | 'knowledge' | 'web'
  }>
  knownNumbers?: string[]
  hasFreshEvidence?: boolean
  /** The account's own details; figures and names stated there are its own. */
  accountText?: string
  /** Names the account's products start with ("Galaxy"), for spotting invented models. */
  productLines?: string[]
}

export interface ClaimVerificationDetail {
  claim: string
  section:
    'thesis' | 'hookConcept' | 'coreArgument' | 'whyNow' | 'supportingEvidence'
  support: 'direct' | 'inferred' | 'unsupported'
  matchedSourceId?: string
  matchedSourceTitle?: string
  confidence: number
}

export interface ValidationResult {
  idea: GeneratedIdeaItem
  isValid: boolean
  groundingScore: number
  originalityScore: number
  /** Human-readable problems, surfaced on the idea card at the approval gate. */
  issues: string[]
  unsupportedClaims: string[]
  inferredClaims: string[]
  directClaims: string[]
  sourceIds: string[]
  hasFabricatedAnecdote: boolean
  hasUnsupportedNumbers: boolean
  /** Presents something as current without citing a recent source. */
  hasUnsupportedTimeliness: boolean
  /** Product or model names that no source or account detail mentions. */
  unknownProducts: string[]
  /** Serves none of the run's goals, or is written for no reader group in the profile. */
  offBrief: boolean
  /** Why the idea was disqualified, when it was. */
  rejectionReason?: string
  claimDetails: ClaimVerificationDetail[]
}

/**
 * A figure starts where a number starts: not after a letter, a decimal point
 * or a thousands group, so "25%" never yields "5%" and "1.5 million" never
 * yields "5 million".
 */
const FIGURE_START = String.raw`(?<![\w.]|\d,)`
/** Digits with any decimal point or thousands separators: 2.5, 1,200, 1,200.50. */
const FIGURE_NUMBER = String.raw`\d+(?:[.,]\d+)*`

/**
 * Extracts figures a reader would treat as a factual claim: percentages,
 * currency, product specifications ("200MP", "5,000mAh"), and qualified
 * thresholds ("around 50 customers").
 *
 * Bare integers are intentionally NOT collected. Treating every number over 10
 * as a claim flagged ordinary prose like "10 minutes" or "3 of 5 teams".
 */
export function extractNumbers(text: string): string[] {
  if (!text) return []
  const matches: string[] = []

  // "40 percent" and "40 per cent" are the same figure as "40%".
  const percentages = text.match(
    new RegExp(`${FIGURE_START}${FIGURE_NUMBER}\\s*(?:%|per\\s?cent\\b)`, 'gi')
  )
  if (percentages) {
    matches.push(
      ...percentages.map(m => m.replace(/\s*per\s?cent$/i, '%').replace(/\s+/g, ''))
    )
  }

  // "Rs 1,500" and "INR 1,500" are written as "₹1,500".
  const currency = text.match(
    /(?:[$£€₹¥₩]|\b(?:rs\.?|inr)\s?)\s?\d+(?:[.,]\d+)*\s*[kmb]?/gi
  )
  if (currency) {
    matches.push(
      ...currency.map(m => m.replace(/^(?:rs\.?|inr)\s?/i, '₹').replace(/\s+/g, ''))
    )
  }

  // A specification is a product claim: an invented one invents a feature.
  const specs = text.match(
    new RegExp(`${FIGURE_START}${FIGURE_NUMBER}\\s*(?:mp|hz|khz|ghz|mah|gb|tb|nits)\\b`, 'gi')
  )
  if (specs) matches.push(...specs.map(m => m.replace(/\s+/g, '')))

  const multipliers = text.match(
    new RegExp(`${FIGURE_START}${FIGURE_NUMBER}x\\b`, 'gi')
  )
  if (multipliers) matches.push(...multipliers)

  // "around 50 customers", "over 100 users" — a stated scale, which reads as fact.
  const thresholds =
    /\b(?:around|about|over|nearly|approx(?:imately)?|more than|under|fewer than)\s+(\d[\d,.]*)\b/gi
  let match: RegExpExecArray | null
  while ((match = thresholds.exec(text)) !== null) {
    if (match[1]) matches.push(match[1])
  }

  // Large magnitudes always read as a statistic.
  const magnitudes = text.match(
    new RegExp(
      `${FIGURE_START}${FIGURE_NUMBER}\\s*(?:million|billion|trillion|thousand|lakh|crore)s?\\b`,
      'gi'
    )
  )
  if (magnitudes) matches.push(...magnitudes)

  return Array.from(new Set(matches.map(m => m.toLowerCase().trim())))
}

/**
 * Whether `text` states `figure` (as returned by extractNumbers) as a whole
 * number. A plain substring test let "5%" pass on a source that says "25%",
 * and "2.5%" on one that says "12.5%". The figure may not be preceded by a
 * letter, digit, decimal point or thousands group, nor run on into more
 * digits; spacing between its parts is ignored ("40 %", "$ 5").
 */
export function mentionsFigure(text: string, figure: string): boolean {
  const parts = figure.trim().match(/\d+(?:[.,]\d+)*|\p{L}+|\S/gu)
  if (!text || !parts) return false
  const body = parts
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*')
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  const before = /^\d/.test(first) ? FIGURE_START : ''
  const after = /\d$/.test(last)
    ? String.raw`(?![.,]?\d)`
    : /\p{L}$/u.test(last)
      ? String.raw`(?!\p{L})`
      : ''
  return new RegExp(`${before}${body}${after}`, 'iu').test(text)
}

/**
 * First-person claims about specific events the model has no way to know.
 * These are reported, never rewritten.
 */
const FABRICATED_ANECDOTE_PATTERNS: Array<{ pattern: RegExp; label: string }> =
  [
    {
      pattern: /\b(?:we|i)\s+(?:discovered|realized|found)\s+that\b/i,
      label: 'invented discovery'
    },
    { pattern: /\b(?:we|i)\s+worked\s+with\b/i, label: 'invented engagement' },
    { pattern: /\bi\s+spoke\s+(?:to|with)\b/i, label: 'invented conversation' },
    {
      pattern:
        /\ba\s+(?:customer|client)\s+(?:once\s+)?(?:told|said|shared|confessed)\b/i,
      label: 'invented customer quote'
    },
    {
      pattern: /\bone\s+of\s+(?:our|my)\s+(?:customers|clients)\b/i,
      label: 'invented named customer'
    },
    { pattern: /\b(?:we|i)\s+crossed\s+\d/i, label: 'invented milestone' },
    {
      pattern:
        /\b(?:last\s+week|yesterday|this\s+morning)\b.{0,40}\b(?:i|we)\b/i,
      label: 'invented recent event'
    },
    {
      pattern: /\bi\s+watched\s+(?:a|an|the)\s+\w+/i,
      label: 'invented observation'
    },
    {
      pattern: /\b(?:in\s+my\s+experience|i\s+keep\s+seeing|i(?:'ve|\s+have)\s+seen)\b/i,
      label: 'invented experience'
    },
    {
      pattern:
        /\b(?:customers?|clients?|users?|retailers?|dealers?|partners?|buyers?)\s+(?:often\s+|always\s+|keep\s+)?(?:tell|told|telling)\s+(?:us|me)\b/i,
      label: 'invented customer quote'
    }
  ]

export function detectFabricatedAnecdote(
  text: string,
  knownQuotes: string[]
): { detected: boolean; snippet?: string; label?: string } {
  if (!text) return { detected: false }

  for (const { pattern, label } of FABRICATED_ANECDOTE_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    // A phrase that appears verbatim in a source is the author's, not invented.
    const inQuote = knownQuotes.some(q =>
      q.toLowerCase().includes(match[0].toLowerCase())
    )
    if (!inQuote) return { detected: true, snippet: match[0], label }
  }

  return { detected: false }
}

/**
 * Language that presents something as current. It is only honest when the
 * idea cites a recent source; a homepage, an undated page or the knowledge
 * base is background.
 */
const TIMELINESS_PATTERNS = [
  /\bjust\s+(?:been\s+)?(?:launched|announced|released|unveiled|introduced|opened|rolled\s+out|published)\b/i,
  /\bnewly\s+(?:launched|announced|released|unveiled|introduced|published)\b/i,
  /\brecently\b/i,
  /\b(?:most\s+)?recent\s+(?:launch|announcement|release|report|survey|study|data|figures|news|update|change|ruling|policy|rule|regulation|deal|partnership|result|move|campaign|programme|program|initiative|expansion)/i,
  /\b(?:the\s+)?latest\s+(?:launch|announcement|release|report|survey|study|data|figures|news|update|move|campaign)/i,
  /\b(?:this|last|past)\s+(?:week|month|quarter)(?:'s)?\b/i,
  /\bearlier\s+this\s+(?:week|month|year)\b/i,
  /\b(?:yesterday|this\s+morning)\b/i,
  /\bbreaking\s+news\b/i,
  /\bbrand[-\s]new\b/i,
  /\bin\s+the\s+news\b/i,
  /\bright\s+now,?\s+the\s+(?:market|industry)\b/i
]

/** The phrases in `text` that present something as current, each once. */
export function findTimelinessClaims(text: string): string[] {
  if (!text) return []
  const found: string[] = []
  for (const pattern of TIMELINESS_PATTERNS) {
    const match = pattern.exec(text)
    if (match) found.push(match[0])
  }
  return Array.from(new Set(found))
}

/** What a homepage cannot prove: an event, a date or a figure. */
const STORY_PATTERNS = [
  /\b(?:launch(?:ed|es)?|unveil(?:ed|s)?|announc(?:ed|es|ement)|introduc(?:ed|es)|releas(?:ed|es)|debut(?:ed|s)?|roll(?:ed|s)\s+out|expand(?:ed|s)|acquir(?:ed|es)|partner(?:ed|s)\s+with|open(?:ed|s)\s+(?:a|an|its|the|new)|sign(?:ed|s)|invest(?:ed|s)|won|award(?:ed|s)?)\b/i,
  /\b(?:19|20)\d{2}\b/
]

/** True when a claim tells a specific story rather than describing the brand. */
export function describesSpecificStory(text: string): boolean {
  return STORY_PATTERNS.some(p => p.test(text)) || extractNumbers(text).length > 0
}

/** "S26", "Fold7", "QN90F", "Book5": letters and digits forming a model code. */
const MODEL_CODE = /^[A-Za-z]{0,6}\d{1,4}[A-Za-z]{0,3}$/
/** Codes that are not products: years, quarters, network generations, resolutions. */
const NOT_A_MODEL = /^(?:(?:19|20)\d{2}|Q[1-4]|H[12]|FY\d{2,4}|[2-6]G|\d+K|B2[BC]|D2C|P2P)$/i
/** Words that finish a model's name ("Galaxy S26 Ultra"). */
const MODEL_SUFFIX = /^(?:Ultra|Edge|Pro|Plus|Max|Mini|FE|Lite|Slim)$/
const word = (token: string) =>
  token.replace(/^[^\w]+|[^\w]+$/g, '').replace(/['’]s$/, '')

/**
 * Model names built on one of the account's product lines ("Galaxy S26 Edge")
 * that `knownText` never mentions. A brand's next model is the invention a
 * figure check cannot see: the name reads as fact, and so does every feature
 * the idea gives it. Spacing is ignored ("Fold 7" is "Fold7").
 */
export function findUnknownProducts(
  text: string,
  productLines: string[],
  knownText: string
): string[] {
  if (!text || productLines.length === 0) return []
  const lines = new Set(productLines.map(l => l.toLowerCase()))
  const known = knownText.toLowerCase().replace(/\s+/g, '')
  const tokens = text.split(/\s+/)
  const found: string[] = []

  for (let i = 0; i < tokens.length; i++) {
    if (!lines.has(word(tokens[i]!).toLowerCase())) continue
    const name = [word(tokens[i]!)]
    for (let j = i + 1; j < Math.min(tokens.length, i + 4); j++) {
      const part = word(tokens[j]!)
      if (!/^[A-Z0-9]/.test(part)) break
      name.push(part)
      // A bare number counts only after another name part ("Fold 7"), so
      // "Samsung's 2 factories" is not a model.
      const isModel =
        MODEL_CODE.test(part) &&
        !NOT_A_MODEL.test(part) &&
        (/[A-Za-z]/.test(part) || j > i + 1)
      if (isModel) {
        const next = tokens[j + 1] ? word(tokens[j + 1]!) : ''
        if (MODEL_SUFFIX.test(next) && !/[.,;:!?]$/.test(tokens[j]!)) name.push(next)
        // "Samsung Galaxy S25" is known when a source says "Galaxy S25".
        const isKnown = name
          .slice(0, -1)
          .some((_, k) => known.includes(name.slice(k).join('').toLowerCase()))
        if (!isKnown) found.push(name.join(' '))
        i = j
        break
      }
      if (/[.,;:!?)]$/.test(tokens[j]!)) break
    }
  }
  return Array.from(new Set(found))
}

/** Absolutes that a reader will read as a proven fact. */
const UNSUPPORTED_ABSOLUTE_PATTERNS = [
  /\bproves\s+that\b/i,
  /\bguaranteed\s+to\b/i,
  /\balways\s+(?:fails|works|leads|results)\b/i,
  /\bnever\s+(?:fails|works)\b/i,
  /\bevery\s+(?:company|team|business)\s+(?:must|should|needs)\b/i,
  /\bexponentially\b/i
]

export function findUnsupportedAbsolutes(
  text: string,
  knownQuotes: string[]
): string[] {
  if (!text) return []
  const found: string[] = []
  for (const pattern of UNSUPPORTED_ABSOLUTE_PATTERNS) {
    const match = pattern.exec(text)
    if (!match) continue
    const inQuote = knownQuotes.some(q =>
      q.toLowerCase().includes(match[0].toLowerCase())
    )
    if (!inQuote) found.push(match[0])
  }
  return Array.from(new Set(found))
}

/** Word overlap against a source, ignoring short connective words. */
function overlapRatio(claim: string, source: string): number {
  const claimWords = claim
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
  if (claimWords.length === 0) return 0

  const sourceWords = new Set(
    source
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
  )

  let hits = 0
  for (const word of claimWords) if (sourceWords.has(word)) hits++
  return hits / claimWords.length
}

export function checkClaimDirectSupport(
  claimText: string,
  verifiedClaims: GroundingCorpus['verifiedClaims']
): {
  support: 'direct' | 'inferred' | 'unsupported'
  matchedSource?: GroundingCorpus['verifiedClaims'][0]
  confidence: number
} {
  if (!claimText?.trim()) return { support: 'unsupported', confidence: 0 }

  const normClaim = claimText.toLowerCase().trim()
  const claimNumbers = extractNumbers(normClaim)

  let best: {
    support: 'direct' | 'inferred'
    matchedSource: GroundingCorpus['verifiedClaims'][0]
    confidence: number
  } | null = null

  for (const item of verifiedClaims) {
    const sourceText = `${item.claim || ''} ${item.quote || ''}`.toLowerCase()
    if (!sourceText.trim()) continue

    if (sourceText.includes(normClaim)) {
      return { support: 'direct', matchedSource: item, confidence: 0.98 }
    }

    const sourceNumbers = extractNumbers(sourceText)
    const numbersMatch =
      claimNumbers.length > 0 &&
      claimNumbers.every(n => sourceNumbers.includes(n))
    const ratio = overlapRatio(normClaim, sourceText)

    if (numbersMatch && ratio >= 0.45) {
      return { support: 'direct', matchedSource: item, confidence: 0.92 }
    }
    if (claimNumbers.length === 0 && ratio >= 0.7) {
      return { support: 'direct', matchedSource: item, confidence: 0.9 }
    }
    if (ratio >= 0.35 && claimNumbers.every(n => sourceNumbers.includes(n))) {
      if (!best || best.confidence < 0.75) {
        best = { support: 'inferred', matchedSource: item, confidence: 0.75 }
      }
    }
  }

  if (best) return best

  // A figure with no matching source is the failure mode worth catching.
  if (claimNumbers.length > 0)
    return { support: 'unsupported', confidence: 0.1 }

  // Reasoning that introduces no new facts is interpretation, not fabrication.
  return { support: 'inferred', confidence: 0.6 }
}

/**
 * The account's own proof points and documents can be called verified. Text
 * from a web page only matched what the page says, so it is "sourced".
 */
export function factTypeFor(
  origin: 'own' | 'knowledge' | 'web' | undefined
): 'verified' | 'sourced' {
  return origin === 'web' ? 'sourced' : 'verified'
}

/**
 * An idea serves one main goal and, where its argument genuinely moves theirs
 * too, a couple more. Beyond that it is serving everything and so nothing.
 */
export const MAX_GOALS_PER_IDEA = 3

/** What the idea must fit besides its evidence: the run's brief. */
export interface IdeaFit {
  /** Ids of the goals picked for the run; when set, an idea must serve one. */
  goals: string[]
  /** The profile's reader groups; when set, an idea must be for one. */
  audiences: string[]
  /** Where the readers are; evidence localised for another market is flagged. */
  region?: Region | null
}

/** The corpus entries from the source an evidence item cites. */
function citedSource(
  ev: GeneratedIdeaItem['supportingEvidence'][number],
  corpus: GroundingCorpus
): GroundingCorpus['verifiedClaims'] {
  return corpus.verifiedClaims.filter(c =>
    ev.sourceUrl
      ? c.sourceUrl === ev.sourceUrl
      : ev.sourceId
        ? c.sourceId === ev.sourceId
        : Boolean(ev.sourceTitle) && !c.sourceUrl && c.sourceTitle === ev.sourceTitle
  )
}

export function validateIdea(
  rawIdea: GeneratedIdeaItem,
  corpus: GroundingCorpus,
  /** Without it, only grounding is checked. */
  fit?: IdeaFit
): ValidationResult {
  const idea: GeneratedIdeaItem = structuredClone(rawIdea)
  const issues: string[] = []
  const unsupportedClaims: string[] = []
  const inferredClaims: string[] = []
  const directClaims: string[] = []
  const sourceIds: string[] = []
  const claimDetails: ClaimVerificationDetail[] = []

  let hasFabricatedAnecdote = false
  let hasUnsupportedNumbers = false
  let hasUnsupportedTimeliness = false
  let offBrief = false
  let rejectionReason: string | undefined
  /** Records a problem that disqualifies the idea; the first one is the reason. */
  const reject = (issue: string) => {
    issues.push(issue)
    rejectionReason ??= issue
  }

  const knownQuotes = corpus.verifiedClaims
    .map(c => c.quote || '')
    .filter(Boolean)

  const allSourceText = [
    ...corpus.verifiedClaims.map(c => `${c.claim} ${c.quote || ''}`),
    corpus.accountText || ''
  ]
    .join(' ')
    .toLowerCase()

  // 0. The brief: the run's goals, one of the account's reader groups. Only
  // goals picked for the run count; the first that is one is the main goal.
  if (fit && fit.goals.length > 0) {
    const served = Array.from(
      new Set(
        [...(idea.goalIds ?? []), ...(idea.goalId ? [idea.goalId] : [])].filter(
          id => fit.goals.includes(id)
        )
      )
    ).slice(0, MAX_GOALS_PER_IDEA)
    if (served.length === 0 && fit.goals.length === 1) served.push(fit.goals[0]!)
    if (served.length === 0) {
      offBrief = true
      reject('It serves none of the goals selected for this run.')
    }
    idea.goalId = served[0]
    idea.goalIds = served
  }
  if (fit && fit.audiences.length > 0) {
    if (!idea.targetAudience && fit.audiences.length === 1) {
      idea.targetAudience = fit.audiences[0]
    }
    if (!idea.targetAudience) {
      offBrief = true
      reject('It is not written for one of the reader groups in the profile.')
    }
  }

  const knownNumbers = new Set(
    (corpus.knownNumbers || [])
      .concat(extractNumbers(allSourceText))
      .map(n => n.toLowerCase().trim())
  )

  // 1. Invented first-person experience
  const proseSections: Array<{ name: string; text: string }> = [
    { name: 'hook', text: idea.hookConcept },
    { name: 'core argument', text: idea.coreArgument },
    { name: 'thesis', text: idea.thesis },
    { name: 'title', text: idea.title },
    { name: 'why-now', text: idea.whyNow }
  ]

  for (const section of proseSections) {
    const check = detectFabricatedAnecdote(section.text, knownQuotes)
    if (check.detected) {
      hasFabricatedAnecdote = true
      reject(
        `The ${section.name} states a first-hand experience ("${check.snippet}") that no source backs up.`
      )
    }
  }

  // Every field the reviewer reads and the drafting brief carries forward.
  const prose = [
    idea.title,
    idea.thesis,
    idea.angle,
    idea.hookConcept,
    idea.coreArgument,
    idea.whyNow,
    idea.audienceTakeaway
  ].join('\n')

  // 2. Figures with no source
  const proseNumbers = extractNumbers(prose)
  for (const num of proseNumbers) {
    const grounded =
      knownNumbers.has(num) || mentionsFigure(allSourceText, num)
    if (!grounded) {
      hasUnsupportedNumbers = true
      reject(`The figure "${num}" does not appear in any source.`)
      unsupportedClaims.push(`Unsupported figure: ${num}`)
    }
  }

  // 2b. Products and models with no source
  const unknownProducts = findUnknownProducts(
    prose,
    corpus.productLines || [],
    allSourceText
  )
  for (const name of unknownProducts) {
    reject(`It names "${name}", which no source or account detail mentions.`)
    unsupportedClaims.push(`Unsupported product: ${name}`)
  }

  // 3. Absolutes stated as proven
  const absolutes = findUnsupportedAbsolutes(
    `${idea.thesis} ${idea.hookConcept} ${idea.coreArgument}`,
    knownQuotes
  )
  for (const phrase of absolutes) {
    issues.push(`"${phrase}" claims more certainty than the evidence supports.`)
  }

  // 4. Grounding per section
  const verify = (
    text: string,
    section: ClaimVerificationDetail['section']
  ) => {
    if (!text?.trim()) return
    const check = checkClaimDirectSupport(text, corpus.verifiedClaims)
    claimDetails.push({
      claim: text,
      section,
      support: check.support,
      matchedSourceId: check.matchedSource?.sourceId,
      matchedSourceTitle: check.matchedSource?.sourceTitle,
      confidence: check.confidence
    })
    if (check.support === 'direct') {
      directClaims.push(text)
      if (check.matchedSource?.sourceId)
        sourceIds.push(check.matchedSource.sourceId)
    } else if (check.support === 'inferred') {
      inferredClaims.push(text)
    } else {
      unsupportedClaims.push(`Unsupported ${section}: ${text.slice(0, 80)}`)
    }
  }

  verify(idea.thesis, 'thesis')
  verify(idea.coreArgument, 'coreArgument')
  verify(idea.whyNow, 'whyNow')

  // 5. Evidence: keep a claim only with a source that says it.
  //
  // A claim used to be matched against the whole corpus, and one that matched
  // nothing was still kept as "inferred" under the source it cited. So any
  // claim could carry any URL, and a brand's homepage became the source of
  // stories it never told. Now the cited source must back the claim (word for
  // word, or by substantial overlap); failing that, a source that states it
  // word for word replaces the citation; failing both, the claim is dropped.
  let citesRecentEvidence = false
  const keptEvidence: typeof idea.supportingEvidence = []
  for (const ev of idea.supportingEvidence) {
    const evNumbers = extractNumbers(ev.claim)
    const inventedNumbers = evNumbers.some(
      n => !knownNumbers.has(n) && !mentionsFigure(allSourceText, n)
    )
    const cited = citedSource(ev, corpus)
    const fromCited = cited.length > 0 ? checkClaimDirectSupport(ev.claim, cited) : null

    let match: GroundingCorpus['verifiedClaims'][number] | undefined
    let direct = false
    if (
      fromCited?.matchedSource &&
      (fromCited.support === 'direct' || !inventedNumbers)
    ) {
      match = fromCited.matchedSource
      direct = fromCited.support === 'direct'
    } else {
      const anywhere = checkClaimDirectSupport(ev.claim, corpus.verifiedClaims)
      if (anywhere.support === 'direct' && anywhere.matchedSource) {
        match = anywhere.matchedSource
        direct = true
      }
    }

    const shortClaim = ev.claim.slice(0, 80)
    if (!match) {
      issues.push(
        cited.length > 0
          ? `Dropped a supporting claim its cited source does not back: "${shortClaim}".`
          : `Dropped an unverifiable supporting claim: "${shortClaim}".`
      )
      unsupportedClaims.push(ev.claim)
      continue
    }
    if (match.sourceUrl && isGenericPage(match.sourceUrl) && describesSpecificStory(ev.claim)) {
      issues.push(
        `Dropped "${shortClaim}": ${match.sourceUrl} is a homepage or index, not the source of a specific story.`
      )
      unsupportedClaims.push(ev.claim)
      continue
    }

    if (direct) directClaims.push(ev.claim)
    else inferredClaims.push(ev.claim)
    if (match.isFresh) citesRecentEvidence = true
    keptEvidence.push({
      ...ev,
      factType: direct ? factTypeFor(match.origin) : 'inferred',
      // Every source detail is the matched entry's; none is carried over
      // from a citation that did not hold.
      sourceUrl: match.sourceUrl,
      sourceTitle: match.sourceTitle,
      quote: match.quote,
      sourceId: match.sourceId,
      publishedAt: match.publishedAt,
      confidence: direct ? Math.max(ev.confidence, 0.9) : 0.72
    })
    if (match.sourceId) sourceIds.push(match.sourceId)
  }
  idea.supportingEvidence = keptEvidence

  // 6. Timeliness only with a recent source cited for it.
  const timely = findTimelinessClaims(prose)
  if (timely.length > 0 && !citesRecentEvidence) {
    hasUnsupportedTimeliness = true
    reject(
      `It presents something as current ("${timely[0]}") without citing a recent source.`
    )
  }

  // 6b. Evidence localised for another market than the readers'.
  const readers = fit?.region
  if (readers?.code) {
    for (const ev of keptEvidence) {
      const country = ev.sourceUrl ? countryOfUrl(ev.sourceUrl) : undefined
      if (country && country !== readers.code) {
        issues.push(
          `Evidence from ${ev.sourceUrl} describes ${countryName(country) ?? country.toUpperCase()}, not ${readers.name}, where the readers are.`
        )
      }
    }
  }

  // 7. Scores
  const scored =
    directClaims.length + inferredClaims.length + unsupportedClaims.length
  const coverage =
    scored === 0
      ? 0
      : (directClaims.length + inferredClaims.length * 0.55) / scored

  let groundingScore = Math.round(coverage * 100)
  if (hasFabricatedAnecdote) groundingScore = Math.min(groundingScore, 45)
  if (hasUnsupportedNumbers) groundingScore = Math.min(groundingScore, 50)
  groundingScore = Math.max(0, Math.min(100, groundingScore))

  let originalityScore = 80
  if (idea.noveltyNote && idea.noveltyNote.length > 40) originalityScore += 8
  if (absolutes.length > 0) originalityScore -= 10
  if (
    /delve|game-changer|leverage|unlock|fast-paced world/i.test(
      `${idea.hookConcept} ${idea.coreArgument}`
    )
  ) {
    originalityScore -= 25
    issues.push('The hook or argument leans on buzzword filler.')
  }
  originalityScore = Math.max(20, Math.min(100, originalityScore))

  idea.groundingScore = groundingScore
  idea.originalityScore = originalityScore
  idea.unsupportedClaims = unsupportedClaims
  idea.sourceIds = Array.from(new Set(sourceIds))
  // Surface the problems on the card so the approval gate is informed.
  idea.risks = Array.from(new Set([...(idea.risks || []), ...issues]))

  // Fabrication (an anecdote, a figure, a product, news that is not news) and
  // missing the brief are disqualifying. Thin grounding is a judgement call
  // the human makes at the gate, which is what the gate is for.
  const isValid = !rejectionReason

  return {
    idea,
    isValid,
    groundingScore,
    originalityScore,
    issues,
    unsupportedClaims,
    inferredClaims,
    directClaims,
    sourceIds: idea.sourceIds,
    hasFabricatedAnecdote,
    hasUnsupportedNumbers,
    hasUnsupportedTimeliness,
    unknownProducts,
    offBrief,
    rejectionReason,
    claimDetails
  }
}

// ---------------------------------------------------------------------------
// Citations: the model cites evidence by label; sources come from the corpus
// ---------------------------------------------------------------------------

/** Parses "E3", "e3" or "[E3]" into a zero-based corpus index. */
export function parseEvidenceRef(ref: string | undefined): number | null {
  const match = /E\s*(\d+)/i.exec(ref || '')
  if (!match) return null
  const index = Number(match[1]) - 1
  return index >= 0 ? index : null
}

/**
 * Replaces evidence labels the model left in prose ("E7 is unverified") with
 * the title of the source they point to. The reviewer sees the prose, not the
 * labels, so "E7" meant nothing to them.
 */
export function replaceEvidenceLabels(
  text: string,
  corpus: CorpusEvidenceSource[]
): string {
  return text.replace(/\[?\bE(\d{1,2})\b\]?/g, (_, n: string) => {
    const title = corpus[Number(n) - 1]?.sourceTitle?.trim()
    if (!title) return 'a source'
    return `"${title.length > 60 ? `${title.slice(0, 57)}...` : title}"`
  })
}

/** The item a label such as "A2" or "[G1]" points to in its list, if any. */
function byLabel<T>(prefix: 'A' | 'G', ref: string | undefined, items: T[]) {
  const match = new RegExp(`^\\s*\\[?${prefix}\\s*(\\d+)\\]?\\s*$`, 'i').exec(
    ref || ''
  )
  return match ? items[Number(match[1]) - 1] : undefined
}

/**
 * The goals an idea names, from their labels, in the order given and once
 * each. Labels that point at no goal are left out; the first goal left is the
 * main one.
 */
export function resolveGoalRefs(
  refs: string[] | undefined,
  goals: string[]
): { goalId?: string; goalIds: string[] } {
  const goalIds = Array.from(
    new Set(
      (refs ?? [])
        .map(ref => byLabel('G', ref, goals))
        .filter((id): id is string => Boolean(id))
    )
  )
  return { goalId: goalIds[0], goalIds }
}

/**
 * Expands a generated idea into the full item. Source details come from the
 * corpus entry the model cited, never from the model's own typing. A citation
 * that points outside the corpus keeps its claim but gets no source, so the
 * validator judges it on the text alone. The reader group and the goal are
 * resolved the same way, from their labels; an unknown label leaves the idea
 * without one, and the validator then turns it away.
 */
export function resolveGeneratedIdea(
  generated: IdeaGenerationItem,
  corpus: CorpusEvidenceSource[],
  /** The reader groups the prompt listed, in label order. */
  audiences: string[] = [],
  /** Ids of the goals the prompt listed, in label order. */
  goals: string[] = []
): GeneratedIdeaItem {
  const clean = (text: string) => replaceEvidenceLabels(text, corpus)
  return {
    title: generated.title,
    thesis: generated.thesis,
    perspectiveAngle: generated.perspectiveAngle,
    angle: generated.angle,
    ...resolveGoalRefs(generated.goalRefs, goals),
    targetAudience: byLabel('A', generated.audienceRef, audiences),
    format: generated.format,
    whyNow: clean(generated.whyNow),
    hookConcept: generated.hookConcept,
    coreArgument: generated.coreArgument,
    audienceTakeaway: generated.audienceTakeaway,
    supportingEvidence: (generated.supportingEvidence || []).map(ev => {
      const index = parseEvidenceRef(ev.evidenceRef)
      const source = index === null ? undefined : corpus[index]
      return {
        claim: ev.claim,
        factType: factTypeFor(source?.origin),
        sourceId: source?.sourceId,
        sourceUrl: source?.sourceUrl,
        sourceTitle: source?.sourceTitle,
        quote: source?.quote,
        publishedAt: source?.publishedAt,
        // Confidence is decided by the validator's grounding check.
        confidence: 0.9
      }
    }),
    suggestedMedia: { mode: 'none', brief: generated.mediaBrief },
    noveltyNote: clean(generated.noveltyNote),
    estimatedStrength: generated.estimatedStrength,
    // Recomputed by validateIdea; placeholders until then.
    groundingScore: 0,
    originalityScore: 0,
    unsupportedClaims: [],
    sourceIds: [],
    risks: (generated.risks || []).map(clean)
  }
}
