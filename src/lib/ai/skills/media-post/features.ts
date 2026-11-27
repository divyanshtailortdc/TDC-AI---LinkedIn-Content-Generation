import type { FeaturePriority, MediaFeature } from './schema'

/**
 * The features a piece of media demonstrates, as posts carry them: grouped
 * by the outcome they serve for the audience and ranked, so a post spends
 * its words on the lead demonstrations instead of naming every control.
 * Pure: the prompt (./prompt) and the checks (./quality) share it.
 */

const RANK: Record<FeaturePriority, number> = { lead: 0, supporting: 1, minor: 2 }

/**
 * The features grouped by the outcome they serve (feature.group, case and
 * spacing aside), the group with the strongest feature first, then in the
 * order they appear; each group's features strongest first.
 */
export function featureGroups(
  features: readonly MediaFeature[]
): Array<{ name: string; features: MediaFeature[] }> {
  const groups = new Map<string, { name: string; features: MediaFeature[] }>()
  for (const feature of features) {
    if (!feature.name.trim()) continue
    const name = feature.group.trim() || feature.name.trim()
    const key = name.toLowerCase().replace(/\s+/g, ' ')
    const group = groups.get(key)
    if (group) group.features.push(feature)
    else groups.set(key, { name, features: [feature] })
  }
  const best = (g: { features: MediaFeature[] }) =>
    Math.min(...g.features.map(f => RANK[f.priority]))
  return Array.from(groups.values())
    .map(g => ({
      ...g,
      features: [...g.features].sort((a, b) => RANK[a.priority] - RANK[b.priority])
    }))
    .sort((a, b) => best(a) - best(b))
}

/** The groups a post with room carries: those with a lead or supporting feature. */
export const groupsToCover = (features: readonly MediaFeature[]) =>
  featureGroups(features).filter(g => g.features.some(f => f.priority !== 'minor'))

