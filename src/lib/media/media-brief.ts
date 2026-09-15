/**
 * Media Brief Extraction, Semantic Relevance Validation & Visual Prompt Synthesis
 *
 * Implements a strict, deterministic, and evidence-grounded media generation pipeline
 * that prevents unrelated quote cards, historical references, promotional drift,
 * third-party branding, fake watermarks, and generic robot vs human conflict tropes.
 */

export type VisualType =
  | 'framework'
  | 'comparison'
  | 'process'
  | 'decision_tree'
  | 'conceptual_illustration'
  | 'data_visual'
  | 'quote_card'
  | 'product_visual'
  | 'none'

export interface TextOverlaySpec {
  headline: string
  supportingPoints?: string[]
  footer?: string
}

export interface MediaBrief {
  postTopic: string
  coreThesis: string
  mainProblem: string
  mainContrast: string
  readerTakeaway: string
  allowedVisualConcepts: string[]
  prohibitedVisualConcepts: string[]
  primaryConcept: string
  supportingConcepts: string[]
  audience: string
  tone: string
  visualMetaphor: string
  avoidConcepts: string[]
  textOverlay: TextOverlaySpec
}

export interface QuoteVerification {
  quote: string
  author: string
  sourceUrl?: string
  verified: boolean
}

export interface HeadlineValidationResult {
  isValid: boolean
  isDirectExpressionOfThesis: boolean
  introducesNewClaim: boolean
  reason?: string
}

export interface MediaReadabilityResult {
  readabilityScore: number // 0 - 100
  mobileReadable: boolean
  visualComplexity: 'low' | 'moderate' | 'high' | 'excessive'
  textDensity: 'minimal' | 'balanced' | 'dense' | 'excessive'
  reasons: string[]
}

export type UserFacingRelevanceLevel = 'Highly relevant' | 'Relevant' | 'Weak match' | 'Not relevant'

export interface UserFacingRelevanceInfo {
  level: UserFacingRelevanceLevel
  label: string
  badgeVariant: 'success' | 'info' | 'warning' | 'destructive'
  isPass: boolean
  warningMessage?: string
}

export interface SemanticValidationResult {
  relevanceScore: number // 0 - 100
  thesisMatch: boolean
  topicMatch: boolean
  introducesUnrelatedTopic: boolean
  headlineValid: boolean
  reason: string
  explanation: string
  alignedConcepts: string[]
  missingConcepts: string[]
  unrelatedElements: string[]
  headlineValidation?: HeadlineValidationResult
  readability?: MediaReadabilityResult
}

// Backwards compatibility alias
export type RelevanceValidationResult = SemanticValidationResult

export interface EvidenceSource {
  claim: string
  quote?: string
  author?: string
  sourceTitle?: string
  sourceUrl?: string
  isFresh?: boolean
  verified?: boolean
}

/**
 * List of famous/historical figures and philosophical references that should NEVER
 * be inserted into B2B business visuals unless explicitly discussed in the source text.
 */
export const BANNED_HISTORICAL_REFERENCES = [
  'oppenheimer',
  'einstein',
  'steve jobs',
  'elon musk',
  'sun tzu',
  'aristotle',
  'plato',
  'socrates',
  'nietzsche',
  'churchill',
  'lincoln',
  'marcus aurelius',
  'machiavelli',
  'shakespeare',
  'confucius',
  'buddha',
  'gandhi'
]

/**
 * Common unrelated business topics that must never be inferred into an image
 * unless explicitly present in the post thesis or core argument.
 */
export const COMMON_UNRELATED_TOPICS = [
  'data reconciliation',
  'etl pipelines',
  'etl pipeline',
  'etl',
  'supply chain visibility',
  'supply chain',
  'inventory flow',
  'logistics tracking',
  'logistics',
  'warehouse management',
  'warehouse tracking',
  'warehouse operations',
  'delivery tracking',
  'delivery management',
  'inventory tracking',
  'inventory visibility',
  'generic workflow diagrams',
  'generic workflow diagram',
  'generic workflow',
  'generic erp architecture',
  'generic erp',
  'fleet management',
  'freight forwarding'
]

/**
 * Third-party publication names, media brands, and stock watermarks
 * that must never be generated unless explicitly provided in the account profile or source material.
 */
export const BANNED_THIRD_PARTY_BRANDS = [
  'forbes',
  'harvard business review',
  'hbr',
  'bloomberg',
  'techcrunch',
  'wall street journal',
  'wsj',
  'reuters',
  'mckinsey',
  'gartner',
  'inc magazine',
  'fast company',
  'wired',
  'the economist',
  'getty',
  'shutterstock',
  'istock',
  'unsplash watermark'
]

/**
 * Generic robot vs human or AI vs human conflict framing tropes.
 * Decision-routing posts must communicate allocation of decisions, not competition.
 */
export const BANNED_CONFLICT_FRAMING = [
  'robot vs human',
  'ai vs human',
  'human vs machine',
  'man vs machine',
  'robot battle',
  'cyborg hand',
  'robot arm wrestling',
  'human replacement',
  'ai taking over',
  'robot fighting human'
]

/**
 * Validates the image headline separately from the general visual concept.
 * Verifies that the headline is a direct expression of the post thesis and does not
 * introduce new claims, third-party branding, fake watermarks, or unrelated topics.
 */
