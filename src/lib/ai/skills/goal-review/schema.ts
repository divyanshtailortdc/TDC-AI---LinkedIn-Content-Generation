import { z } from 'zod'

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
          .describe('How well the idea achieves its goal, by the rubric.'),
        reason: z
          .string()
          .describe(
            'One plain sentence for the person approving ideas: what the idea does for its goal, or what it misses.'
          )
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
}
