import { z } from 'zod'
import { DIGEST_KINDS, type DigestKind } from '../../../intel/status'

export const MAX_DIGEST_ITEMS = 25

export type DigestItem = {
  headline: string
  /** The email's own words about the story, or null when it has none. */
  blurb: string | null
  /** The `[n]` of the link to the story, or null. */
  link: number | null
  sponsored: boolean
}

export type NewsletterDigest = {
  kind: DigestKind
  summary: string
  topics: string[]
  items: DigestItem[]
}

export const DigestSchema = z.object({
  kind: z
    .enum(DIGEST_KINDS)
    .describe(
      'newsletter: an issue with stories, analysis or links to read. promotion: marketing for the sender’s own products. transactional: confirmation, welcome, receipt or account email. other: anything else.'
    ),
  summary: z
    .string()
    .describe('One or two plain sentences on what the email covers.'),
  topics: z
    .array(z.string())
    .max(6)
    .default([])
    .describe('2 to 6 short topic tags.'),
  items: z
    .array(
      z.object({
        headline: z
          .string()
          .describe(
            'The story’s headline as the email gives it, or a short factual one.'
          ),
        blurb: z
          .string()
          .describe(
            'What the email says about the story, copied word for word: one to three sentences, without the [n] markers. Never paraphrase.'
          ),
        link: z
          .number()
          .int()
          .nullable()
          .describe(
            'The n of the [n] marker on the link to the story itself, or null.'
          ),
        sponsored: z
          .boolean()
          .default(false)
          .describe('True for an ad or a sponsored placement.')
      })
    )
    .max(MAX_DIGEST_ITEMS)
    .default([])
    .describe('Only for a newsletter: one per story, in the order they appear.')
})
