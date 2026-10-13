export type HashtagRange = { min: number; max: number }

/**
 * Reads a count out of the voice's free-text hashtag policy: "0-3, end of
 * post" is 0 to 3, "none" is 0, "5-7 relevant tags" is 5 to 7. Returns null
 * when the policy names no count, so the linter does not invent one.
 */
export function parseHashtagPolicy(
  policy: string | null | undefined
): HashtagRange | null {
  const text = (policy || '').toLowerCase()
  const range = /(\d+)\s*(?:-|–|to)\s*(\d+)/.exec(text)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    return { min: Math.min(a, b), max: Math.max(a, b) }
  }
  const single = /\d+/.exec(text)
  if (single) return { min: Number(single[0]), max: Number(single[0]) }
  if (/\b(none|no)\b/.test(text)) return { min: 0, max: 0 }
  return null
}
