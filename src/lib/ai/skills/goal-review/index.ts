import 'server-only'

import { PLATFORMS, type PlatformId, type StyleMix } from '@/lib/formats'

import {
  goalLabel,
  renderGuardrailsBlock,
  type GenerationContext
} from '../../context-blocks'
import { runSkill, SkillError } from '../../run-skill'
import { addUsage, EMPTY_USAGE, type CallUsage } from '../../usage'
import type { GeneratedIdeaItem } from '../ideation/schema'
import {
  incompleteReviews,
  mergeSecondReview,
  readGoalReviews
} from './guard'
import { buildPrompt, instructionsFor } from './prompt'
import { GoalReviewSchema, type GoalReview } from './schema'

export { applyGoalReviews, missingDimensions, MIN_GOAL_FIT } from './guard'
export type { GoalReview } from './schema'

// Five scores and reasons per idea, up to 16 ideas.
const REVIEW_TIMEOUT_MS = 150_000

/**
 * What the reviewer knows of the account beyond its name, for brand fit: its
 * field and bio, its voice, its guardrails, and what it already posts on the
 * run's platforms when its profiles were analyzed.
 */
export function brandBrief(ctx: GenerationContext, platforms: PlatformId[]): string {
  const a = ctx.account
  const v = ctx.voice
  const lines = [
    a.industry && `Field: ${a.industry}`,
    a.bio && `Bio: ${a.bio.slice(0, 400)}`,
    v &&
      `Voice: ${v.tone}; formality ${v.formality}/5, directness ${v.directness}/5`,
    renderGuardrailsBlock(ctx).replace(/\n/g, ' ')
  ]
  for (const p of platforms) {
    const i = ctx.platformInsights?.[p]
    if (!i) continue
    const formats = i.formats.map(f => f.format).slice(0, 5).join(', ')
    lines.push(
      `What it already posts on ${PLATFORMS[p].label}: ${i.summary}${formats ? ` Formats: ${formats}.` : ''}${i.tone ? ` Tone: ${i.tone}.` : ''}`
    )
  }
  return lines.filter(Boolean).join('\n')
}

/**
 * Skill: a run's grounded ideas in; for each, whether it achieves the goal it
 * was written for (its reader, its message, its action), as a score and a
 * reason the approver can read, and how it scores on originality, trend
 * relevance, brand fit and engagement potential, each with its reason. Null
 * for an idea it could not review: the call failed, or no model is
 * configured. A failure never fails the run.
 */
export async function reviewGoalFit(
  ctx: GenerationContext,
  ideas: GeneratedIdeaItem[],
  abortSignal?: AbortSignal,
  /** The platform a run's ideas are for, when it planned for one other than LinkedIn. */
  platform?: string | null,
  /** The run's style mix (ideationStyle); professional when not given. */
  style: StyleMix = 'professional',
  /** What the judged scores are judged against. */
  context: {
    /** The platforms the ideas are for, for what the account already posts there. */
    platforms?: PlatformId[]
    /** This week's news, trends and conversations, as one line each. */
    now?: string[]
    /** Titles of the account's earlier ideas and posts. */
    earlier?: string[]
  } = {}
): Promise<{ reviews: Array<GoalReview | null>; usage: CallUsage }> {
  if (ideas.length === 0) return { reviews: [], usage: EMPTY_USAGE }
  const goalIds = ctx.selectedGoals.map(goal => goal.id)
  const review = (subset: GeneratedIdeaItem[]) =>
    runSkill({
      stage: 'goal_review',
      instructions: instructionsFor(platform, style),
      prompt: buildPrompt({
        account: [ctx.account.name, ctx.account.headline]
          .filter(Boolean)
          .join(', '),
        brand: brandBrief(ctx, context.platforms ?? []),
        platform:
          (context.platforms ?? []).map(p => PLATFORMS[p].label).join(', ') ||
          platform ||
          undefined,
        now: context.now,
        earlier: context.earlier,
        goals: ctx.selectedGoals.map((goal, i) => ({
          label: goalLabel(i),
          title: goal.title,
          objective: goal.objective,
          keyMessage: goal.keyMessage,
          desiredAction: goal.desiredAction
        })),
        ideas: subset.map((idea, i) => ({
          label: `I${i + 1}`,
          goalLabel: goalLabel(Math.max(0, goalIds.indexOf(idea.goalId ?? ''))),
          readers: idea.targetAudience ?? null,
          title: idea.title,
          thesis: idea.thesis,
          hookConcept: idea.hookConcept,
          coreArgument: idea.coreArgument,
          audienceTakeaway: idea.audienceTakeaway,
          angle: idea.angle,
          whyNow: idea.whyNow,
          noveltyNote: idea.noveltyNote,
          formats: idea.formatFit,
          cites: Array.from(
            new Set(
              idea.supportingEvidence
                .map(ev => ev.publisher || ev.sourceTitle)
                .filter((t): t is string => !!t)
            )
          )
        }))
      }),
      schema: GoalReviewSchema,
      timeoutMs: REVIEW_TIMEOUT_MS,
      maxRetries: 1,
      abortSignal
    })

  let reviews: Array<GoalReview | null>
  let usage: CallUsage
  try {
    const first = await review(ideas)
    reviews = readGoalReviews(first.output, ideas.length)
    usage = first.usage
  } catch (err) {
    console.warn('Goal review failed; keeping the ideas unreviewed:', err)
    return {
      reviews: ideas.map(() => null),
      usage: err instanceof SkillError ? err.usage : EMPTY_USAGE
    }
  }

  // Now and then the model skips ideas, or fills a score with nothing (0 and
  // no reason) for every idea after the first few. Both seen live, while a
  // second try of the same prompt came back whole. The ideas it skipped or
  // left without a judged score are reviewed once more, on their own: a
  // skipped idea takes that whole review, the rest only their missing scores.
  const incomplete = incompleteReviews(reviews)
  if (incomplete.length === 0) return { reviews, usage }
  try {
    const second = await review(incomplete.map(i => ideas[i]!))
    usage = addUsage(usage, second.usage)
    reviews = mergeSecondReview(
      reviews,
      incomplete,
      readGoalReviews(second.output, incomplete.length)
    )
  } catch (err) {
    if (abortSignal?.aborted) throw err
    if (err instanceof SkillError) usage = addUsage(usage, err.usage)
    console.warn('Second review for missing scores failed; keeping what the first gave:', err)
  }
  return { reviews, usage }
}