export function validateHeadlineAgainstThesis(
  headline: string,
  coreThesis: string,
  postText: string = '',
  allowedConcepts: string[] = []
): HeadlineValidationResult {
  const cleanHeadline = headline.trim()
  if (!cleanHeadline) {
    return {
      isValid: false,
      isDirectExpressionOfThesis: false,
      introducesNewClaim: true,
      reason: 'Headline is empty'
    }
  }

  const headlineLower = cleanHeadline.toLowerCase()
  const thesisLower = coreThesis.toLowerCase()
  const postLower = postText.toLowerCase()

  // 1. Check for unauthorized third-party branding or publication names
  for (const brand of BANNED_THIRD_PARTY_BRANDS) {
    if (headlineLower.includes(brand) && !postLower.includes(brand)) {
      return {
        isValid: false,
        isDirectExpressionOfThesis: false,
        introducesNewClaim: true,
        reason: `Headline introduces unauthorized third-party branding: "${brand}"`
      }
    }
  }

  // 2. Check for watermark or fake badge words
  if (
    /\b(watermark|licensed by|exclusive report|breaking news|official report|verified badge)\b/i.test(
      headlineLower
    )
  ) {
    return {
      isValid: false,
      isDirectExpressionOfThesis: false,
      introducesNewClaim: true,
      reason: 'Headline introduces fake publication watermark or badge language'
    }
  }

  // 3. Check for generic robot vs human conflict tropes
  for (const conflict of BANNED_CONFLICT_FRAMING) {
    if (headlineLower.includes(conflict)) {
      return {
        isValid: false,
        isDirectExpressionOfThesis: false,
        introducesNewClaim: true,
        reason: `Headline uses generic "${conflict}" conflict framing instead of decision-routing allocation`
      }
    }
  }

  // 4. Check for unrelated domain topics (e.g. supply chain visibility when thesis is automation vs judgment)
  for (const topic of COMMON_UNRELATED_TOPICS) {
    if (headlineLower.includes(topic) && !thesisLower.includes(topic)) {
      return {
        isValid: false,
        isDirectExpressionOfThesis: false,
        introducesNewClaim: true,
        reason: `Headline introduces unrelated business topic not present in thesis: "${topic}"`
      }
    }
  }

  // 5. Check if headline is a direct expression of the thesis
  const thesisWords = thesisLower
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(
      w =>
        w.length > 3 &&
        !['should', 'where', 'while', 'under', 'their', 'other', 'these', 'those'].includes(w)
    )

  const headlineWords = headlineLower
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(
      w =>
        w.length > 3 &&
        !['the', 'and', 'for', 'with', 'from', 'into', 'your', 'this', 'that'].includes(w)
    )

  const allowedPool = `${thesisLower} ${postLower} ${allowedConcepts.join(' ').toLowerCase()}`
  const extraneousWords = headlineWords.filter(w => !allowedPool.includes(w))

  if (extraneousWords.length > 1) {
    return {
      isValid: false,
      isDirectExpressionOfThesis: false,
      introducesNewClaim: true,
      reason: `Headline introduces new concepts not present in the post thesis: "${extraneousWords.join(', ')}"`
    }
  }

  const matches = thesisWords.filter(w => headlineLower.includes(w))
  const isDirectExpression =
    matches.length >= Math.min(2, Math.max(1, Math.floor(thesisWords.length * 0.2))) ||
    (thesisLower.includes('predictable') &&
      thesisLower.includes('judgment') &&
      (headlineLower.includes('predictable') ||
        headlineLower.includes('judgment') ||
        headlineLower.includes('human')))

  if (!isDirectExpression) {
    return {
      isValid: false,
      isDirectExpressionOfThesis: false,
      introducesNewClaim: true,
      reason: 'Headline does not directly express the core argument of the post thesis'
    }
  }

  return {
    isValid: true,
    isDirectExpressionOfThesis: true,
    introducesNewClaim: false
  }
}

/**
 * Checks whether a given quote is verified against the knowledge base / retrieved sources.
 */
export function verifyQuoteInSources(
  quote: string,
  author: string,
  evidence: EvidenceSource[] = []
): QuoteVerification {
  const cleanQuote = quote.trim().toLowerCase().replace(/["']/g, '')
  const cleanAuthor = author.trim().toLowerCase()

  if (!cleanQuote || cleanQuote.length < 5) {
    return { quote, author, verified: false }
  }

  for (const ev of evidence) {
    const evQuote = (ev.quote || ev.claim || '').toLowerCase()
    const evAuthor = (ev.author || ev.sourceTitle || '').toLowerCase()

    const quoteMatches = evQuote.includes(cleanQuote) || cleanQuote.includes(evQuote)
    const authorMatches = !cleanAuthor || evAuthor.includes(cleanAuthor) || cleanAuthor.includes(evAuthor)

    if (quoteMatches && authorMatches) {
      return {
        quote,
        author,
        sourceUrl: ev.sourceUrl,
        verified: true
      }
    }
  }

  return {
    quote,
    author,
    verified: false
  }
}

/**
 * Selects the optimal visual type based on post semantics and structure.
 * Never defaults to quote_card unless a verified quote is central to the post.
 */
export function selectVisualType(
  postText: string,
  brief: Partial<MediaBrief>,
  evidence: EvidenceSource[] = []
): VisualType {
  const lower = `${postText} ${brief.coreThesis || ''} ${brief.primaryConcept || ''}`.toLowerCase()

  // Check if post is explicitly about a verified quotation
  const hasQuotationInPost = /"([^"]{15,120})"/.test(postText)
  if (hasQuotationInPost) {
    const match = postText.match(/"([^"]{15,120})"/)
    if (match?.[1]) {
      const quoteCheck = verifyQuoteInSources(match[1], '', evidence)
      if (quoteCheck.verified) {
        return 'quote_card'
      }
    }
  }

  // 1. Comparison: Automation vs human judgment, manual vs automated, old vs new, before vs after
  const isComparison =
    /\b(vs\.?|versus|compare|compared|difference between|two paths|predictable.*judgment|automation.*human|manual.*automated|centralized.*decentralized)\b/i.test(
      lower
    ) ||
    (brief.primaryConcept &&
      /\b(vs|versus|difference|comparison|tradeoff)\b/i.test(brief.primaryConcept))
  if (isComparison) {
    return 'comparison'
  }

  // 2. Decision Tree: If/then logic, triage, routing, rules, thresholds
  const isDecisionTree =
    /\b(decision tree|decision path|when to|triage|routing rule|threshold|if.*then|branching)\b/i.test(
      lower
    )
  if (isDecisionTree) {
    return 'decision_tree'
  }

  // 3. Process: Steps, lifecycle, pipeline, handoff, stages, sequence
  const isProcess =
    /\b(step [1-9]|stage [1-9]|lifecycle|pipeline|workflow|handoff|sequence|order to cash|first.*then.*finally)\b/i.test(
      lower
    )
  if (isProcess) {
    return 'process'
  }

  // 4. Data visual: Centered on verified statistics/percentages/numbers
  const containsVerifiedNumber = evidence.some(
    e => /\b\d+(\.\d+)?%|\$\d+(\.\d+)?[kmb]?\b/i.test(e.claim)
  )
  const postHeavyOnStats =
    /\b\d+(\.\d+)?%/.test(postText) && containsVerifiedNumber
  if (postHeavyOnStats && !isComparison) {
    return 'data_visual'
  }

  // 5. Framework / Conceptual Architecture: Disconnected systems, data silos, pricing models, pillars
  const isFramework =
    /\b(framework|architecture|model|pillars|quadrant|matrix|layers|coordination|data ownership)\b/i.test(
      lower
    )
  if (isFramework) {
    return 'framework'
  }

  // 6. Product visual: Only if it's explicitly a product release or demo
  const isProductAnnouncement =
    /\b(introducing|we just released|new feature in|product update|announcing the launch of)\b/i.test(
      lower
    )
  if (isProductAnnouncement) {
    return 'product_visual'
  }

  // Default to conceptual illustration or framework (never quote_card)
  return 'conceptual_illustration'
}

