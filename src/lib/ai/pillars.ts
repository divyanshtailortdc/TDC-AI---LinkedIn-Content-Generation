import type { ContentPillar } from '@/db/schema'

/**
 * Picks a pillar using the configured weights rather than round-robin, so a
 * 60% pillar actually shows up about 60% of the time across a run.
 */
export function pickWeightedPillars(
  pillars: ContentPillar[],
  count: number
): ContentPillar[] {
  if (pillars.length === 0) return []

  const total = pillars.reduce((sum, p) => sum + (p.weight_pct || 0), 0)
  if (total <= 0) {
    return Array.from({ length: count }, (_, i) => pillars[i % pillars.length]!)
  }

  // Largest-remainder allocation: deterministic and exactly `count` items.
  const exact = pillars.map(p => ((p.weight_pct || 0) / total) * count)
  const allocation = exact.map(Math.floor)
  let assigned = allocation.reduce((a, b) => a + b, 0)

  const remainders = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder)

  let cursor = 0
  while (assigned < count && remainders.length > 0) {
    allocation[remainders[cursor % remainders.length]!.index]! += 1
    assigned++
    cursor++
  }

  const picked: ContentPillar[] = []
  allocation.forEach((n, i) => {
    for (let k = 0; k < n; k++) picked.push(pillars[i]!)
  })
  return picked.slice(0, count)
}
