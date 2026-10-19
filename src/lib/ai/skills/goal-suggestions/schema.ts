import type { GoalPayload } from '@/app/(app)/identity/goals/actions'
import { z } from 'zod'
import { GOAL_OBJECTIVES } from '../profile-setup/schema'

export const MAX_SUGGESTIONS = 3

export type GoalSuggestion = Omit<GoalPayload, 'linkStrategy'> & {
  /** What in the profile the goal is built on, shown so the user can judge it. */
  basedOn: string
}

/** No optional properties: native structured output handles this shape. */
export const GoalSuggestionsModelSchema = z.object({
  goals: z.array(
    z.object({
      title: z.string(),
      objectiveType: z.enum(GOAL_OBJECTIVES),
      keyMessage: z
        .string()
        .describe('One sentence: the belief a reader should hold afterwards.'),
      desiredAction: z
        .string()
        .describe('One short action for readers, or an empty string.'),
      targetUrl: z
        .string()
        .describe('One of the allowed links exactly, or an empty string.'),
      basedOn: z
        .string()
        .describe(
          'The offering, audience or pillar from the profile it builds on.'
        )
    })
  )
})

export type GoalSuggestionsModelOutput = z.infer<
  typeof GoalSuggestionsModelSchema
>
