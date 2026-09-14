import { GeneratedIdeaItem, PerspectiveAngle } from './schemas'

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
  knownProductNames?: string[]
  hasFreshEvidence?: boolean
}

export interface ClaimVerificationDetail {
  claim: string
  section: 'thesis' | 'hookConcept' | 'coreArgument' | 'whyNow' | 'supportingEvidence'
  support: 'direct' | 'inferred' | 'unsupported'
  matchedSourceId?: string
  matchedSourceTitle?: string
  confidence: number
  reason?: string
}

export interface ValidationResult {
  idea: GeneratedIdeaItem
  isValid: boolean
  groundingScore: number
  originalityScore: number
  unsupportedClaims: string[]
  inferredClaims: string[]
  directClaims: string[]
  sourceIds: string[]
  hasFabricatedAnecdote: boolean
  hasUnsupportedNumbers: boolean
  hasUnsupportedAbsolutes: boolean
  hasStaleWhyNow: boolean
  sanitized: boolean
  claimDetails: ClaimVerificationDetail[]
}

/**
 * Extracts numbers, percentages, thresholds, and currency values from a string.
 */
export function extractNumbers(text: string): string[] {
  if (!text) return []
  const matches: string[] = []

  // 1. Match percentages e.g. 77%, 12.5%
  const pctMatches = text.match(/\b\d+(?:\.\d+)?%/g)
  if (pctMatches) matches.push(...pctMatches)

  // 2. Match currency e.g. $1.2M, $500k, $50
  const currMatches = text.match(/\$\d+(?:\.\d+)?[kKmMbB]?/g)
  if (currMatches) matches.push(...currMatches)

  // 3. Match thresholds e.g. "around 50 customers", "over 100 users", "50 clients"
  const thresholdRegex = /\b(?:around|about|over|nearly|approx(?:imately)?)\s+(\d+(?:\.\d+)?(?:\s+[a-zA-Z]+)?)\b/gi
  let match: RegExpExecArray | null
  while ((match = thresholdRegex.exec(text)) !== null) {
    if (match[1]) matches.push(match[1].toLowerCase().trim())
  }

  // 4. Match isolated numbers >= 10 that are not standard calendar years (2020-2030)
  const standaloneNumbers = text.match(/\b\d+(?:\.\d+)?\b/g)
  if (standaloneNumbers) {
    for (const n of standaloneNumbers) {
      const val = parseFloat(n)
      if (val >= 2020 && val <= 2030) continue // Allow current years
      if (val < 10) continue // Allow small counts like "3 steps"
      matches.push(n)
    }
  }

  return Array.from(new Set(matches.map((m) => m.toLowerCase().trim())))
}

/**
 * Detects fabricated first-person narratives and anecdotal experiences
 * such as "We discovered...", "We worked with...", "I spoke to...", "We crossed...", etc.
 */
const FABRICATED_ANECDOTE_PATTERNS = [
  /\bWe discovered\b/i,
  /\bWe worked with\b/i,
  /\bI spoke to\b/i,
  /\bI spoke with\b/i,
  /\bWe saw\b/i,
  /\bA customer told us\b/i,
  /\bYesterday\b/i,
  /\bOne of our customers\b/i,
  /\bWe crossed\b/i,
  /\bI watched (?:a|an)\s+([a-zA-Z]+)/i,
  /\bI watched\b/i,
  /\bI saw (?:a|an|the)\s+([a-zA-Z]+)/i,
  /\bA client (?:once )?told me\b/i,
  /\bLast week (?:I|we) (?:spoke with|visited|helped)\b/i,
  /\bLast week\b/i,
  /\bIn my experience with (?:a|an)\s+([a-zA-Z]+)/i,
  /\bI recently worked with (?:a|an)\s+([a-zA-Z]+)/i,
  /\bA customer recently (?:shared|confessed|said)\b/i
]

export function detectFabricatedAnecdote(text: string, knownQuotes: string[]): { detected: boolean; snippet?: string } {
  if (!text) return { detected: false }

  for (const pattern of FABRICATED_ANECDOTE_PATTERNS) {
    const match = pattern.exec(text)
    if (match) {
      const phrase = match[0]
      // Verify if this phrase literally exists in any of the verified quotes
      const inQuote = knownQuotes.some((q) => q.toLowerCase().includes(phrase.toLowerCase()))
      if (!inQuote) {
        return { detected: true, snippet: phrase }
      }
    }
  }

  return { detected: false }
}

