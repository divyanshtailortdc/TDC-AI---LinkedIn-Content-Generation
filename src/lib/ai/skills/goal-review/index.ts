import { isCreator } from '../../context-blocks'
import 'server-only'

import { goalLabel, type GenerationContext } from '../../context-blocks'
import { runSkill, SkillError } from '../../run-skill'
import { EMPTY_USAGE, type CallUsage } from '../../usage'
import type { GeneratedIdeaItem } from '../ideation/schema'
import { readGoalReviews } from './guard'
import { buildPrompt, instructionsFor } from './prompt'
import { GoalReviewSchema, type GoalReview } from './schema'

export { applyGoalReviews, MIN_GOAL_FIT } from './guard'
export type { GoalReview } from './schema'

const REVIEW_TIMEOUT_MS = 90_000

/**
 * Skill: a run's grounded ideas in; for each, whether it achieves the goal it
 * was written for (its reader, its message, its action), as a score and a
 * reason the approver can read. Null for an idea it could not review: the
 * call failed, or no model is configured. A failure never fails the run.
 */
export async function reviewGoalFit(
  ctx: GenerationContext,
  ideas: GeneratedIdeaItem[],
  abortSignal?: AbortSignal,
  /** The platform a run's ideas are for, when it planned for one other than LinkedIn. */
  platform?: string | null
): Promise<{ reviews: Array<GoalReview | null>; usage: CallUsage }> {
  if (ideas.length === 0) return { reviews: [], usage: EMPTY_USAGE }
  const goalIds = ctx.selectedGoals.map(goal => goal.id)
  try {
    const { output, usage } = await runSkill({
      stage: 'goal_review',
      instructions: instructionsFor(platform, isCreator(ctx)),
      prompt: buildPrompt({
        account: [ctx.account.name, ctx.account.headline]
          .filter(Boolean)
          .join(', '),
        goals: ctx.selectedGoals.map((goal, i) => ({
          label: goalLabel(i),
          title: goal.title,
          objective: goal.objective,
          keyMessage: goal.keyMessage,
          desiredAction: goal.desiredAction
        })),
        ideas: ideas.map((idea, i) => ({
          label: `I${i + 1}`,
          goalLabel: goalLabel(Math.max(0, goalIds.indexOf(idea.goalId ?? ''))),
          readers: idea.targetAudience ?? null,
          title: idea.title,
          thesis: idea.thesis,
          hookConcept: idea.hookConcept,
          coreArgument: idea.coreArgument,
          audienceTakeaway: idea.audienceTakeaway
        }))
      }),
      schema: GoalReviewSchema,
      timeoutMs: REVIEW_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal
    })
    return { reviews: readGoalReviews(output, ideas.length), usage }
  } catch (err) {
    console.warn('Goal review failed; keeping the ideas unreviewed:', err)
    return {
      reviews: ideas.map(() => null),
      usage: err instanceof SkillError ? err.usage : EMPTY_USAGE
    }
  }
}
