import { NEWSLETTER_CATEGORIES } from '@/lib/newsletters/status'
import { z } from 'zod'

/** Searches one discovery runs; each costs a Serper credit. */
export const MAX_QUERIES = 8

/** Below this the newsletter is not shown: a loose fit is noise in the list. */
export const MIN_RELEVANCE = 45

/** No optional properties: native structured output handles this shape. */
export const SearchQueriesModelSchema = z.object({
  queries: z.array(
    z.object({
      query: z
        .string()
        .describe('A Google search that finds newsletters to subscribe to.'),
      category: z.enum(NEWSLETTER_CATEGORIES)
    })
  )
})

export type SearchQueriesModelOutput = z.infer<typeof SearchQueriesModelSchema>

export const ClassificationModelSchema = z.object({
  newsletters: z.array(
    z.object({
      candidate: z
        .number()
        .describe('The number of the candidate this verdict is about.'),
      isNewsletter: z
        .boolean()
        .describe(
          'True only for a recurring email publication readers subscribe to.'
        ),
      name: z.string().describe("The newsletter's own name."),
      publisher: z.string().describe('Who publishes it.'),
      description: z
        .string()
        .describe('One or two plain sentences on what it covers.'),
      category: z.enum(NEWSLETTER_CATEGORIES),
      topics: z.array(z.string()).describe('Up to five short topic labels.'),
      relevanceScore: z
        .number()
        .describe(
          '0 to 100: how useful it is to this business, per the rubric.'
        ),
      reason: z
        .string()
        .describe('One sentence naming what in the profile it matches.')
    })
  )
})

export type ClassificationModelOutput = z.infer<
  typeof ClassificationModelSchema
>