/**
 * Detects temporal urgency phrases in "Why Now"
 */
const TEMPORAL_URGENCY_PATTERNS = [
  /\bjust launched\b/i,
  /\brecently\b/i,
  /\bthis week\b/i,
  /\bthis month\b/i,
  /\bbreaking\b/i,
  /\bbrand new\b/i,
  /\brapidly growing\b/i,
  /\bB2B operators are currently hitting\b/i,
  /\bthe market is increasingly\b/i,
  /\bbusinesses are now discovering\b/i
]

/**
 * Unsupported absolute / generalized language dictionary and qualified replacements.
 */
const ABSOLUTE_PHRASE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bdual sources of truth always diverge\b/gi, replacement: 'maintaining the same operational data across multiple systems can create synchronization and consistency challenges' },
  { pattern: /\bevery integration multiplies\b/gi, replacement: 'additional integrations can introduce more' },
  { pattern: /\bthe industry has convinced founders that\b/gi, replacement: 'a common operational assumption is that' },
  { pattern: /\bthe industry has convinced\b/gi, replacement: 'conventional industry guidance often suggests' },
  { pattern: /\bbusinesses are discovering\b/gi, replacement: 'operational reviews indicate' },
  { pattern: /\bcompanies are hitting\b/gi, replacement: 'growing organizations often encounter' },
  { pattern: /\bproves that\b/gi, replacement: 'suggests that' },
  { pattern: /\bguaranteed to\b/gi, replacement: 'often tends to' },
  { pattern: /\bimpossible to\b/gi, replacement: 'difficult to' },
  { pattern: /\balways\b/gi, replacement: 'frequently' },
  { pattern: /\bnever\b/gi, replacement: 'rarely' },
  { pattern: /\bevery\b/gi, replacement: 'many' },
  { pattern: /\bexponential(?:ly)?\b/gi, replacement: 'compounding' },
  { pattern: /\bn-squared\b/gi, replacement: 'compounding' },
  { pattern: /\bfundamentally\b/gi, replacement: 'substantially' }
]

export function qualifyUnsupportedAbsolutes(
  text: string,
  knownQuotes: string[]
): { qualifiedText: string; modified: boolean; matchedAbsolutes: string[] } {
  if (!text) return { qualifiedText: text, modified: false, matchedAbsolutes: [] }

  let qualifiedText = text
  let modified = false
  const matchedAbsolutes: string[] = []

  for (const item of ABSOLUTE_PHRASE_REPLACEMENTS) {
    if (item.pattern.test(qualifiedText)) {
      item.pattern.lastIndex = 0
      const match = qualifiedText.match(item.pattern)
      if (match) {
        // Check if the phrase is verbatim in source text
        const isSupportedByQuote = match.some((m) =>
          knownQuotes.some((q) => q.toLowerCase().includes(m.toLowerCase()))
        )

        if (!isSupportedByQuote) {
          qualifiedText = qualifiedText.replace(item.pattern, item.replacement)
          modified = true
          matchedAbsolutes.push(...match.map((m) => m.toLowerCase()))
        }
      }
    }
  }

  return {
    qualifiedText,
    modified,
    matchedAbsolutes: Array.from(new Set(matchedAbsolutes))
  }
}

/**
 * Checks whether text claims match the known evidence corpus directly,
 * as an inference, or unsupported.
 */
