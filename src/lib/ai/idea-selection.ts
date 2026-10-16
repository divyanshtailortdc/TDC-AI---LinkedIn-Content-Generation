import { checkNovelty } from '../novelty'
import { filterDiverseIdeas } from './idea-diversity'
import type { GeneratedIdeaItem } from './skills/ideation/schema'

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
  targetCount: number
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

  return { selected: filterDiverseIdeas(fresh, targetCount).selected, discarded }
}
