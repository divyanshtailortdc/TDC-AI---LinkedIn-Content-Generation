import { z } from 'zod'

export const DraftGenerationSchema = z.object({
  hook: z
    .string()
    .describe(
      'The opening hook that appears before the "...see more" fold (aim strictly for <= 200 characters without mid-word break)'
    ),
  body: z
    .string()
    .describe(
      'The rest of the post after the hook; never repeat the hook here. Clean plain-text line breaks (\\n\\n). Strictly NO markdown syntax (no **, no ##, no raw [text](url)).'
    ),
  cta: z
    .string()
    .describe('Closing call to action (question, reflection, or soft CTA)'),
  firstComment: z
    .string()
    .optional()
    .describe(
      'First comment containing external links or bonus reference materials, protecting post reach'
    ),
  hashtags: z
    .array(z.string())
    .default([])
    .describe(
      'Clean hashtags without the # symbol, as many as the constraints specify'
    ),
  alternateHooks: z
    .array(z.string())
    .min(2)
    .max(3)
    .describe(
      '2 to 3 alternate hook variations for testing before publication'
    ),
  selfScores: z.object({
    hookStrength: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Hook curiosity and punchiness (1-10)'),
    onBrand: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Voice rubric fidelity (1-10)'),
    clarity: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Argument structure and legibility (1-10)'),
    evidenceGrounding: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Truthfulness and factual grounding (1-10)'),
    originality: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Uniqueness and freshness of angle (1-10)')
  }),
  selfFlags: z
    .array(z.string())
    .default([])
    .describe('Any detected weakness or caveat')
})

export type DraftGenerationResult = z.infer<typeof DraftGenerationSchema>