export function checkClaimDirectSupport(
  claimText: string,
  verifiedClaims: GroundingCorpus['verifiedClaims']
): { support: 'direct' | 'inferred' | 'unsupported'; matchedSource?: GroundingCorpus['verifiedClaims'][0]; confidence: number } {
  if (!claimText || claimText.trim().length === 0) {
    return { support: 'unsupported', confidence: 0 }
  }

  const normClaim = claimText.toLowerCase().trim()

  for (const item of verifiedClaims) {
    const normSourceClaim = (item.claim || '').toLowerCase()
    const normQuote = (item.quote || '').toLowerCase()
    const fullSourceText = `${normSourceClaim} ${normQuote}`

    // 1. Exact or substantial substring match = Direct Grounding
    if (fullSourceText.includes(normClaim) || (normClaim.length > 25 && normSourceClaim.includes(normClaim))) {
      return { support: 'direct', matchedSource: item, confidence: 0.98 }
    }

    // 2. Exact match of numbers + key tokens = Direct Grounding
    const claimNumbers = extractNumbers(normClaim)
    const sourceNumbers = extractNumbers(fullSourceText)
    const numbersMatch = claimNumbers.length > 0 && claimNumbers.every((n) => sourceNumbers.includes(n))

    const claimWords = normClaim
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3)
    const sourceWords = new Set(
      fullSourceText
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3)
    )

    let matchCount = 0
    for (const word of claimWords) {
      if (sourceWords.has(word)) matchCount++
    }

    const overlapRatio = claimWords.length > 0 ? matchCount / claimWords.length : 0

    // High overlap + number alignment = Direct
    if (numbersMatch && overlapRatio >= 0.5) {
      return { support: 'direct', matchedSource: item, confidence: 0.92 }
    }

    if (overlapRatio >= 0.7) {
      return { support: 'direct', matchedSource: item, confidence: 0.9 }
    }

    // Moderate semantic alignment without ungrounded numbers = Inferred
    if (overlapRatio >= 0.35 && claimNumbers.every((n) => sourceNumbers.includes(n))) {
      return { support: 'inferred', matchedSource: item, confidence: 0.75 }
    }
  }

  // Check if any numbers are unsupported
  const ungroundedNums = extractNumbers(normClaim)
  if (ungroundedNums.length > 0) {
    return { support: 'unsupported', confidence: 0.1 }
  }

  return { support: 'inferred', confidence: 0.65 }
}

/**
 * Validates and sanitizes a candidate idea against the grounding corpus.
 * Strictly verifies each section (Thesis, Hook, Core Argument, Why Now, Evidence).
 */
