import { z } from 'zod'
import type { IdeaScorecard } from '@/lib/idea-scorecard'

const Judged = (what: string) =>
  z
    .object({
      score: z.number().int().min(0).max(100).describe(`${what}, by the rubric.`),
      reason: z
        .string()
        .describe('One plain sentence for the approver: why this score. Do not repeat the number.')
    })
    .describe(what)

export const GoalReviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        idea: z.string().describe('The idea’s label, e.g. "I3".'),
        readerFit: z
          .boolean()
          .describe(
            'True when the idea is written for the people its goal is meant to reach.'
          ),
        score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe('Goal fit: how well the idea achieves its goal, by the rubric.'),
        reason: z
          .string()
          .describe(
            'One plain sentence for the person approving ideas: what the idea does for its goal, or what it misses.'
          ),
        originality: Judged('Originality'),
        trendRelevance: Judged('Trend relevance'),
        brandFit: Judged('Brand fit'),
        engagement: Judged('Engagement potential')
      })
    )
    .describe('One review per idea, in order.')
})

/** One idea's review, as the pipeline keeps it. */
export type GoalReview = {
  /** 0–100: how well the idea achieves its goal. */
  score: number
  readerFit: boolean
  reason: string
  /** The other judged scores, each with its reason; absent from a review that gave none. */
  scorecard?: Pick<IdeaScorecard, 'originality' | 'trendRelevance' | 'brandFit' | 'engagement'>
}
