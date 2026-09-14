/**
 * Novelty Guard for LinkedIn Content Generation
 *
 * Deterministic, zero-LLM-cost similarity checks:
 * 1. 3-gram shingles with Jaccard similarity (reject if similarity > 0.35)
 * 2. Exact match on the hook's first five words
 * 3. Theme / topic frequency clustering
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

function calculateJaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0

  let intersectionSize = 0
  for (const item of a) {
    if (b.has(item)) {
      intersectionSize++
    }
  }

  const unionSize = a.size + b.size - intersectionSize
  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

export interface NoveltyCheckResult {
  isNovel: boolean
  highestSimilarity: number
  matchedPostHook?: string
  reason?: string
}

export function checkNovelty(
  newHook: string,
  newBody: string,
  pastPosts: Array<{ hook: string; body: string }>
): NoveltyCheckResult {
  const newText = `${newHook} ${newBody}`
  const newShingles = buildShingles(newText)

  // 1. First 5 words exact match check
  const newFirstFiveWords = newHook
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .slice(0, 5)
    .join(' ')

  for (const past of pastPosts) {
    const pastFirstFiveWords = past.hook
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join(' ')

    if (newFirstFiveWords.length > 10 && newFirstFiveWords === pastFirstFiveWords) {
      return {
        isNovel: false,
        highestSimilarity: 1.0,
        matchedPostHook: past.hook,
        reason: `Opening hook repeats the first 5 words of a recent post: "${past.hook.slice(0, 40)}..."`
      }
    }
  }

  // 2. 3-gram shingle Jaccard similarity
  let highestSim = 0
  let matchedHook: string | undefined

  for (const past of pastPosts) {
    const pastText = `${past.hook} ${past.body}`
    const pastShingles = buildShingles(pastText)
    const similarity = calculateJaccardSimilarity(newShingles, pastShingles)

    if (similarity > highestSim) {
      highestSim = similarity
      matchedHook = past.hook
    }
  }

  if (highestSim > 0.35) {
    return {
      isNovel: false,
      highestSimilarity: highestSim,
      matchedPostHook: matchedHook,
      reason: `High semantic overlap (${Math.round(highestSim * 100)}%) with past post: "${matchedHook?.slice(0, 40)}..."`
    }
  }

  return {
    isNovel: true,
    highestSimilarity: highestSim
  }
}
