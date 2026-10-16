import { z } from 'zod'
import { optionalUrlError } from './identity-profile'

/**
 * What the setup server actions accept. A server action is a public endpoint:
 * its arguments come from the browser and are checked here, not trusted from
 * the TypeScript types. Limits are generous; they exist to stop malformed or
 * oversized input, not to second-guess what a person typed.
 */

const URL_MESSAGE = 'URLs must start with http:// or https://'
const text = (max: number) => z.string().max(max)

/** An empty string is allowed: the forms send "" for no link. */
const optionalUrl = z
  .string()
  .max(2000)
  .optional()
  .refine(value => !optionalUrlError(value ?? ''), URL_MESSAGE)

export const AccountIdSchema = z.string().uuid('Invalid account identifier')

export const GoalPayloadSchema = z.object({
  title: text(200),
  objectiveType: z.enum([
    'awareness',
    'engagement',
    'authority',
    'lead_gen',
    'recruiting',
    'community'
  ]),
  keyMessage: text(2000),
  desiredAction: text(500).optional(),
  targetUrl: optionalUrl,
  linkStrategy: z.enum(['body', 'first_comment'])
})

export const PreferencesPayloadSchema = z.object({
  pillars: z
    .array(
      z.object({
        name: text(200),
        weight_pct: z.number().finite().min(0).max(1000),
        example_topics: z.array(text(300)).max(30).optional()
      })
    )
    .max(20, 'Use at most 20 content pillars.'),
  ideasPerRun: z.number(),
  post_constraints: z.object({ cta_required: z.boolean() }),
  guardrails: z.object({
    banned_topics: z.array(text(300)).max(100),
    compliance_notes: text(5000)
  })
})

export const KnowledgeDocumentSchema = z.object({
  accountId: AccountIdSchema,
  title: text(300),
  sourceType: z.enum(['url', 'artifact']),
  sourceUrl: optionalUrl,
  content: text(200_000)
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
