import { checkNovelty } from '../novelty'
import { filterDiverseIdeas } from './idea-diversity'
import type { GeneratedIdeaItem } from './skills/ideation/schema'

/**
 * The selected goals in turn, `count` long: which goal each candidate idea is
 * asked to serve, and each goal's share of a run. Every goal picked for a run
 * counts the same; the first goals take any remainder.
 */
export function spreadGoals<T>(goals: T[], count: number): T[] {
  if (goals.length === 0) return []
  return Array.from({ length: count }, (_, i) => goals[i % goals.length]!)
}

/**
 * Takes `targetCount` ideas from a ranked list so each goal gets its share.
 * Cutting by score alone let the goal the model wrote best about take every
 * place, leaving another goal the user picked with no ideas at all. A goal
 * short of candidates gives its places to the best of the rest.
 */
export function balanceByGoal(
  ranked: GeneratedIdeaItem[],
  goalIds: string[],
  targetCount: number
): GeneratedIdeaItem[] {
  if (goalIds.length < 2) return ranked.slice(0, targetCount)

  const quota = new Map<string, number>()
  for (const id of spreadGoals(goalIds, targetCount)) {
    quota.set(id, (quota.get(id) ?? 0) + 1)
  }

  const taken = new Set<GeneratedIdeaItem>()
  for (const idea of ranked) {
    const left = idea.goalId ? (quota.get(idea.goalId) ?? 0) : 0
    if (left > 0) {
      taken.add(idea)
      quota.set(idea.goalId!, left - 1)
    }
  }
  for (const idea of ranked) {
    if (taken.size >= targetCount) break
    taken.add(idea)
  }
  // Keep the ranking order within the chosen set.
  return ranked.filter(i => taken.has(i)).slice(0, targetCount)
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
  /** The run's goals; with two or more, each gets its share of the set. */
  goalIds: string[] = []
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
    goalIds.length > 1 ? fresh.length : targetCount
  ).selected
  const selected = balanceByGoal(diverse, goalIds, targetCount)
  return { selected, discarded }
}