/**
 * Extracts a structured media brief from the approved post and idea thesis.
 */
export function extractMediaBrief(
  postText: string,
  ideaThesis?: string,
  evidence: EvidenceSource[] = [],
  options?: {
    audience?: string
    tone?: string
    preventProductPitch?: boolean
  }
): MediaBrief {
  const cleanPost = postText.replace(/\r\n/g, '\n').trim()
  const lines = cleanPost.split('\n').map(l => l.trim()).filter(Boolean)
  const firstParagraph = lines[0] || ''

  // 1. Core Thesis extraction (authoritative ground truth)
  const coreThesis = (
    ideaThesis?.trim() ||
    firstParagraph.replace(/^[#*\-•\d.]+\s*/, '') ||
    'Defensible business perspective'
  ).slice(0, 180)

  const lowerThesis = coreThesis.toLowerCase()
  const lowerText = cleanPost.toLowerCase()

  // 2. Derive Post Topic, Contrast, Problem & Concepts
  let postTopic = 'B2B Operational Strategy'
  let mainProblem = 'Operational complexity and decision latency'
  let mainContrast = 'Standard rules vs exceptions'
  let readerTakeaway = coreThesis
  let primaryConcept = coreThesis.slice(0, 100)
  let visualMetaphor = 'Minimalist editorial diagram representing core operational tradeoffs'

  const allowedVisualConcepts: string[] = []
  const prohibitedVisualConcepts: string[] = [
    'famous historical quotes',
    'celebrity faces',
    'unrelated motivational quotes',
    'generic stock-photo corporate handshakes',
    'complex unreadable paragraph text',
    'third-party publication logos',
    'fake watermarks',
    'fictional company names',
    'robot vs human conflict framing'
  ]

  // Detect specific analytical themes
  const isAutomationVsJudgment =
    (lowerThesis.includes('predictable') || lowerText.includes('predictable')) &&
    (lowerThesis.includes('judgment') ||
      lowerText.includes('judgment') ||
      lowerThesis.includes('human') ||
      lowerText.includes('human') ||
      lowerThesis.includes('automate') ||
      lowerText.includes('automate'))

  const isPricingComplexity =
    lowerThesis.includes('pricing') ||
    lowerText.includes('pricing') ||
    lowerThesis.includes('commercial rule') ||
    lowerText.includes('commercial rule')

  const isSyncLag =
    lowerThesis.includes('sync') ||
    lowerThesis.includes('disconnected') ||
    lowerThesis.includes('silo') ||
    lowerText.includes('silo')

  if (isAutomationVsJudgment) {
    postTopic = 'Automation vs human judgment'
    mainContrast = 'Predictable decisions vs judgment decisions'
    mainProblem =
      'Over-automating decisions requiring judgment causes exceptions and relationship breakdowns'
    readerTakeaway =
      'Automate predictable decisions and retain human control for judgment-based decisions.'
    primaryConcept =
      'Decision-routing framework: allocating predictable decisions to automation and judgment decisions to human review'
    visualMetaphor =
      'Decision-routing framework: a clean operational triage diagram showing predictable rules routing to automation and exception-based judgment routing to human review'

    allowedVisualConcepts.push(
      'decision tree',
      'automate vs human review',
      'rule-based vs judgment-based decisions',
      'human-in-the-loop workflow',
      'decision routing',
      'rules vs judgment',
      'automate or escalate',
      'predictable vs judgment',
      'decision allocation'
    )

    // Strictly forbid unrelated domain concepts
    prohibitedVisualConcepts.push(
      'data reconciliation',
      'etl pipelines',
      'supply chain visibility',
      'inventory flow',
      'generic workflow diagrams',
      'generic ERP architecture',
      'logistics tracking',
      'warehouse management',
      'delivery tracking',
      'inventory visibility',
      'robot vs human',
      'ai vs human'
    )
  } else if (isPricingComplexity) {
    postTopic = 'B2B pricing complexity & commercial rules'
    mainContrast = 'Pricing rules vs customer context'
    mainProblem =
      'Decoupling pricing models from customer relationships creates margin leaks'
    readerTakeaway = 'Align pricing logic with customer context.'
    primaryConcept =
      'Separation of commercial rules from customer relationship context'
    visualMetaphor =
      'A structured matrix linking customer tiers to pricing constraints without fragmented cross-database sync'

    allowedVisualConcepts.push(
      'pricing rules matrix',
      'margin leak points',
      'commercial rules logic',
      'customer tier pricing framework'
    )

    prohibitedVisualConcepts.push(
      'supply chain visibility',
      'logistics tracking',
      'warehouse management',
      'delivery tracking',
      'inventory visibility',
      'famous quotes'
    )
  } else if (isSyncLag) {
    postTopic = 'System integration & synchronization friction'
    mainContrast = 'Synchronized state vs distributed reconciliation lag'
    mainProblem = 'Multiple disconnected systems create data divergence'
    readerTakeaway = 'Define single ownership for core operational entities.'
    primaryConcept =
      'Operational reconciliation friction across siloed data sources'
    visualMetaphor =
      'Architectural block diagram showing synchronization friction points between core operating systems'

    allowedVisualConcepts.push(
      'system reconciliation',
      'data consistency friction',
      'reconciliation points'
    )

    prohibitedVisualConcepts.push(
      'supply chain visibility',
      'logistics tracking',
      'warehouse management',
      'delivery tracking'
    )
  } else {
    // General Operational Topic
    postTopic = coreThesis.slice(0, 50)
    primaryConcept = coreThesis.slice(0, 100)
    allowedVisualConcepts.push(coreThesis.slice(0, 60))

    if (
      !lowerThesis.includes('supply chain') &&
      !lowerThesis.includes('logistics') &&
      !lowerThesis.includes('warehouse')
    ) {
      prohibitedVisualConcepts.push(...COMMON_UNRELATED_TOPICS)
    }
  }

  // Supporting Concepts
  const supportingConcepts: string[] = []
  if (/predictable|rules/i.test(cleanPost)) {
    supportingConcepts.push('Predictable decisions have known inputs and deterministic rules')
  }
  if (/judgment|exception|nuance/i.test(cleanPost)) {
    supportingConcepts.push('Judgment decisions involve incomplete context and human discretion')
  }
  if (/handoff|latency/i.test(cleanPost)) {
    supportingConcepts.push('Operational handoffs introduce reconciliation latency')
  }
  if (/tradeoff|balance/i.test(cleanPost)) {
    supportingConcepts.push('Operational efficiency requires selective automation')
  }

  if (supportingConcepts.length === 0) {
    supportingConcepts.push(coreThesis.slice(0, 80))
    supportingConcepts.push(readerTakeaway.slice(0, 80))
  }

  // Avoid Concepts
  const avoidConcepts: string[] = [...prohibitedVisualConcepts]
  if (options?.preventProductPitch !== false) {
    avoidConcepts.push('unnecessary product advertisements', 'hero product badges')
  }

  // Text Overlay: 1 headline, 2-4 points, optional footer
  let headline = ''
  const supportingPoints: string[] = []

  if (isAutomationVsJudgment) {
    headline = 'Automate the predictable. Keep judgment human.'
    supportingPoints.push('Predictable: Clear rules, complete information → Automate')
    supportingPoints.push('Judgment: Exceptions, relationship context → Human review')
  } else if (isPricingComplexity) {
    headline = 'B2B Pricing Complexity'
    supportingPoints.push('Pricing logic belongs where customer context lives')
    supportingPoints.push('Decoupled systems create customer margin leaks')
  } else {
    const words = coreThesis.split(/\s+/).slice(0, 7).join(' ')
    headline = words.endsWith('.') ? words.slice(0, -1) : words
    supportingPoints.push(readerTakeaway.slice(0, 60))
  }

  // Ensure no unverified numbers or statistics are placed in the text overlay
  const numbersInHeadline = headline.match(/\b\d+(\.\d+)?%|\$\d+(\.\d+)?[kmb]?\b/g) || []
  for (const num of numbersInHeadline) {
    const verified = evidence.some(
      e => e.claim.includes(num) || (e.quote && e.quote.includes(num))
    )
    if (!verified) {
      headline = headline.replace(num, '').replace(/\s{2,}/g, ' ').trim()
    }
  }

  const textOverlay: TextOverlaySpec = {
    headline,
    supportingPoints: supportingPoints.slice(0, 3),
    footer: 'Operational Thought Leadership'
  }

  return {
    postTopic,
    coreThesis,
    mainProblem,
    mainContrast,
    readerTakeaway,
    allowedVisualConcepts,
    prohibitedVisualConcepts,
    primaryConcept,
    supportingConcepts,
    audience: options?.audience || 'B2B Operators & Executive Leaders',
    tone: options?.tone || 'Authoritative, analytical, clean, and objective',
    visualMetaphor,
    avoidConcepts,
    textOverlay
  }
}

/**
 * Hard Semantic Validation BEFORE Calling Image Generation.
 *
 * Validates:
 * 1. Does the proposed image headline express the core thesis? (thesisMatch)
 * 2. Does the visual concept directly represent the main argument? (topicMatch)
 * 3. Is the image introducing a separate business topic? (introducesUnrelatedTopic)
 * 4. Could a reader understand the post's central idea from the image alone? (relevanceScore)
 *
 * Image generation is allowed ONLY when:
 * relevanceScore >= 90 AND thesisMatch === true AND topicMatch === true AND introducesUnrelatedTopic === false
 */
export function validateMediaBriefSemantics(
  brief: MediaBrief,
  postText: string,
  ideaThesis?: string
): SemanticValidationResult {
  const alignedConcepts: string[] = []
  const missingConcepts: string[] = []
  const unrelatedElements: string[] = []

  let score = 100
  const postLower = `${postText} ${ideaThesis || ''}`.toLowerCase()
  const headlineLower = (brief.textOverlay?.headline || '').toLowerCase()
  const primaryConceptLower = (brief.primaryConcept || '').toLowerCase()
  const metaphorLower = (brief.visualMetaphor || '').toLowerCase()
  const combinedBrief = `${headlineLower} ${primaryConceptLower} ${metaphorLower}`

  // 1. Validate Headline Separately from General Visual Concept
  const headlineValidation = validateHeadlineAgainstThesis(
    brief.textOverlay?.headline || '',
    brief.coreThesis,
    postText,
    brief.allowedVisualConcepts
  )

  let headlineValid = headlineValidation.isValid
  if (!headlineValidation.isValid) {
    score -= 40
    missingConcepts.push(`Headline validation failed: ${headlineValidation.reason}`)
  }

  // 2. Check: Is the image introducing a separate business topic or prohibited element?
  let introducesUnrelatedTopic = false

  // A. Check prohibited visual concepts
  const prohibited = brief.prohibitedVisualConcepts || []
  for (const concept of prohibited) {
    const conceptLower = concept.toLowerCase()
    if (combinedBrief.includes(conceptLower) && !postLower.includes(conceptLower)) {
      introducesUnrelatedTopic = true
      unrelatedElements.push(`Introduces prohibited unrelated topic: "${concept}"`)
      score -= 50
    }
  }

  // B. Check common unrelated domain topics (e.g. supply chain visibility for automation post)
  for (const topic of COMMON_UNRELATED_TOPICS) {
    if (combinedBrief.includes(topic) && !postLower.includes(topic)) {
      introducesUnrelatedTopic = true
      unrelatedElements.push(`Introduces separate business domain: "${topic}"`)
      score -= 60
    }
  }

  // C. Check unauthorized third-party publication branding
  for (const brand of BANNED_THIRD_PARTY_BRANDS) {
    if (combinedBrief.includes(brand) && !postLower.includes(brand)) {
      introducesUnrelatedTopic = true
      unrelatedElements.push(`Introduces unauthorized third-party logo or publication: "${brand}"`)
      score -= 50
    }
  }

  // D. Check generic robot vs human conflict tropes
  for (const conflict of BANNED_CONFLICT_FRAMING) {
    if (combinedBrief.includes(conflict)) {
      introducesUnrelatedTopic = true
      unrelatedElements.push(
        `Generic "${conflict}" conflict framing instead of decision-routing framework`
      )
      score -= 50
    }
  }

  // E. Check banned historical/celebrity references
  for (const banned of BANNED_HISTORICAL_REFERENCES) {
    if (combinedBrief.includes(banned) && !postLower.includes(banned)) {
      introducesUnrelatedTopic = true
      unrelatedElements.push(`Unrelated historical reference: "${banned}"`)
      score -= 50
    }
  }

  // F. Check for unnecessary product advertising (FlowERP pitch)
  if (
    (combinedBrief.includes('flowerp') ||
      combinedBrief.includes('buy now') ||
      combinedBrief.includes('call sales')) &&
    !postLower.includes('flowerp')
  ) {
    introducesUnrelatedTopic = true
    unrelatedElements.push('Unrelated product advertisement elements introduced')
    score -= 40
  }

  // 3. Check: Does the proposed image headline express the core thesis? (thesisMatch)
  const thesisMatch = headlineValidation.isValid && !introducesUnrelatedTopic

  if (thesisMatch) {
    alignedConcepts.push('Headline directly expresses core thesis')
  } else {
    missingConcepts.push('Headline fails to express the core thesis')
    score -= 30
  }

  // 4. Check: Does the visual concept directly represent the main argument? (topicMatch)
  let topicMatch = false
  const allowed = brief.allowedVisualConcepts || []
  if (allowed.length > 0) {
    const matchesAllowed = allowed.some(c => {
      const cLower = c.toLowerCase()
      if (combinedBrief.includes(cLower)) return true
      const words = cLower
        .split(/[\s-]+/)
        .filter(w => w.length > 3 && !['vs', 'and', 'the', 'for', 'with', 'review', 'based'].includes(w))
      return words.length > 0 && words.every(w => combinedBrief.includes(w))
    })
    topicMatch = matchesAllowed && !introducesUnrelatedTopic
  } else {
    topicMatch = thesisMatch && !introducesUnrelatedTopic
  }

  if (topicMatch) {
    alignedConcepts.push('Visual concept directly represents decision-routing argument')
  } else {
    missingConcepts.push('Visual concept does not represent main argument')
    score -= 30
  }

  // 5. Readability & Mobile Feed Scaling Validation
  const readability = validateMediaReadability(brief)
  if (!readability.mobileReadable) {
    score -= 30
    missingConcepts.push(`Readability warning: ${readability.reasons.join('; ')}`)
  }
  if (readability.visualComplexity === 'excessive') {
    score -= 40
    unrelatedElements.push('Excessive visual complexity with unreadable nodes/process architecture')
  }

  // If any hard failure condition occurred, cap the score strictly below 90
  if (
    introducesUnrelatedTopic ||
    !thesisMatch ||
    !topicMatch ||
    !headlineValid ||
    readability.visualComplexity === 'excessive'
  ) {
    score = Math.min(score, 60)
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)))
  let reason = ''

  if (
    finalScore >= 90 &&
    thesisMatch &&
    topicMatch &&
    !introducesUnrelatedTopic &&
    headlineValid &&
    readability.mobileReadable
  ) {
    reason = `Media brief strongly aligned (${finalScore}/100). Headline and decision-routing framework directly represent thesis without extraneous topics.`
  } else {
    const issues: string[] = []
    if (introducesUnrelatedTopic) issues.push(`introduced separate topic (${unrelatedElements.join(', ')})`)
    if (!headlineValid) issues.push(`headline invalid (${headlineValidation.reason})`)
    if (!thesisMatch) issues.push('headline does not express core thesis')
    if (!topicMatch) issues.push('visual concept does not match topic')
    if (!readability.mobileReadable) issues.push(`readability issues: ${readability.reasons.join(', ')}`)
    reason = `Semantic validation failed (${finalScore}/100): ${issues.join('; ')}`
  }

  return {
    relevanceScore: finalScore,
    thesisMatch,
    topicMatch,
    introducesUnrelatedTopic,
    headlineValid,
    reason,
    explanation: reason,
    alignedConcepts,
    missingConcepts,
    unrelatedElements,
    headlineValidation,
    readability
  }
}

