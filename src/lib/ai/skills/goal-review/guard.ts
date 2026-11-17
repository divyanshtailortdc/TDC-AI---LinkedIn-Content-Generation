import {
  JUDGED_DIMENSIONS,
  type ScoreWithReason
} from '@/lib/idea-scorecard'
import type { GeneratedIdeaItem } from '../ideation/schema'
import type { GoalReview } from './schema'

/**
 * Below this an idea does not achieve its goal: by the rubric, at most the
 * right reader and topic with the message only partly landed.
 */
export const MIN_GOAL_FIT = 50

/** A score written for an idea aimed at the wrong reader never passes. */
const WRONG_READER_CAP = 40

/**
 * The model's reviews by idea, in the ideas' order: null for an idea it did
 * not review (unknown or repeated labels are ignored).
 */
/**
 * A judged score as the model gave it, clamped; null when it gave none. A
 * score with no reason is none: the model sometimes fills a dimension with 0
 * and an empty reason, which is a blank, not a verdict.
 */
function readJudged(value: unknown): ScoreWithReason | null {
  const v = value as { score?: unknown; reason?: unknown } | null | undefined
  if (!v || typeof v.score !== 'number' || !Number.isFinite(v.score)) return null
  const reason = typeof v.reason === 'string' ? v.reason.trim().slice(0, 300) : ''
  if (!reason) return null
  return { score: Math.max(0, Math.min(100, Math.round(v.score))), reason }
}

/** The judged dimensions a review left without a score. */
export function missingDimensions(review: GoalReview) {
  return JUDGED_DIMENSIONS.filter(d => !review.scorecard?.[d])
}

/** Indexes of the ideas a review skipped or left without a judged score. */
export function incompleteReviews(reviews: Array<GoalReview | null>): number[] {
  return reviews
    .map((r, i) => (!r || missingDimensions(r).length > 0 ? i : -1))
    .filter(i => i >= 0)
}

/**
 * Folds a second review of the incomplete ideas (`again`, in the order of
 * `incomplete`) into the first: a skipped idea takes its whole second
 * review; one already reviewed keeps everything it had and takes only the
 * scores it was missing.
 */
export function mergeSecondReview(
  reviews: Array<GoalReview | null>,
  incomplete: number[],
  again: Array<GoalReview | null>
): Array<GoalReview | null> {
  const merged = [...reviews]
  incomplete.forEach((ideaIndex, k) => {
    const was = merged[ideaIndex]
    const redo = again[k]
    if (!redo) return
    merged[ideaIndex] = was
      ? { ...was, scorecard: { ...redo.scorecard, ...was.scorecard } }
      : redo
  })
  return merged
}

export function readGoalReviews(
  output: {
    reviews: Array<{
      idea: string
      readerFit: boolean
      score: number
      reason: string
      originality?: unknown
      trendRelevance?: unknown
      brandFit?: unknown
      engagement?: unknown
    }>
  },
  ideaCount: number
): Array<GoalReview | null> {
  const reviews: Array<GoalReview | null> = Array.from(
    { length: ideaCount },
    () => null
  )
  for (const review of output.reviews) {
    const match = /^\s*\[?I?\s*(\d+)\]?\s*$/i.exec(review.idea)
    const index = match ? Number(match[1]) - 1 : -1
    if (index < 0 || index >= ideaCount || reviews[index]) continue
    const score = Math.max(0, Math.min(100, Math.round(review.score)))
    const scorecard: NonNullable<GoalReview['scorecard']> = {}
    for (const dimension of JUDGED_DIMENSIONS) {
      const judged = readJudged(review[dimension])
      if (judged) scorecard[dimension] = judged
    }
    reviews[index] = {
      score: review.readerFit ? score : Math.min(score, WRONG_READER_CAP),
      readerFit: review.readerFit,
      reason: review.reason.trim().slice(0, 300),
      ...(Object.keys(scorecard).length > 0 ? { scorecard } : {})
    }
  }
  return reviews
}

export function missesGoal(review: GoalReview) {
  return !review.readerFit || review.score < MIN_GOAL_FIT
}

/**
 * Applies the reviews: each reviewed idea keeps its score and reason, and an
 * idea that misses its goal is discarded with why. An idea the review did
 * not cover (the call failed, or it skipped one) is kept as it was: the
 * review never costs a run its ideas.
 */
export function applyGoalReviews(
  ideas: GeneratedIdeaItem[],
  reviews: Array<GoalReview | null>
): {
  kept: GeneratedIdeaItem[]
  missed: Array<{ title: string; reason: string; goalId?: string }>
} {
  const kept: GeneratedIdeaItem[] = []
  const missed: Array<{ title: string; reason: string; goalId?: string }> = []
  ideas.forEach((idea, i) => {
    const review = reviews[i]
    if (!review) {
      kept.push(idea)
      return
    }
    if (missesGoal(review)) {
      missed.push({
        title: idea.title,
        goalId: idea.goalId,
        reason: `It misses its goal: ${review.reason}`
      })
      return
    }
    // The judged scores join the source score the validator gave; the
    // review's originality replaces the validator's rough guess.
    kept.push({
      ...idea,
      goalFitScore: review.score,
      goalFitNote: review.reason,
      ...(review.scorecard
        ? {
            scorecard: { ...idea.scorecard, ...review.scorecard },
            ...(review.scorecard.originality
              ? { originalityScore: review.scorecard.originality.score }
              : {})
          }
        : {})
    })
  })
  return { kept, missed }
}
