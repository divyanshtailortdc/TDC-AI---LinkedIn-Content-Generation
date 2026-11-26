import { z } from 'zod'

/** Two or three phrases a reader would type to find a piece on the topic. */
export const SearchPhrasesSchema = z.object({
  phrases: z
    .array(z.string())
    .describe('2-3 search phrases of 2-5 words each, most searched first')
})

export type SearchPhrasesDraft = z.infer<typeof SearchPhrasesSchema>