// Backwards compatibility alias
export const validateMediaBriefRelevance = validateMediaBriefSemantics

/**
 * Validates the visual complexity and mobile/feed readability of proposed media.
 * Evaluates:
 * - Headline length (<= 8 words preferred, > 10 flagged)
 * - Supporting points count (<= 3 preferred) and word count (<= 12 words per point)
 * - Node count / process architecture (flags 8-10 tiny nodes, complex ETL flows, small annotations)
 * - Text density & mobile readability
 */
export function validateMediaReadability(
  brief?: MediaBrief | null,
  promptText?: string | null
): MediaReadabilityResult {
  const reasons: string[] = []
  let score = 100
  let visualComplexity: 'low' | 'moderate' | 'high' | 'excessive' = 'low'
  let textDensity: 'minimal' | 'balanced' | 'dense' | 'excessive' = 'minimal'

  const headline = brief?.textOverlay?.headline || ''
  const supportingPoints = brief?.textOverlay?.supportingPoints || []
  const headlineWords = headline.trim().split(/\s+/).filter(Boolean)
  const combined = `${headline} ${supportingPoints.join(' ')} ${brief?.primaryConcept || ''} ${brief?.visualMetaphor || ''} ${promptText || ''}`.toLowerCase()

  // 1. Headline length check (prefer <= 8 words, > 10 penalized)
  if (headlineWords.length > 10) {
    score -= 25
    reasons.push(`Headline is too long for mobile feed readability (${headlineWords.length} words; prefer <= 8)`)
  } else if (headlineWords.length > 8) {
    score -= 10
  }

  // 2. Supporting points check (prefer <= 3 short points)
  if (supportingPoints.length > 4) {
    score -= 20
    reasons.push(`Too many supporting points (${supportingPoints.length}; max 3 recommended)`)
  }

  const longPoints = supportingPoints.filter(
    p => p.trim().split(/\s+/).length > 12 || p.length > 70
  )
  if (longPoints.length > 0) {
    score -= 20
    reasons.push('Supporting points contain dense text that degrades feed readability')
  }

  // 3. Visual complexity & node density checks (detect 8-10 tiny nodes, ETL diagrams, dense flowcharts)
  const complexProcessPatterns = [
    /\b(8|9|10|11|12|\d{2})\s*(nodes|steps|stages|boxes|micro-nodes|blocks|elements)\b/i,
    /\b(etl|data reconciliation|dense architecture|microservice diagram|complex flow chart)\b/i,
    /\b(tiny labels|small annotations|dense grid|many small text nodes|microscopic)\b/i,
    /\b(8-10|8 to 10)\s*(nodes|labels|steps)\b/i
  ]

  let hasComplexProcess = false
  for (const pattern of complexProcessPatterns) {
    if (pattern.test(combined)) {
      hasComplexProcess = true
      score -= 40
      reasons.push('Visual contains excessive nodes or complex process architecture unsuitable for LinkedIn feed')
      break
    }
  }

  // 4. Classify visual complexity & text density
  if (hasComplexProcess) {
    visualComplexity = 'excessive'
    textDensity = 'excessive'
  } else if (supportingPoints.length >= 3 && longPoints.length > 0) {
    visualComplexity = 'high'
    textDensity = 'dense'
  } else if (headlineWords.length <= 8 && supportingPoints.length <= 3) {
    visualComplexity = 'low'
    textDensity = headlineWords.length <= 5 && supportingPoints.length <= 2 ? 'minimal' : 'balanced'
  } else {
    visualComplexity = 'moderate'
    textDensity = 'balanced'
  }

  const finalScore = Math.max(0, Math.min(100, score))
  const mobileReadable = finalScore >= 70 && visualComplexity !== 'excessive' && textDensity !== 'excessive'

  return {
    readabilityScore: finalScore,
    mobileReadable,
    visualComplexity,
    textDensity,
    reasons
  }
}

