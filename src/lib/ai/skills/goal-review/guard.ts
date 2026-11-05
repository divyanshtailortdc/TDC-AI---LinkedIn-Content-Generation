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
export function readGoalReviews(
  output: {
    reviews: Array<{
      idea: string
      readerFit: boolean
      score: number
      reason: string
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
    reviews[index] = {
      score: review.readerFit ? score : Math.min(score, WRONG_READER_CAP),
      readerFit: review.readerFit,
      reason: review.reason.trim().slice(0, 300)
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
    kept.push({
      ...idea,
      goalFitScore: review.score,
      goalFitNote: review.reason
    })
  })
  return { kept, missed }
}
