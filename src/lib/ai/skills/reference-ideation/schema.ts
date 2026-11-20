import { z } from 'zod'
import { ALL_PERSPECTIVE_ANGLES } from '../ideation/schema'

/**
 * What the model returns for a shared post: an idea for a post like it,
 * made the author's own, and what drafting needs to write it the same way.
 * Lenient on purpose (defaults, no hard limits): the guard trims and checks
 * every field, so a slightly-off answer is cleaned rather than thrown away.
 */
export const ReferenceIdeaSchema = z.object({
  structure: z
    .string()
    .default('')
    .describe(
      'How the shared post is built, in one or two sentences: how it opens, how it moves, roughly how long it is, and devices it uses (a list, a question, a before/after, emoji, line breaks). About its build, not its subject.'
    ),
  title: z.string().describe('Short title for the new post idea'),
  thesis: z.string().default('').describe('The one point the new post makes'),
  angle: z
    .string()
    .default('')
    .describe('How the new post makes that point its author’s own: their field, their reader, their offer'),
  perspectiveAngle: z.enum(ALL_PERSPECTIVE_ANGLES).catch('practitioner_lesson'),
  hookConcept: z
    .string()
    .describe('The kind of opening, in the shared post’s style, for the new post: a direction, not finished copy'),
  coreArgument: z.string().default('').describe('How the new post moves from its opening to its point'),
  audienceTakeaway: z.string().default('').describe('What the reader takes away'),
  whyNow: z
    .string()
    .default('')
    .describe('Why it is worth posting now, only from what the shared post or the profile says; empty when nothing does'),
  goal: z
    .string()
    .default('none')
    .describe('The label of the goal the new post serves best (G1, G2…), or "none" when no goal fits'),
  postType: z
    .enum(['single', 'carousel'])
    .catch('single')
    .describe('carousel when the shared post is a carousel, or walks through several steps or points that read best one per slide; otherwise single'),
  visualIdea: z
    .string()
    .default('')
    .describe('For the new post’s picture (or its slides): what it shows, in the author’s own look, like the shared post’s in kind but not a copy. Empty for a text-only post.'),
  facts: z
    .array(
      z.object({
        claim: z.string().describe('A fact the shared post states that the new post would use, in your words'),
        quote: z.string().describe('The exact words in the shared post that state it, copied character for character')
      })
    )
    .catch([])
    .default([])
    .describe('Only facts the new post needs (figures, names, dates, news), each quoted exactly; empty when it needs none')
})

export type ReferenceIdeaOutput = z.infer<typeof ReferenceIdeaSchema>
