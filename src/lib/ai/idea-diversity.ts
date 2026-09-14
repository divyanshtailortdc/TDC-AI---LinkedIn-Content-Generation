import { GeneratedIdeaItem, PerspectiveAngle, PERSPECTIVE_ANGLES } from './schemas'

/**
 * Builds word n-grams (shingles) for semantic overlap calculation.
 */
function buildShingles(text: string, n = 3): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)

  const shingles = new Set<string>()
  if (words.length < n) {
    if (words.length > 0) shingles.add(words.join(' '))
    return shingles
  }

  for (let i = 0; i <= words.length - n; i++) {
    shingles.add(words.slice(i, i + n).join(' '))
  }

  return shingles
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'are', 'was', 'were',
  'will', 'can', 'not', 'you', 'your', 'about', 'into', 'than', 'more', 'when', 'what', 'their'
])

function calculateJaccard(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 || setB.size === 0) return 0
  let intersectionSize = 0
  for (const item of setA) {
    if (setB.has(item)) intersectionSize++
  }
  const unionSize = setA.size + setB.size - intersectionSize
  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

/**
 * Computes semantic similarity between two ideas based on thesis and core argument,
 * combining n-gram shingles and keyword overlap to catch paraphrased theses.
 */
export function calculateThesisSimilarity(thesisA: string, thesisB: string): number {
  if (!thesisA || !thesisB) return 0

  // 1. Bigram shingles Jaccard
  const biA = buildShingles(thesisA, 2)
  const biB = buildShingles(thesisB, 2)
  const biSim = calculateJaccard(biA, biB)

  // 2. Keyword token Jaccard (filtered by length > 3 and stop words)
  const wordsA = new Set(
    thesisA
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  )
  const wordsB = new Set(
    thesisB
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  )
  const wordSim = calculateJaccard(wordsA, wordsB)

  // 3. 3-gram shingles Jaccard
  const triA = buildShingles(thesisA, 3)
  const triB = buildShingles(thesisB, 3)
  const triSim = calculateJaccard(triA, triB)

  // Blended score
  return Math.max(triSim, 0.45 * biSim + 0.55 * wordSim)
}

/**
 * Checks if a thesis is primarily about generic disconnected systems / integration sprawl
 */
export function isGenericIntegrationComplexityThesis(text: string): boolean {
  const norm = text.toLowerCase()
  const mentionsDisconnectionOrSilos = /disconnected systems|siloed systems|too many tools|point solutions|best-of-breed|multiple tools|system sprawl/i.test(norm)
  const mentionsComplexityOrIntegration = /integration overhead|reconciliation lag|integration nightmare|data silos|sync issues|too many systems/i.test(norm)
  return mentionsDisconnectionOrSilos && mentionsComplexityOrIntegration
}

export interface DiversityCheckResult {
  selected: GeneratedIdeaItem[]
  rejected: Array<{
    idea: GeneratedIdeaItem
    reason: string
    similarToId?: string
  }>
  uniqueAngles: PerspectiveAngle[]
}

/**
 * Filters and selects a diverse set of ideas:
 * 1. Checks pairwise semantic similarity of thesis & core argument (rejects similarity > 0.35)
 * 2. Enforces angle diversity (avoids stacking multiple ideas on the same perspective angle)
 * 3. Ranks by combined strength, groundingScore, and originalityScore
 */