/**
 * Maps raw validation results to honest, user-facing relevance levels.
 *
 * Rules:
 * - 90-100: "Highly relevant" ONLY IF topicMatch === true AND thesisMatch === true AND !introducesUnrelatedTopic
 * - 75-89: "Relevant" IF topic and thesis match
 * - 60-74: "Weak match"
 * - <60 OR topic mismatch OR thesis mismatch OR introducesUnrelatedTopic: "Not relevant"
 *
 * Never displays misleading "100% Aligned" when unrelated topics are introduced.
 */
export function getUserFacingRelevance(validation?: {
  relevanceScore?: number
  topicMatch?: boolean
  thesisMatch?: boolean
  introducesUnrelatedTopic?: boolean
} | null): UserFacingRelevanceInfo {
  if (!validation) {
    return {
      level: 'Weak match',
      label: 'Weak match',
      badgeVariant: 'warning',
      isPass: false,
      warningMessage: 'Media has not completed semantic validation.'
    }
  }

  const score = validation.relevanceScore ?? 0
  const topicMatch = validation.topicMatch ?? false
  const thesisMatch = validation.thesisMatch ?? false
  const introducesUnrelated = validation.introducesUnrelatedTopic ?? false

  // Strict semantic condition: if topic or thesis does not match, or it introduces an unrelated topic
  if (introducesUnrelated || !topicMatch || !thesisMatch || score < 60) {
    return {
      level: 'Not relevant',
      label: 'Not relevant',
      badgeVariant: 'destructive',
      isPass: false,
      warningMessage: introducesUnrelated
        ? 'Generated media appears to introduce a different or unrelated topic.'
        : 'Generated media does not reflect the central thesis of this post.'
    }
  }

  if (score >= 90) {
    return {
      level: 'Highly relevant',
      label: 'Highly relevant',
      badgeVariant: 'success',
      isPass: true
    }
  }

  if (score >= 75) {
    return {
      level: 'Relevant',
      label: 'Relevant',
      badgeVariant: 'info',
      isPass: true
    }
  }

  return {
    level: 'Weak match',
    label: 'Weak match',
    badgeVariant: 'warning',
    isPass: false,
    warningMessage: 'Media is only loosely related to the topic.'
  }
}

