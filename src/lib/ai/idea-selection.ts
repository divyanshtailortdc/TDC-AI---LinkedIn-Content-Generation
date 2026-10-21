import { checkNovelty } from '../novelty'
import {
  calculateThesisSimilarity,
  filterDiverseIdeas,
  ideaQuality
} from './idea-diversity'
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

/** The most ideas one run keeps (and so the most goals one run may serve). */
export const MAX_IDEAS_PER_RUN = 12

/**
 * How many ideas a run keeps: the account's ideas per run, raised so each
 * goal picked can lead one, between 3 and MAX_IDEAS_PER_RUN.
 */
export function ideaTarget(
  ideasPerRun: number | undefined,
  goalCount: number
): number {
  return Math.max(
    3,
    Math.min(Math.max(ideasPerRun || 5, goalCount), MAX_IDEAS_PER_RUN)
  )
}

/** Above this thesis overlap two ideas are the same idea (as in filterDiverseIdeas). */
const SAME_IDEA = 0.35

/**
 * Makes every goal picked for the run the main goal of at least one idea.
 * Balancing alone could not: a goal whose candidates all failed the grounding
 * checks, or lost to a stronger idea of another goal in the diversity filter,
 * was left with none. A goal without an idea takes its best spare candidate
 * that is not a near copy of one already picked; at the target count, the
 * weakest extra idea of a goal that has several makes room for it.
 */
export function coverEveryGoal(
  selected: GeneratedIdeaItem[],
  spares: GeneratedIdeaItem[],
  goalIds: string[],
  targetCount: number
): { selected: GeneratedIdeaItem[]; added: GeneratedIdeaItem[]; uncovered: string[] } {
  const picked = [...selected]
  const added: GeneratedIdeaItem[] = []
  const ranked = [...spares]
    .filter(s => !picked.includes(s))
    .sort((a, b) => ideaQuality(b) - ideaQuality(a))
  const countFor = (id: string) => picked.filter(i => i.goalId === id).length
  const text = (i: GeneratedIdeaItem) => `${i.thesis} ${i.coreArgument}`

  for (const goal of goalIds) {
    if (countFor(goal) > 0) continue
    const spare = ranked.find(
      c =>
        c.goalId === goal &&
        !picked.some(p => calculateThesisSimilarity(text(c), text(p)) > SAME_IDEA)
    )
    if (!spare) continue
    if (picked.length >= targetCount) {
      const weakest = [...picked]
        .reverse()
        .find(i => !i.goalId || countFor(i.goalId) > 1)
      if (weakest) picked.splice(picked.indexOf(weakest), 1)
    }
    picked.push(spare)
    added.push(spare)
  }

  return {
    selected: picked,
    added,
    uncovered: goalIds.filter(id => countFor(id) === 0)
  }
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
  /** Goals that still lead no idea: no fresh candidate of theirs was usable. */
  uncovered: string[]
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
  const balanced = balanceByGoal(diverse, goalIds, targetCount)
  const { selected, uncovered } = coverEveryGoal(
    balanced,
    fresh,
    goalIds,
    targetCount
  )
  return { selected, discarded, uncovered }
}
