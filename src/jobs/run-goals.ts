import { MAX_IDEAS_PER_RUN } from '../lib/ai/idea-selection'

/**
 * The most goals one run may serve: each leads at least one idea, and a run
 * keeps at most MAX_IDEAS_PER_RUN.
 */
export const MAX_GOALS_PER_RUN = MAX_IDEAS_PER_RUN

/** A run asked for goals it cannot use; the message is safe to show. */
export class GoalSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoalSelectionError'
  }
}

/**
 * The goals a run may serve, in the order given: each must belong to the
 * identity and be active, since a paused goal never steers a run. Throws
 * GoalSelectionError when there are none or one does not qualify.
 */
export function checkRunGoals(
  requested: string[],
  goals: Array<{ id: string; title: string; isActive: boolean }>
): string[] {
  const ids = Array.from(new Set(requested))
  if (ids.length === 0) {
    throw new GoalSelectionError('Pick at least one goal for this run.')
  }
  if (ids.length > MAX_GOALS_PER_RUN) {
    throw new GoalSelectionError(
      `Pick at most ${MAX_GOALS_PER_RUN} goals for one run.`
    )
  }
  for (const id of ids) {
    const goal = goals.find(g => g.id === id)
    if (!goal) throw new GoalSelectionError('Goal not found.')
    if (!goal.isActive) {
      throw new GoalSelectionError(
        `"${goal.title}" is paused. Resume it on Goals, or leave it out of this run.`
      )
    }
  }
  return ids
}