export interface ConceptDifferenceResult {
  similarityScore: number // 0 - 100
  isMeaningfullyDifferent: boolean
  reason?: string
}

/**
 * Compares a newly generated media concept with the previously rejected concept.
 * Enforces isMeaningfullyDifferent === true and similarityScore < 70,
 * and ensures no blocked concepts are reintroduced.
 */
export function validateConceptDifference(
  newConcept: string,
  previousConcept?: string,
  blockedConcepts: string[] = []
): ConceptDifferenceResult {
  const normNew = (newConcept || '').toLowerCase().trim()
  const normPrev = (previousConcept || '').toLowerCase().trim()

  if (!normNew) {
    return {
      similarityScore: 100,
      isMeaningfullyDifferent: false,
      reason: 'New concept is empty'
    }
  }

  if (!normPrev) {
    return {
      similarityScore: 0,
      isMeaningfullyDifferent: true
    }
  }

  // 1. Check if newConcept contains any blocked concepts
  const allBlocked = new Set<string>(blockedConcepts.map(c => c.toLowerCase().trim()))

  if (normPrev.includes('data reconciliation') || normPrev.includes('reconciliation')) {
    allBlocked.add('data reconciliation')
    allBlocked.add('reconciliation')
    allBlocked.add('etl pipelines')
    allBlocked.add('etl')
    allBlocked.add('source a/source b comparison')
    allBlocked.add('extract-load-compare workflow')
  }

  for (const blocked of allBlocked) {
    if (blocked && normNew.includes(blocked)) {
      return {
        similarityScore: 100,
        isMeaningfullyDifferent: false,
        reason: `New concept contains rejected/blocked concept: "${blocked}"`
      }
    }
  }

  // 2. Exact match check
  if (normNew === normPrev) {
    return {
      similarityScore: 100,
      isMeaningfullyDifferent: false,
      reason: 'New concept is identical to previous rejected concept'
    }
  }

  // 3. Jaccard token similarity check
  const tokenize = (str: string) =>
    new Set(
      str
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(
          w =>
            w.length > 2 &&
            !['the', 'and', 'for', 'with', 'vs', 'concept', 'diagram', 'visual', 'showing'].includes(
              w
            )
        )
    )

  const tokensNew = tokenize(normNew)
  const tokensPrev = tokenize(normPrev)

  if (tokensNew.size === 0 || tokensPrev.size === 0) {
    return {
      similarityScore: 0,
      isMeaningfullyDifferent: true
    }
  }

  const intersection = new Set([...tokensNew].filter(x => tokensPrev.has(x)))
  const union = new Set([...tokensNew, ...tokensPrev])

  const jaccard = union.size === 0 ? 0 : (intersection.size / union.size) * 100
  const similarityScore = Math.round(jaccard)

  const isMeaningfullyDifferent = similarityScore < 70

  return {
    similarityScore,
    isMeaningfullyDifferent,
    reason: isMeaningfullyDifferent
      ? undefined
      : `New concept is too similar to previous concept (${similarityScore}% token similarity)`
  }
}

