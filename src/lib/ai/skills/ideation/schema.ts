import { z } from 'zod'

/**
 * Analytical lenses, deliberately domain-neutral.
 *
 * These were previously B2B-distribution specific ("pricing_commercial_rules",
 * "data_ownership"), which pushed every account's ideas toward that domain no
 * matter what the account actually did.
 */
export const PERSPECTIVE_ANGLES = [
  'contrarian_take',
  'common_misconception',
  'practitioner_lesson',
  'decision_framework',
  'tradeoff_analysis',
  'trend_interpretation',
  'failure_postmortem',
  'first_principles',
  'comparison',
  'prediction',
  'process_breakdown',
  'belief_shift'
] as const

export const PERSPECTIVE_ANGLE_GUIDE: Record<
  (typeof PERSPECTIVE_ANGLES)[number],
  string
> = {
  contrarian_take:
    'Challenge something the audience currently accepts, with evidence.',
  common_misconception:
    'Name a belief that is widespread in this field and wrong.',
  practitioner_lesson:
    'A lesson only someone who has actually done the work would know.',
  decision_framework:
    'How to decide between options the reader is weighing right now.',
  tradeoff_analysis:
    'Make an unavoidable tradeoff explicit instead of pretending it away.',
  trend_interpretation:
    'What a current, evidenced development actually means for the reader.',
  failure_postmortem:
    'Why a common approach breaks down, and the mechanism behind it.',
  first_principles:
    'Rebuild the reasoning from the ground up and land somewhere non-obvious.',
  comparison:
    'Compare two approaches on criteria the reader has not considered.',
  prediction:
    'A specific, falsifiable claim about where this is heading, and why.',
  process_breakdown:
    'The concrete steps behind a result people usually describe vaguely.',
  belief_shift: "Aim directly at the audience's stated belief and move it."
}

export type PerspectiveAngle = (typeof PERSPECTIVE_ANGLES)[number]

export const IdeaItemSchema = z.object({
  title: z.string().describe('Short punchy title for this idea'),
  thesis: z
    .string()
    .describe('The underlying root proposition or defensible claim'),
  perspectiveAngle: z.enum(PERSPECTIVE_ANGLES).default('practitioner_lesson'),
  angle: z.string().describe('The distinctive POV or contrarian thesis lens'),
  goalId: z
    .string()
    .optional()
    .describe('The id of the one goal picked for the run that this idea serves'),
  targetAudience: z
    .string()
    .optional()
    .describe('The one reader group from the profile this idea is written for'),
  format: z.string().default('thought_leadership'),
  whyNow: z
    .string()
    .describe(
      'Why this earns feed space today — only use current/trend language if backed by fresh evidence. Do NOT invent urgency.'
    ),
  whyNowSourceId: z
    .string()
    .optional()
    .describe('Source ID backing the Why Now assertion if applicable'),
  hookConcept: z
    .string()
    .describe('The fold-line idea concept (first 200 chars), not final copy'),
  coreArgument: z
    .string()
    .describe('The "so what" — core logic and thesis of the post'),
  audienceTakeaway: z
    .string()
    .describe('What the reader does or thinks differently after reading'),
  supportingEvidence: z
    .array(
      z.object({
        claim: z.string().describe('Specific factual claim or statistic'),
        factType: z
          .enum(['verified', 'sourced', 'inferred', 'unsupported'])
          .default('verified'),
        sourceId: z.string().optional(),
        sourceUrl: z
          .string()
          .optional()
          .describe('URL where this evidence comes from'),
        sourceTitle: z
          .string()
          .optional()
          .describe('Title of source document or website'),
        quote: z
          .string()
          .optional()
          .describe('Verbatim quote supporting the claim'),
        publishedAt: z
          .string()
          .optional()
          .describe('When the source was published, YYYY-MM-DD'),
        confidence: z.number().min(0).max(1).default(0.9)
      })
    )
    .default([]),
  suggestedMedia: z
    .object({
      mode: z.enum(['ai_generated', 'stock', 'none']).default('none'),
      brief: z
        .string()
        .optional()
        .describe('Visual direction or search query for the image')
    })
    .default({ mode: 'none' }),
  noveltyNote: z
    .string()
    .describe('What makes this angle fresh compared to common LinkedIn takes'),
  estimatedStrength: z.number().int().min(1).max(100).default(85),
  groundingScore: z.number().int().min(0).max(100).default(85),
  originalityScore: z.number().int().min(0).max(100).default(85),
  unsupportedClaims: z.array(z.string()).default([]),
  sourceIds: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([])
})

export type GeneratedIdeaItem = z.infer<typeof IdeaItemSchema>

/**
 * What the model is actually asked to write during ideation.
 *
 * Narrower than IdeaItemSchema on purpose. Output tokens are most of the cost
 * of a run, and the full schema had the model write fields the pipeline then
 * threw away: grounding and originality scores, unsupported claims and source
 * IDs are all recomputed by the validator, and the media mode is replaced by
 * the account's policy. Evidence is cited by its [E#] label instead of the
 * model retyping each URL, title and quote — cheaper, and it removes the chance
 * of a mistyped link. `resolveGeneratedIdea` maps this back onto the full type.
 */
export const IdeaGenerationItemSchema = z.object({
  title: IdeaItemSchema.shape.title,
  thesis: IdeaItemSchema.shape.thesis,
  perspectiveAngle: IdeaItemSchema.shape.perspectiveAngle,
  angle: IdeaItemSchema.shape.angle,
  goalRef: z
    .string()
    .describe('The label of the one goal this idea serves, e.g. "G1".'),
  audienceRef: z
    .string()
    .describe(
      'The label of the one reader group this idea is written for, e.g. "A2".'
    ),
  format: IdeaItemSchema.shape.format,
  whyNow: IdeaItemSchema.shape.whyNow,
  hookConcept: IdeaItemSchema.shape.hookConcept,
  coreArgument: IdeaItemSchema.shape.coreArgument,
  audienceTakeaway: IdeaItemSchema.shape.audienceTakeaway,
  supportingEvidence: z
    .array(
      z.object({
        evidenceRef: z
          .string()
          .describe(
            'The label of the evidence item this claim comes from, e.g. "E3".'
          ),
        claim: z
          .string()
          .describe(
            'The specific claim this idea relies on, as it applies here.'
          )
      })
    )
    .default([])
    .describe(
      'Claims cited by evidence label. Leave empty rather than inventing.'
    ),
  mediaBrief: z
    .string()
    .optional()
    .describe('One sentence of visual direction for the accompanying image.'),
  noveltyNote: IdeaItemSchema.shape.noveltyNote,
  estimatedStrength: IdeaItemSchema.shape.estimatedStrength,
  risks: IdeaItemSchema.shape.risks
})

export type IdeaGenerationItem = z.infer<typeof IdeaGenerationItemSchema>

export const IdeaGenerationBatchSchema = z.object({
  ideas: z
    .array(IdeaGenerationItemSchema)
    .min(1)
    .describe('List of generated post ideas')
})

/** Evidence as the validator expects it, resolved from the run's corpus. */
export interface CorpusEvidenceSource {
  claim: string
  quote?: string
  sourceUrl?: string
  sourceTitle?: string
  sourceId?: string
  publishedAt?: string
  origin?: 'own' | 'knowledge' | 'web'
}
