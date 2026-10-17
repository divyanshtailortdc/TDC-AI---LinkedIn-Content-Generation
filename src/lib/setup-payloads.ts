import { z } from 'zod'
import { idSchema } from './ids'
import { optionalUrlError } from './identity-profile'

/**
 * What the setup server actions accept. A server action is a public endpoint:
 * its arguments come from the browser and are checked here, not trusted from
 * the TypeScript types. Limits are generous; they exist to stop malformed or
 * oversized input, not to second-guess what a person typed.
 */

const URL_MESSAGE = 'URLs must start with http:// or https://'
/** A string capped at `max`, with the field named in the message people see. */
const text = (max: number, label: string) =>
  z.string().max(max, `${label} must be ${max.toLocaleString('en-US')} characters or fewer`)

/** An empty string is allowed: the forms send "" for no link. */
const optionalUrl = z
  .string()
  .max(2000)
  .optional()
  .refine(value => !optionalUrlError(value ?? ''), URL_MESSAGE)

export const AccountIdSchema = idSchema('Invalid account identifier')

export const GoalPayloadSchema = z.object({
  title: text(200, 'Goal title'),
  objectiveType: z.enum([
    'awareness',
    'engagement',
    'authority',
    'lead_gen',
    'recruiting',
    'community'
  ]),
  keyMessage: text(2000, 'Key message'),
  desiredAction: text(500, 'Desired action').optional(),
  targetUrl: optionalUrl,
  linkStrategy: z.enum(['body', 'first_comment'])
})

export const PreferencesPayloadSchema = z.object({
  pillars: z
    .array(
      z.object({
        name: text(200, 'Pillar name'),
        weight_pct: z
          .number()
          .finite()
          .min(0, 'Pillar weight cannot be negative')
          .max(1000, 'Pillar weight must be 1,000 or less'),
        example_topics: z
          .array(text(300, 'Example topic'))
          .max(30, 'Use at most 30 example topics per pillar.')
          .optional()
      })
    )
    .max(20, 'Use at most 20 content pillars.'),
  ideasPerRun: z.number(),
  post_constraints: z.object({ cta_required: z.boolean() }),
  guardrails: z.object({
    banned_topics: z
      .array(text(300, 'Banned topic'))
      .max(100, 'Use at most 100 banned topics.'),
    compliance_notes: text(5000, 'Compliance notes')
  })
})

export const KnowledgeDocumentSchema = z.object({
  accountId: AccountIdSchema,
  title: text(300, 'Title'),
  sourceType: z.enum(['url', 'artifact']),
  sourceUrl: optionalUrl,
  content: text(200_000, 'Content')
})

/** Returns the parsed value, or throws the first problem in plain words. */
export function parseSetupPayload<S extends z.ZodType>(
  schema: S,
  value: unknown
): z.infer<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || 'Invalid request.')
  }
  return parsed.data
}