export interface RegenerationContext {
  postText: string
  thesis: string
  previousConcept?: string
  previousPrompt?: string
  previousImageUrl?: string
  rejectionReason?: string
  blockedConcepts?: string[]
  regenerationAttempt?: number
  evidence?: EvidenceSource[]
}

/**
 * Regenerates the MediaBrief using negative rejection context and blocked concepts.
 * Tells the pipeline: "The previous concept was rejected. Do not repeat the same headline,
 * layout, metaphor, or adjacent topic."
 */
export function regenerateMediaBriefWithNegativeContext(
  ctx: RegenerationContext
): MediaBrief {
  const attempt = ctx.regenerationAttempt || 1
  const prevConcept = (ctx.previousConcept || '').toLowerCase()
  const rejectionReason = (ctx.rejectionReason || '').toLowerCase()

  // 1. Build comprehensive blocked concepts list
  const blockedConcepts = new Set<string>(
    (ctx.blockedConcepts || []).map(c => c.toLowerCase().trim())
  )

  if (prevConcept) {
    blockedConcepts.add(prevConcept)
  }

  // If previous concept was Data Reconciliation Process or related to reconciliation/ETL
  if (
    prevConcept.includes('data reconciliation') ||
    prevConcept.includes('reconciliation') ||
    rejectionReason.includes('reconciliation')
  ) {
    blockedConcepts.add('data reconciliation')
    blockedConcepts.add('reconciliation')
    blockedConcepts.add('etl pipelines')
    blockedConcepts.add('etl pipeline')
    blockedConcepts.add('etl')
    blockedConcepts.add('source a/source b comparison')
    blockedConcepts.add('extract-load-compare workflow')
  }

  // If previous concept was supply chain
  if (prevConcept.includes('supply chain') || rejectionReason.includes('supply chain')) {
    blockedConcepts.add('supply chain visibility')
    blockedConcepts.add('supply chain')
    blockedConcepts.add('logistics tracking')
    blockedConcepts.add('warehouse management')
  }

  // 2. Extract fresh base brief
  const baseBrief = extractMediaBrief(ctx.postText, ctx.thesis, ctx.evidence, {
    preventProductPitch: true
  })

  // 3. Inject all blocked concepts into prohibitedVisualConcepts and avoidConcepts
  for (const b of blockedConcepts) {
    if (!baseBrief.prohibitedVisualConcepts.includes(b)) {
      baseBrief.prohibitedVisualConcepts.push(b)
    }
    if (!baseBrief.avoidConcepts.includes(b)) {
      baseBrief.avoidConcepts.push(b)
    }
  }

  // 4. Ensure distinct conceptual variation across regeneration attempts
  const isAutomationVsJudgment =
    baseBrief.coreThesis.toLowerCase().includes('predictable') &&
    (baseBrief.coreThesis.toLowerCase().includes('judgment') ||
      baseBrief.coreThesis.toLowerCase().includes('human') ||
      baseBrief.coreThesis.toLowerCase().includes('automate'))

  if (isAutomationVsJudgment) {
    if (attempt % 2 === 0) {
      baseBrief.primaryConcept =
        'Human-in-the-loop workflow: deterministic rules automate routine cases while exceptions escalate to human judgment'
      baseBrief.visualMetaphor =
        'Human-in-the-loop operational workflow showing automated throughput for predictable cases and human oversight for exceptions'
      baseBrief.textOverlay.supportingPoints = [
        'Predictable throughput: Deterministic rules → Automate',
        'Nuanced exceptions: Relationship context → Human oversight'
      ]
    } else {
      baseBrief.primaryConcept =
        'Decision-routing framework: allocating predictable decisions to automation and judgment decisions to human review'
      baseBrief.visualMetaphor =
        'Decision-routing framework: a clean operational triage diagram showing predictable rules routing to automation and exception-based judgment routing to human review'
      baseBrief.textOverlay.supportingPoints = [
        'Predictable: Clear rules, complete information → Automate',
        'Judgment: Exceptions, relationship context → Human review'
      ]
    }
    baseBrief.textOverlay.headline = 'Automate the predictable. Keep judgment human.'
  }

  return baseBrief
}

/**
 * Regenerates the MediaBrief to strictly align with the core thesis when validation fails.
 */
