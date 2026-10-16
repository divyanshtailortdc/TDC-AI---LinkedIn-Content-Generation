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
    isFresh?: boolean
  }>
  knownNumbers?: string[]
  hasFreshEvidence?: boolean
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
 * currency, and qualified thresholds ("around 50 customers").
 *
 * Bare integers are intentionally NOT collected. Treating every number over 10
 * as a claim flagged ordinary prose like "10 minutes" or "3 of 5 teams".
 */
export function extractNumbers(text: string): string[] {
  if (!text) return []
  const matches: string[] = []

  const percentages = text.match(
    new RegExp(`${FIGURE_START}${FIGURE_NUMBER}\\s*%`, 'g')
  )
  if (percentages) matches.push(...percentages.map(m => m.replace(/\s+/g, '')))

  const currency = text.match(/[$£€]\s?\d+(?:[.,]\d+)*\s*[kKmMbB]?/g)
  if (currency) matches.push(...currency.map(m => m.replace(/\s+/g, '')))

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
      `${FIGURE_START}${FIGURE_NUMBER}\\s*(?:million|billion|thousand)\\b`,
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

/** Urgency language is only honest when fresh evidence backs it. */
const TEMPORAL_URGENCY_PATTERNS = [
  /\bjust\s+launched\b/i,
  /\brecently\b/i,
  /\bthis\s+(?:week|month)\b/i,
  /\bbreaking\b/i,
  /\bbrand\s+new\b/i,
  /\bright\s+now,?\s+the\s+(?:market|industry)\b/i
]

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

export function validateIdea(
  rawIdea: GeneratedIdeaItem,
  corpus: GroundingCorpus
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

  const knownQuotes = corpus.verifiedClaims
    .map(c => c.quote || '')
    .filter(Boolean)

  const allSourceText = corpus.verifiedClaims
    .map(c => `${c.claim} ${c.quote || ''}`)
    .join(' ')
    .toLowerCase()

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
    { name: 'title', text: idea.title }
  ]

  for (const section of proseSections) {
    const check = detectFabricatedAnecdote(section.text, knownQuotes)
    if (check.detected) {
      hasFabricatedAnecdote = true
      issues.push(
        `The ${section.name} states a first-hand experience ("${check.snippet}") that no source backs up.`
      )
    }
  }

  // 2. Figures with no source
  const proseNumbers = extractNumbers(
    `${idea.hookConcept} ${idea.coreArgument} ${idea.thesis} ${idea.title}`
  )
  for (const num of proseNumbers) {
    const grounded =
      knownNumbers.has(num) || mentionsFigure(allSourceText, num)
    if (!grounded) {
      hasUnsupportedNumbers = true
      issues.push(`The figure "${num}" does not appear in any source.`)
      unsupportedClaims.push(`Unsupported figure: ${num}`)
    }
  }

  // 3. Absolutes stated as proven
  const absolutes = findUnsupportedAbsolutes(
    `${idea.thesis} ${idea.hookConcept} ${idea.coreArgument}`,
    knownQuotes
  )
  for (const phrase of absolutes) {
    issues.push(`"${phrase}" claims more certainty than the evidence supports.`)
  }

  // 4. Urgency without fresh evidence
  if (idea.whyNow && !corpus.hasFreshEvidence) {
    const urgent = TEMPORAL_URGENCY_PATTERNS.find(p => p.test(idea.whyNow))
    if (urgent) {
      issues.push(
        '"Why now" claims timeliness, but this run gathered no fresh evidence to support it.'
      )
    }
  }

  // 5. Grounding per section
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

  // 6. Evidence: keep what checks out, drop what does not.
  const keptEvidence: typeof idea.supportingEvidence = []
  for (const ev of idea.supportingEvidence) {
    const check = checkClaimDirectSupport(ev.claim, corpus.verifiedClaims)

    if (check.support === 'direct' && check.matchedSource) {
      directClaims.push(ev.claim)
      keptEvidence.push({
        ...ev,
        factType: 'verified',
        sourceUrl: check.matchedSource.sourceUrl || ev.sourceUrl,
        sourceTitle: check.matchedSource.sourceTitle || ev.sourceTitle,
        quote: check.matchedSource.quote || ev.quote,
        sourceId: check.matchedSource.sourceId,
        confidence: Math.max(ev.confidence, 0.9)
      })
      if (check.matchedSource.sourceId)
        sourceIds.push(check.matchedSource.sourceId)
      continue
    }

    const evNumbers = extractNumbers(ev.claim)
    const inventedNumbers = evNumbers.some(
      n => !knownNumbers.has(n) && !mentionsFigure(allSourceText, n)
    )

    if (!inventedNumbers && check.support === 'inferred') {
      inferredClaims.push(ev.claim)
      keptEvidence.push({ ...ev, factType: 'inferred', confidence: 0.72 })
    } else {
      issues.push(
        `Dropped an unverifiable supporting claim: "${ev.claim.slice(0, 80)}".`
      )
      unsupportedClaims.push(ev.claim)
    }
  }
  idea.supportingEvidence = keptEvidence

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

  // Only fabrication is disqualifying. Thin grounding is a judgement call the
  // human makes at the gate, which is what the gate is for.
  const isValid = !hasFabricatedAnecdote && !hasUnsupportedNumbers

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
 * Expands a generated idea into the full item. Source details come from the
 * corpus entry the model cited, never from the model's own typing. A citation
 * that points outside the corpus keeps its claim but gets no source, so the
 * validator judges it on the text alone.
 */
export function resolveGeneratedIdea(
  generated: IdeaGenerationItem,
  corpus: CorpusEvidenceSource[]
): GeneratedIdeaItem {
  return {
    title: generated.title,
    thesis: generated.thesis,
    perspectiveAngle: generated.perspectiveAngle,
    angle: generated.angle,
    pillar: generated.pillar,
    format: generated.format,
    whyNow: generated.whyNow,
    hookConcept: generated.hookConcept,
    coreArgument: generated.coreArgument,
    audienceTakeaway: generated.audienceTakeaway,
    supportingEvidence: (generated.supportingEvidence || []).map(ev => {
      const index = parseEvidenceRef(ev.evidenceRef)
      const source = index === null ? undefined : corpus[index]
      return {
        claim: ev.claim,
        factType: 'verified' as const,
        sourceId: source?.sourceId,
        sourceUrl: source?.sourceUrl,
        sourceTitle: source?.sourceTitle,
        quote: source?.quote,
        // Confidence is decided by the validator's grounding check.
        confidence: 0.9
      }
    }),
    suggestedMedia: { mode: 'none', brief: generated.mediaBrief },
    noveltyNote: generated.noveltyNote,
    estimatedStrength: generated.estimatedStrength,
    // Recomputed by validateIdea; placeholders until then.
    groundingScore: 0,
    originalityScore: 0,
    unsupportedClaims: [],
    sourceIds: [],
    risks: generated.risks || []
  }
}