export function validateIdea(
  rawIdea: GeneratedIdeaItem,
  corpus: GroundingCorpus
): ValidationResult {
  const idea: GeneratedIdeaItem = JSON.parse(JSON.stringify(rawIdea))
  const unsupportedClaims: string[] = []
  const inferredClaims: string[] = []
  const directClaims: string[] = []
  const sourceIds: string[] = []
  const claimDetails: ClaimVerificationDetail[] = []
  let hasFabricatedAnecdote = false
  let hasUnsupportedNumbers = false
  let hasUnsupportedAbsolutes = false
  let hasStaleWhyNow = false
  let sanitized = false

  const allSourceText = corpus.verifiedClaims
    .map((c) => `${c.claim} ${c.quote || ''} ${c.sourceTitle || ''}`)
    .join(' ')
    .toLowerCase()

  const knownQuotes = corpus.verifiedClaims
    .map((c) => c.quote || '')
    .filter(Boolean)

  const knownNumbers = new Set(
    (corpus.knownNumbers || [])
      .concat(extractNumbers(allSourceText))
      .map((n) => n.toLowerCase().trim())
  )

  // 1. Check Fabricated Anecdotes in Hook, Core Argument, Thesis, and Title
  const sectionsToCheck = [
    { name: 'hookConcept' as const, text: idea.hookConcept },
    { name: 'coreArgument' as const, text: idea.coreArgument },
    { name: 'thesis' as const, text: idea.thesis },
    { name: 'title' as const, text: idea.title },
    { name: 'whyNow' as const, text: idea.whyNow }
  ]

  for (const sec of sectionsToCheck) {
    const anecdoteCheck = detectFabricatedAnecdote(sec.text, knownQuotes)
    if (anecdoteCheck.detected) {
      hasFabricatedAnecdote = true
      unsupportedClaims.push(`Fabricated anecdote detected in ${sec.name}: "${anecdoteCheck.snippet}"`)

      // Cleanly rewrite first-person fabrication to objective observation with proper spacing
      if (sec.name === 'hookConcept') {
        idea.hookConcept = idea.hookConcept
          .replace(/\bWe crossed\s+(?:around\s+)?\d+\s+customers\s+and\s+realized\b/gi, 'Growing organizations frequently discover')
          .replace(/\bWe crossed\b/gi, 'Organizations encounter')
          .replace(/\bWe discovered\b/gi, 'Operational data indicates')
          .replace(/\bWe worked with\b/gi, 'Industry case studies show')
          .replace(/\bI watched (?:a|an)\s+([a-zA-Z]+)/gi, 'Distributors often encounter')
          .replace(/\bI saw (?:a|an|the)\s+([a-zA-Z]+)/gi, 'Teams discover')
          .replace(/\bA client (?:once )?told me\b/gi, 'Leaders frequently report')
          .replace(/\bA customer told us\b/gi, 'Evidence shows')
          .replace(/\bOne of our customers\b/gi, 'A common industry example')
          .replace(/\bYesterday\b/gi, 'In modern distribution environments')
        sanitized = true
      }
      if (sec.name === 'coreArgument') {
        idea.coreArgument = idea.coreArgument
          .replace(/\bWe discovered\b/gi, 'Operational reviews demonstrate')
          .replace(/\bWe worked with\b/gi, 'Analysis indicates')
          .replace(/\bWe crossed\b/gi, 'Teams encounter')
          .replace(/\bI watched (?:a|an)\s+([a-zA-Z]+)/gi, 'Distributors encounter')
          .replace(/\bA client (?:once )?told me\b/gi, 'Evidence shows')
        sanitized = true
      }
      if (sec.name === 'thesis') {
        idea.thesis = idea.thesis
          .replace(/\bWe discovered that\b/gi, '')
          .replace(/\bWe realized that\b/gi, '')
        sanitized = true
      }
    }
  }

  // 2. Check Unsupported Absolutes in Thesis, Hook, and Core Argument
  const thesisAbsCheck = qualifyUnsupportedAbsolutes(idea.thesis, knownQuotes)
  if (thesisAbsCheck.modified) {
    idea.thesis = thesisAbsCheck.qualifiedText
    hasUnsupportedAbsolutes = true
    sanitized = true
  }

  const hookAbsCheck = qualifyUnsupportedAbsolutes(idea.hookConcept, knownQuotes)
  if (hookAbsCheck.modified) {
    idea.hookConcept = hookAbsCheck.qualifiedText
    hasUnsupportedAbsolutes = true
    sanitized = true
  }

  const argAbsCheck = qualifyUnsupportedAbsolutes(idea.coreArgument, knownQuotes)
  if (argAbsCheck.modified) {
    idea.coreArgument = argAbsCheck.qualifiedText
    hasUnsupportedAbsolutes = true
    sanitized = true
  }

  // 3. Check Unsupported Numbers
  const textNumbers = extractNumbers(`${idea.hookConcept} ${idea.coreArgument} ${idea.thesis} ${idea.title}`)
  for (const num of textNumbers) {
    const isGrounded =
      knownNumbers.has(num) ||
      allSourceText.includes(num) ||
      corpus.verifiedClaims.some((c) => c.claim.toLowerCase().includes(num) || (c.quote && c.quote.toLowerCase().includes(num)))

    if (!isGrounded) {
      hasUnsupportedNumbers = true
      unsupportedClaims.push(`Unsupported numerical claim: "${num}"`)

      // Sanitize: replace invented thresholds cleanly with proper spacing
      const escapedNum = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const numRegex = new RegExp(`\\b(?:around|about|approx(?:imately)?|nearly)?\\s*${escapedNum}\\b`, 'gi')
      idea.hookConcept = idea.hookConcept.replace(numRegex, 'multiple organizations')
      idea.coreArgument = idea.coreArgument.replace(numRegex, 'scale')
      idea.thesis = idea.thesis.replace(numRegex, 'scale')
      sanitized = true
    }
  }

  // 4. Check "Why Now" Freshness & False Urgency
  if (idea.whyNow) {
    const hasUrgencyWord = TEMPORAL_URGENCY_PATTERNS.some((p) => p.test(idea.whyNow))
    if (hasUrgencyWord && !corpus.hasFreshEvidence) {
      hasStaleWhyNow = true
      unsupportedClaims.push(`Unverified temporal urgency in Why Now: "${idea.whyNow.slice(0, 50)}..."`)

      // Sanitize Why Now: convert artificial urgency into structural industry context
      idea.whyNow = idea.whyNow
        .replace(/\bjust launched\b/gi, 'modern industry architectures require')
        .replace(/\brecently\b/gi, 'as complexity compounds')
        .replace(/\bthis week\b/gi, 'in current operating environments')
        .replace(/\bthis month\b/gi, 'across today\'s supply chains')
        .replace(/\brapidly growing\b/gi, 'systemic')
        .replace(/\bB2B operators are currently hitting\b/gi, 'B2B operators frequently encounter')
        .replace(/\bthe market is increasingly\b/gi, 'operating environments often')
        .replace(/\bbusinesses are now discovering\b/gi, 'organizations observe')
      sanitized = true
    }
  }

  // 5. Section-by-Section Claim Grounding Verification
  // Section A: Thesis verification
  const thesisCheck = checkClaimDirectSupport(idea.thesis, corpus.verifiedClaims)
  claimDetails.push({
    claim: idea.thesis,
    section: 'thesis',
    support: thesisCheck.support,
    matchedSourceId: thesisCheck.matchedSource?.sourceId,
    matchedSourceTitle: thesisCheck.matchedSource?.sourceTitle,
    confidence: thesisCheck.confidence
  })
  if (thesisCheck.support === 'direct') {
    directClaims.push(idea.thesis)
    if (thesisCheck.matchedSource?.sourceId) sourceIds.push(thesisCheck.matchedSource.sourceId)
  } else if (thesisCheck.support === 'inferred') {
    inferredClaims.push(idea.thesis)
  } else {
    unsupportedClaims.push(`Unsupported thesis assertion: "${idea.thesis.slice(0, 60)}..."`)
  }

  // Section B: Core Argument verification
  const argCheck = checkClaimDirectSupport(idea.coreArgument, corpus.verifiedClaims)
  claimDetails.push({
    claim: idea.coreArgument,
    section: 'coreArgument',
    support: argCheck.support,
    matchedSourceId: argCheck.matchedSource?.sourceId,
    matchedSourceTitle: argCheck.matchedSource?.sourceTitle,
    confidence: argCheck.confidence
  })
  if (argCheck.support === 'direct') {
    directClaims.push(idea.coreArgument)
    if (argCheck.matchedSource?.sourceId) sourceIds.push(argCheck.matchedSource.sourceId)
  } else if (argCheck.support === 'inferred') {
    inferredClaims.push(idea.coreArgument)
  }

  // Section C: Why Now verification
  const whyNowCheck = checkClaimDirectSupport(idea.whyNow, corpus.verifiedClaims)
  claimDetails.push({
    claim: idea.whyNow,
    section: 'whyNow',
    support: whyNowCheck.support,
    matchedSourceId: whyNowCheck.matchedSource?.sourceId,
    matchedSourceTitle: whyNowCheck.matchedSource?.sourceTitle,
    confidence: whyNowCheck.confidence
  })
  if (whyNowCheck.support === 'direct') {
    directClaims.push(idea.whyNow)
    if (whyNowCheck.matchedSource?.sourceId) sourceIds.push(whyNowCheck.matchedSource.sourceId)
  } else if (whyNowCheck.support === 'inferred') {
    inferredClaims.push(idea.whyNow)
  }

  // Section D: Supporting Evidence verification
  const validEvidence = []
  for (const ev of idea.supportingEvidence) {
    const evCheck = checkClaimDirectSupport(ev.claim, corpus.verifiedClaims)

    if (evCheck.support === 'direct' && evCheck.matchedSource) {
      directClaims.push(ev.claim)
      validEvidence.push({
        ...ev,
        factType: 'verified' as const,
        sourceUrl: evCheck.matchedSource.sourceUrl || ev.sourceUrl,
        sourceTitle: evCheck.matchedSource.sourceTitle || ev.sourceTitle,
        quote: evCheck.matchedSource.quote || ev.quote,
        sourceId: evCheck.matchedSource.sourceId,
        confidence: Math.max(ev.confidence, 0.9)
      })
      if (evCheck.matchedSource.sourceId) sourceIds.push(evCheck.matchedSource.sourceId)
    } else {
      const evNumbers = extractNumbers(ev.claim)
      const hasInventedNumbers = evNumbers.some((n) => !knownNumbers.has(n) && !allSourceText.includes(n))

      if (!hasInventedNumbers && ev.confidence >= 0.7) {
        inferredClaims.push(ev.claim)
        validEvidence.push({
          ...ev,
          factType: 'inferred' as const,
          confidence: 0.72
        })
      } else {
        unsupportedClaims.push(`Unsupported evidence claim excluded: "${ev.claim.slice(0, 60)}..."`)
        sanitized = true
      }
    }
  }

  idea.supportingEvidence = validEvidence

  // 6. Anti-Promotional Check (Don't force FlowERP or ERP as automatic conclusion)
  const productNames = corpus.knownProductNames || ['FlowERP']
  for (const prod of productNames) {
    const prodRegex = new RegExp(`\\b${prod}\\b`, 'gi')
    if (prodRegex.test(idea.title) || prodRegex.test(idea.thesis)) {
      idea.title = idea.title.replace(prodRegex, 'Modern B2B Operations')
      idea.thesis = idea.thesis.replace(prodRegex, 'purpose-built operational architectures')
      sanitized = true
    }
  }

  // 7. Calculate True Evidence Coverage Grounding Score
  // Definition:
  // 100% = essentially all factual claims directly supported
  // 80–99% = mostly directly supported, with limited interpretation
  // 60–79% = significant inference or weak evidence
  // <60% = insufficient evidence / unsupported claims
  const totalVerifiedPoints = directClaims.length * 1.0 + inferredClaims.length * 0.55
  const totalPointsPossible = Math.max(1, directClaims.length + inferredClaims.length + unsupportedClaims.length)
  const rawCoverage = totalVerifiedPoints / totalPointsPossible

  let groundingScore: number
  if (unsupportedClaims.length > 0 || hasFabricatedAnecdote || hasUnsupportedNumbers) {
    // Penalized for fabrications / unsupported facts
    groundingScore = Math.min(58, Math.round(rawCoverage * 60))
  } else if (directClaims.length >= 3 && inferredClaims.length <= 1) {
    // Essentially all directly supported
    groundingScore = Math.min(100, Math.max(88, Math.round(rawCoverage * 100)))
  } else if (directClaims.length >= 1) {
    // Mostly supported with limited interpretation
    groundingScore = Math.min(84, Math.max(75, Math.round(rawCoverage * 90)))
  } else {
    // Significant inference, weak direct quote match
    groundingScore = Math.min(74, Math.max(62, Math.round(rawCoverage * 75)))
  }

  // Calculate Originality Score
  let originalityScore = 85
  if (idea.perspectiveAngle === 'contrarian_viewpoints' || idea.perspectiveAngle === 'industry_misconceptions') {
    originalityScore += 10
  }
  if (idea.perspectiveAngle === 'pricing_commercial_rules' || idea.perspectiveAngle === 'data_ownership') {
    originalityScore += 8
  }
  if (/delve|game-changer|leverage|unlock|fast-paced world/i.test(`${idea.hookConcept} ${idea.coreArgument}`)) {
    originalityScore -= 20
  }
  originalityScore = Math.max(20, Math.min(100, Math.round(originalityScore)))

  idea.groundingScore = groundingScore
  idea.originalityScore = originalityScore
  idea.unsupportedClaims = unsupportedClaims
  idea.sourceIds = Array.from(new Set(sourceIds))

  const isValid = groundingScore >= 60 && !hasFabricatedAnecdote && !hasUnsupportedNumbers

  return {
    idea,
    isValid,
    groundingScore,
    originalityScore,
    unsupportedClaims,
    inferredClaims,
    directClaims,
    sourceIds: idea.sourceIds,
    hasFabricatedAnecdote,
    hasUnsupportedNumbers,
    hasUnsupportedAbsolutes,
    hasStaleWhyNow,
    sanitized,
    claimDetails
  }
}