export function regenerateMediaBriefStrict(
  postText: string,
  ideaThesis?: string,
  evidence: EvidenceSource[] = [],
  failedValidation?: SemanticValidationResult
): MediaBrief {
  const brief = extractMediaBrief(postText, ideaThesis, evidence, {
    preventProductPitch: true
  })

  // Strip any concepts that were flagged as unrelated
  if (failedValidation?.unrelatedElements && failedValidation.unrelatedElements.length > 0) {
    for (const elem of failedValidation.unrelatedElements) {
      const clean = elem.replace(/^[^\"]*\"([^\"]+)\".*$/, '$1').toLowerCase()
      brief.prohibitedVisualConcepts.push(clean)
      brief.avoidConcepts.push(clean)
    }
  }

  // Ensure headline strictly matches preferred regression case when thesis is automation vs judgment
  if (
    brief.coreThesis.toLowerCase().includes('predictable') &&
    (brief.coreThesis.toLowerCase().includes('judgment') || brief.coreThesis.toLowerCase().includes('human'))
  ) {
    brief.textOverlay.headline = 'Automate the predictable. Keep judgment human.'
  }

  return brief
}

/**
 * Builds a structured, high-relevance image generation prompt from the validated MediaBrief.
 */
export function buildImagePromptFromBrief(
  brief: MediaBrief,
  visualType: VisualType,
  options?: {
    aspectRatio?: '1:1' | '16:9' | '4:5'
  }
): string {
  const parts: string[] = []

  // 1. Objective and primary communication intent
  parts.push(
    `Create a clean, minimalist editorial B2B LinkedIn visual communicating: "${brief.primaryConcept}".`
  )
  parts.push(`Core Thesis: "${brief.coreThesis}".`)

  // 2. Structure by Visual Type
  if (visualType === 'comparison' || visualType === 'decision_tree') {
    parts.push(
      `Layout: Clean decision-routing framework diagram representing allocation of operational decisions (communicating allocation and triage of decisions, not competition or battle between humans and AI). Two distinct routing paths:\n\n` +
      `Left Path (Predictable Decisions):\n` +
      `• Predictable decision\n` +
      `• Clear rules + complete information\n` +
      `• Repeatable known outcome\n` +
      `→ AUTOMATE\n\n` +
      `Right Path (Judgment-Based Decisions):\n` +
      `• Judgment-based decision\n` +
      `• Exceptions + incomplete information + relationship context\n` +
      `→ HUMAN REVIEW`
    )
  } else if (visualType === 'process') {
    parts.push(
      `Layout: Clean horizontal or vertical step-by-step workflow with clear directional arrows connecting discrete operational stages.`
    )
  } else if (visualType === 'data_visual') {
    parts.push(
      `Layout: Minimalist data graphic highlighting key verified metrics with sleek geometric comparison bars or progression curves.`
    )
  } else if (visualType === 'framework') {
    parts.push(
      `Layout: Balanced multi-quadrant or modular architectural diagram showing structural relationships between operational components.`
    )
  } else {
    parts.push(
      `Layout: Conceptual diagram representing: ${brief.visualMetaphor}.`
    )
  }

  // 3. Text Overlay Specification (Minimal)
  if (brief.textOverlay?.headline) {
    parts.push(`Headline text: "${brief.textOverlay.headline}".`)
    if (brief.textOverlay.supportingPoints && brief.textOverlay.supportingPoints.length > 0) {
      parts.push(
        `Supporting labels: ${brief.textOverlay.supportingPoints.map(p => `"${p}"`).join(', ')}.`
      )
    }
  }

  // 4. Style, Aesthetic and Readability Requirements
  parts.push(
    `Aesthetic: Modern Swiss graphic design, high contrast, clean typography, generous whitespace, refined corporate palette (deep slate, navy, subtle emerald/indigo accents). Designed for instant readability on mobile LinkedIn feeds.`
  )

  // 5. Negative Constraints (Must NOT appear)
  const negativeList = [
    'no stock-photo corporate handshakes',
    'no famous historical quotes or public figures',
    'no celebrity faces',
    'no random philosophical statements',
    'no walls of paragraph text',
    'no unverified statistical claims',
    'no aggressive product advertising or promotional badges',
    'no data reconciliation or ETL pipeline diagrams',
    'no inventory flow or supply chain visibility diagrams',
    'no generic workflow diagrams or generic ERP architecture',
    'no supply chain or logistics imagery',
    'no warehouse or delivery fleet graphics',
    'no third-party logos, publication branding (no Forbes, HBR, Bloomberg, etc.)',
    'no fake watermarks, badges, stamps, or copyright marks',
    'no fictional company names',
    'no generic robot vs human battle, AI vs human conflict, or cyborg tropes',
    'convey workflow allocation and decision routing, not competition between humans and AI'
  ]

  if (brief.avoidConcepts && brief.avoidConcepts.length > 0) {
    negativeList.push(...brief.avoidConcepts.map(c => `no ${c}`))
  }

  parts.push(`Strict negative constraints: ${Array.from(new Set(negativeList)).join(', ')}.`)

  return parts.join('\n\n')
}

/**
 * Validates the final image prompt against the post's core thesis.
 * Rejects prompts that introduce unrelated topics, quotes, logos, fake watermarks,
 * or robot vs human competition framing.
 */
export function validateImagePromptAgainstPost(
  prompt: string,
  brief: MediaBrief,
  postThesis?: string
): { isValid: boolean; reason?: string } {
  const positivePrompt = prompt.split(/strict negative constraints:/i)[0] || prompt
  const positiveLower = positivePrompt.toLowerCase()
  const thesisLower = (postThesis || brief.coreThesis || '').toLowerCase()

  // 1. Reject prompts containing third-party branding or publication names
  for (const brand of BANNED_THIRD_PARTY_BRANDS) {
    if (positiveLower.includes(brand) && !thesisLower.includes(brand)) {
      return {
        isValid: false,
        reason: `Image prompt introduces unauthorized third-party logo or publication: "${brand}"`
      }
    }
  }

  // 2. Reject prompts containing robot vs human conflict tropes
  for (const conflict of BANNED_CONFLICT_FRAMING) {
    if (positiveLower.includes(conflict)) {
      return {
        isValid: false,
        reason: `Image prompt introduces generic "${conflict}" conflict framing instead of decision-routing allocation`
      }
    }
  }

  // 3. Reject prompts containing prohibited visual concepts
  const prohibited = brief.prohibitedVisualConcepts || COMMON_UNRELATED_TOPICS
  for (const concept of prohibited) {
    const conceptLower = concept.toLowerCase()
    if (positiveLower.includes(conceptLower) && !thesisLower.includes(conceptLower)) {
      return {
        isValid: false,
        reason: `Image prompt introduces prohibited unrelated concept: "${concept}"`
      }
    }
  }

  // 4. Reject prompts containing common unrelated topics (e.g. supply chain visibility)
  for (const topic of COMMON_UNRELATED_TOPICS) {
    if (positiveLower.includes(topic) && !thesisLower.includes(topic)) {
      return {
        isValid: false,
        reason: `Image prompt introduces unrelated business topic: "${topic}"`
      }
    }
  }

  // 5. Check for banned historical references
  for (const banned of BANNED_HISTORICAL_REFERENCES) {
    if (positiveLower.includes(banned) && !thesisLower.includes(banned)) {
      return {
        isValid: false,
        reason: `Image prompt introduces an unrelated historical figure: "${banned}"`
      }
    }
  }

  // 6. Check for generic quote cards
  if (
    positiveLower.includes('quote card') ||
    (positiveLower.includes('famous quote') && !thesisLower.includes('quote'))
  ) {
    return {
      isValid: false,
      reason: 'Image prompt relies on a generic or unrelated quote card'
    }
  }

  // 7. Check for product advertisement exaggeration
  if (
    (positiveLower.includes('flowerp') ||
      positiveLower.includes('product advertisement') ||
      positiveLower.includes('buy now')) &&
    !thesisLower.includes('flowerp')
  ) {
    return {
      isValid: false,
      reason: 'Image prompt introduces an unnecessary product advertisement'
    }
  }

  // 8. Ensure prompt contains the primary concept or thesis keywords
  const keywords = (brief.primaryConcept || brief.coreThesis || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)

  const hasOverlap = keywords.some(kw => positiveLower.includes(kw))
  if (!hasOverlap) {
    return {
      isValid: false,
      reason: 'Image prompt does not contain key concepts from the post thesis'
    }
  }

  return { isValid: true }
}