export function filterDiverseIdeas(
  candidates: GeneratedIdeaItem[],
  targetCount = 5
): DiversityCheckResult {
  // Sort candidates by combined quality score descending
  const sorted = [...candidates].sort((a, b) => {
    const scoreA = (a.groundingScore || 80) * 0.4 + (a.originalityScore || 80) * 0.3 + (a.estimatedStrength || 80) * 0.3
    const scoreB = (b.groundingScore || 80) * 0.4 + (b.originalityScore || 80) * 0.3 + (b.estimatedStrength || 80) * 0.3
    return scoreB - scoreA
  })

  const selected: GeneratedIdeaItem[] = []
  const rejected: Array<{ idea: GeneratedIdeaItem; reason: string; similarToId?: string }> = []
  const usedAngles = new Set<PerspectiveAngle>()

  for (const candidate of sorted) {
    if (selected.length >= targetCount) {
      break
    }

    const candidateText = `${candidate.thesis} ${candidate.coreArgument}`

    // 1. Semantic similarity check against already selected ideas
    let hasSemanticDuplicate = false
    for (const existing of selected) {
      const existingText = `${existing.thesis} ${existing.coreArgument}`
      const similarity = calculateThesisSimilarity(candidateText, existingText)

      if (similarity > 0.35) {
        rejected.push({
          idea: candidate,
          reason: `High semantic thesis overlap (${Math.round(similarity * 100)}%) with "${existing.title}"`,
          similarToId: existing.title
        })
        hasSemanticDuplicate = true
        break
      }
    }

    if (hasSemanticDuplicate) {
      continue
    }

    // 1b. Check for repetitive "disconnected systems -> complexity" macro-thesis
    const isIntegrationThesis = isGenericIntegrationComplexityThesis(candidateText)
    if (isIntegrationThesis) {
      const alreadyHasIntegrationThesis = selected.some((s) =>
        isGenericIntegrationComplexityThesis(`${s.thesis} ${s.coreArgument}`)
      )
      if (alreadyHasIntegrationThesis) {
        rejected.push({
          idea: candidate,
          reason: 'Duplicate macro-thesis: Disconnected systems and integration complexity already covered. Diversifying to other operational perspectives.'
        })
        continue
      }
    }

    // 2. Perspective angle collision check
    if (usedAngles.has(candidate.perspectiveAngle) && usedAngles.size < PERSPECTIVE_ANGLES.length) {
      // If we still have unused angles and already have this angle, deprioritize unless we run out of candidates
      const remainingUnusedCandidates = sorted.filter(
        (c) => !selected.includes(c) && !rejected.some((r) => r.idea === c) && !usedAngles.has(c.perspectiveAngle)
      )

      if (remainingUnusedCandidates.length > 0) {
        rejected.push({
          idea: candidate,
          reason: `Angle "${candidate.perspectiveAngle}" already covered by an existing idea`
        })
        continue
      }
    }

    selected.push(candidate)
    usedAngles.add(candidate.perspectiveAngle)
  }

  // If still fewer than targetCount, allow secondary selections from unused candidates with lowest similarity
  if (selected.length < targetCount) {
    for (const candidate of sorted) {
      if (selected.includes(candidate)) continue
      // Do not re-add candidates that were rejected for thesis overlap or duplicate macro-thesis
      const wasRejectedForThesis = rejected.some(
        (r) =>
          r.idea === candidate &&
          (r.reason.includes('semantic thesis overlap') || r.reason.includes('Duplicate macro-thesis'))
      )
      if (wasRejectedForThesis) continue
      if (selected.length >= targetCount) break

      const candidateText = `${candidate.thesis} ${candidate.coreArgument}`
      const isIntegrationThesis = isGenericIntegrationComplexityThesis(candidateText)
      if (
        isIntegrationThesis &&
        selected.some((s) => isGenericIntegrationComplexityThesis(`${s.thesis} ${s.coreArgument}`))
      ) {
        continue
      }

      const maxSim = selected.reduce((max, existing) => {
        const sim = calculateThesisSimilarity(candidateText, `${existing.thesis} ${existing.coreArgument}`)
        return Math.max(max, sim)
      }, 0)

      if (maxSim <= 0.35) {
        selected.push(candidate)
        usedAngles.add(candidate.perspectiveAngle)
      }
    }
  }

  return {
    selected,
    rejected,
    uniqueAngles: Array.from(usedAngles)
  }
}
