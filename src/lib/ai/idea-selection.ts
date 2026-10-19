import type { ContentPillar } from '@/db/schema'
import { checkNovelty } from '../novelty'
import { filterDiverseIdeas } from './idea-diversity'
import { pickWeightedPillars } from './pillars'
import type { GeneratedIdeaItem } from './skills/ideation/schema'

const pillarKey = (name: string | undefined | null) =>
  (name || '').trim().toLowerCase()

/**
 * Takes `targetCount` ideas from a ranked list so each pillar gets the share
 * its weight asks for. Candidates are generated with pillars assigned, but the
 * best-scoring ones are not spread evenly, so cutting by score alone left a
 * pillar with no ideas at all. A pillar short of candidates gives its places
 * to the best of the rest.
 */
export function balanceByPillar(
  ranked: GeneratedIdeaItem[],
  pillars: ContentPillar[],
  targetCount: number
): GeneratedIdeaItem[] {
  if (pillars.length < 2) return ranked.slice(0, targetCount)

  const quota = new Map<string, number>()
  for (const p of pickWeightedPillars(pillars, targetCount)) {
    quota.set(pillarKey(p.name), (quota.get(pillarKey(p.name)) ?? 0) + 1)
  }

  const taken = new Set<GeneratedIdeaItem>()
  for (const idea of ranked) {
    const key = pillarKey(idea.pillar)
    const left = quota.get(key) ?? 0
    if (left > 0) {
      taken.add(idea)
      quota.set(key, left - 1)
    }
  }
  for (const idea of ranked) {
    if (taken.size >= targetCount) break
    taken.add(idea)
  }
  // Keep the ranking order within the chosen set.
  return ranked.filter(i => taken.has(i)).slice(0, targetCount)
}

/** The configured spelling of a pillar the model named, if it names one. */
function canonicalPillar(
  name: string,
  pillars: ContentPillar[]
): string {
  return pillars.find(p => pillarKey(p.name) === pillarKey(name))?.name ?? name
}

/**
 * Picks the ideas a run keeps from its candidates.
 *
 * Ideas this account has already drafted or been shown are dropped first, and
 * only then is the target count taken. Cutting to the count first meant every
 * repeat took a place from an idea that was still available, so a run came up
 * short, or empty, while fresh candidates went unused.
 */
export function selectIdeas(
  candidates: GeneratedIdeaItem[],
  pastWork: Array<{ hook: string; body: string }>,
  targetCount: number,
  /** The account's pillars; when there are two or more, their weights shape the set. */
  pillars: ContentPillar[] = []
): {
  selected: GeneratedIdeaItem[]
  /** Repeats dropped before selection, with why. */
  discarded: Array<{ title: string; reason: string }>
} {
  const discarded: Array<{ title: string; reason: string }> = []
  const fresh =
    pastWork.length === 0
      ? candidates
      : candidates.filter(idea => {
          const novelty = checkNovelty(
            idea.hookConcept,
            `${idea.title} ${idea.thesis} ${idea.coreArgument}`,
            pastWork
          )
          if (!novelty.isNovel) {
            discarded.push({
              title: idea.title,
              reason: novelty.reason || 'Too similar to a recent post'
            })
          }
          return novelty.isNovel
        })

  const diverse = filterDiverseIdeas(
    fresh,
    pillars.length > 1 ? fresh.length : targetCount
  ).selected
  const selected = balanceByPillar(diverse, pillars, targetCount).map(idea => ({
    ...idea,
    pillar: canonicalPillar(idea.pillar, pillars)
  }))
  return { selected, discarded }
}
