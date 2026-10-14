import { z } from 'zod'

/**
 * Writing styles offered on the Voice page. Stored in voice_configs.tone and
 * picked automatically by the voice analyzer, so the two always agree. They
 * describe how a post is built; formality and directness are separate scales.
 */
export const WRITING_STYLES = [
  {
    value: 'candid',
    label: 'Candid',
    description: 'Honest opinions and hard-won lessons, said plainly.'
  },
  {
    value: 'storytelling',
    label: 'Storytelling',
    description: 'Real moments and experiences that lead to a lesson.'
  },
  {
    value: 'analytical',
    label: 'Analytical',
    description: 'Numbers, evidence and clear reasoning.'
  },
  {
    value: 'educational',
    label: 'Educational',
    description: 'Practical tips and step-by-step advice.'
  },
  {
    value: 'inspiring',
    label: 'Inspiring',
    description: 'Big-picture ideas that motivate the reader.'
  }
] as const

export type WritingStyle = (typeof WRITING_STYLES)[number]['value']

const WRITING_STYLE_VALUES = WRITING_STYLES.map(s => s.value) as [
  WritingStyle,
  ...WritingStyle[]
]

export const VoiceAnalysisSchema = z.object({
  derivedStyleRubric: z
    .string()
    .min(30, 'Style rubric must be descriptive and actionable')
    .describe(
      'A 4-6 sentence actionable style rubric another model can follow to write like this author: the hook mechanic, body cadence and white space, 2-3 of their reusable contrast patterns quoted as templates, a few distinctive signature phrases to reuse sparingly, the tone, and how posts close.'
    ),
  // catch, not default: an off-list style must not fail the whole analysis
  // (which would drop to the heuristic analyzer) when the schema isn't enforced.
  tone: z
    .enum(WRITING_STYLE_VALUES)
    .catch('candid')
    .describe(
      `The overall writing style that best fits these posts. One of: ${WRITING_STYLES.map(s => `${s.value} (${s.description})`).join('; ')}`
    ),
  formality: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1 = very casual/conversational, 5 = strictly formal/academic'),
  directness: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1 = diplomatic/elaborate, 5 = bluntly punchy/straight to point'),
  perspective: z
    .enum(['I', 'we', 'third person'])
    .describe(
      'Who is speaking: "I" = the author personally, "we" = on behalf of their team or company, "third person" = the company or brand referred to by name ("Acme helps...")'
    ),
  emojiPolicy: z.enum(['none', 'bullets only', 'liberal']),
  hashtagPolicy: z
    .string()
    .describe('e.g. "0-3, end of post", "none", "3-5 relevant tags"')
})

export type VoiceAnalysisResult = z.infer<typeof VoiceAnalysisSchema>

/** Cleans Claude's voice analysis: trims the rubric and clamps the scales to 1..5. */
export function sanitizeVoiceAnalysis(
  raw: VoiceAnalysisResult
): VoiceAnalysisResult {
  // Clamp numeric scores to 1..5
  const formality = Math.min(5, Math.max(1, Math.round(raw.formality || 3)))
  const directness = Math.min(5, Math.max(1, Math.round(raw.directness || 4)))

  return {
    ...raw,
    derivedStyleRubric: raw.derivedStyleRubric.trim(),
    formality,
    directness
  }
}

// ---------------------------------------------------------------------------
// Ideas & Thesis Generation Schemas (W7 / Stage 1)
// ---------------------------------------------------------------------------

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
  contrarian_take: 'Challenge something the audience currently accepts, with evidence.',
  common_misconception: 'Name a belief that is widespread in this field and wrong.',
  practitioner_lesson: 'A lesson only someone who has actually done the work would know.',
  decision_framework: 'How to decide between options the reader is weighing right now.',
  tradeoff_analysis: 'Make an unavoidable tradeoff explicit instead of pretending it away.',
  trend_interpretation: 'What a current, evidenced development actually means for the reader.',
  failure_postmortem: 'Why a common approach breaks down, and the mechanism behind it.',
  first_principles: 'Rebuild the reasoning from the ground up and land somewhere non-obvious.',
  comparison: 'Compare two approaches on criteria the reader has not considered.',
  prediction: 'A specific, falsifiable claim about where this is heading, and why.',
  process_breakdown: 'The concrete steps behind a result people usually describe vaguely.',
  belief_shift: "Aim directly at the audience's stated belief and move it."
}

export type PerspectiveAngle = (typeof PERSPECTIVE_ANGLES)[number]

export const CandidateThesisSchema = z.object({
  id: z.string().describe('Identifier e.g. thesis-1'),
  perspectiveAngle: z.enum(PERSPECTIVE_ANGLES).describe('The distinct perspective angle'),
  thesis: z.string().describe('The underlying root proposition or belief shift (1-2 clear, bold sentences)'),
  whyItMatters: z.string().describe('Why this shifts the conversation for practitioners'),
  relevantProofOrClaim: z.string().describe('Key factual evidence or claim from knowledge base that grounds this thesis'),
  sourceUrl: z.string().optional(),
  sourceTitle: z.string().optional()
})

export type CandidateThesis = z.infer<typeof CandidateThesisSchema>

export const ThesesGenerationSchema = z.object({
  theses: z.array(CandidateThesisSchema).min(5).describe('Candidate theses spanning distinct perspective angles')
})

export type ThesesGenerationResult = z.infer<typeof ThesesGenerationSchema>

export const IdeaItemSchema = z.object({
  title: z.string().describe('Short punchy title for this idea'),
  thesis: z.string().describe('The underlying root proposition or defensible claim'),
  perspectiveAngle: z.enum(PERSPECTIVE_ANGLES).default('practitioner_lesson'),
  angle: z.string().describe('The distinctive POV or contrarian thesis lens'),
  pillar: z.string().describe('Which content pillar this belongs to'),
  format: z.string().default('thought_leadership'),
  whyNow: z
    .string()
    .describe(
      'Why this earns feed space today — only use current/trend language if backed by fresh evidence. Do NOT invent urgency.'
    ),
  whyNowSourceId: z.string().optional().describe('Source ID backing the Why Now assertion if applicable'),
  hookConcept: z
    .string()
    .describe('The fold-line idea concept (first 200 chars), not final copy'),
  coreArgument: z.string().describe('The "so what" — core logic and thesis of the post'),
  audienceTakeaway: z
    .string()
    .describe('What the reader does or thinks differently after reading'),
  supportingEvidence: z
    .array(
      z.object({
        claim: z.string().describe('Specific factual claim or statistic'),
        factType: z.enum(['verified', 'inferred', 'unsupported']).default('verified'),
        sourceId: z.string().optional(),
        sourceUrl: z.string().optional().describe('URL where this evidence comes from'),
        sourceTitle: z.string().optional().describe('Title of source document or website'),
        quote: z.string().optional().describe('Verbatim quote supporting the claim'),
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

export const IdeasGenerationSchema = z.object({
  ideas: z.array(IdeaItemSchema).min(1).describe('List of generated post ideas')
})

export type IdeasGenerationResult = z.infer<typeof IdeasGenerationSchema>

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
  pillar: IdeaItemSchema.shape.pillar,
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
          .describe('The label of the evidence item this claim comes from, e.g. "E3".'),
        claim: z
          .string()
          .describe('The specific claim this idea relies on, as it applies here.')
      })
    )
    .default([])
    .describe('Claims cited by evidence label. Leave empty rather than inventing.'),
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
}

/** Parses "E3", "e3" or "[E3]" into a zero-based corpus index. */
export function parseEvidenceRef(ref: string | undefined): number | null {
  const match = /E\s*(\d+)/i.exec(ref || '')
  if (!match) return null
  const index = Number(match[1]) - 1
  return index >= 0 ? index : null
}

/**
 * Expands a generated idea into the full item. Source details come from the
 * corpus entry the model cited, never from the model's own typing. A citation
 * that points outside the corpus keeps its claim but gets no source, so the
 * validator judges it on the text alone.
 */
export function resolveGeneratedIdea(
  generated: IdeaGenerationItem,
  corpus: CorpusEvidenceSource[]
): GeneratedIdeaItem {
  return {
    title: generated.title,
    thesis: generated.thesis,
    perspectiveAngle: generated.perspectiveAngle,
    angle: generated.angle,
    pillar: generated.pillar,
    format: generated.format,
    whyNow: generated.whyNow,
    hookConcept: generated.hookConcept,
    coreArgument: generated.coreArgument,
    audienceTakeaway: generated.audienceTakeaway,
    supportingEvidence: (generated.supportingEvidence || []).map(ev => {
      const index = parseEvidenceRef(ev.evidenceRef)
      const source = index === null ? undefined : corpus[index]
      return {
        claim: ev.claim,
        factType: 'verified' as const,
        sourceId: source?.sourceId,
        sourceUrl: source?.sourceUrl,
        sourceTitle: source?.sourceTitle,
        quote: source?.quote,
        // Confidence is decided by the validator's grounding check.
        confidence: 0.9
      }
    }),
    suggestedMedia: { mode: 'none', brief: generated.mediaBrief },
    noveltyNote: generated.noveltyNote,
    estimatedStrength: generated.estimatedStrength,
    // Recomputed by validateIdea; placeholders until then.
    groundingScore: 0,
    originalityScore: 0,
    unsupportedClaims: [],
    sourceIds: [],
    risks: generated.risks || []
  }
}

// ---------------------------------------------------------------------------
// Post Drafting Schema (W9 / Stage 3)
// ---------------------------------------------------------------------------

export const DraftGenerationSchema = z.object({
  hook: z
    .string()
    .describe(
      'The opening hook that appears before the "...see more" fold (aim strictly for <= 200 characters without mid-word break)'
    ),
  body: z
    .string()
    .describe(
      'The full body of the post formatted with clean plain-text line breaks (\\n\\n). Strictly NO markdown syntax (no **, no ##, no raw [text](url)).'
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
    .describe('Clean hashtags without the # symbol, as many as the constraints specify'),
  alternateHooks: z
    .array(z.string())
    .min(2)
    .max(3)
    .describe('2 to 3 alternate hook variations for testing before publication'),
  selfScores: z.object({
    hookStrength: z.number().int().min(1).max(10).describe('Hook curiosity and punchiness (1-10)'),
    onBrand: z.number().int().min(1).max(10).describe('Voice rubric fidelity (1-10)'),
    clarity: z.number().int().min(1).max(10).describe('Argument structure and legibility (1-10)'),
    evidenceGrounding: z.number().int().min(1).max(10).describe('Truthfulness and factual grounding (1-10)'),
    originality: z.number().int().min(1).max(10).describe('Uniqueness and freshness of angle (1-10)')
  }),
  selfFlags: z
    .array(z.string())
    .default([])
    .describe('Any detected weakness or caveat')
})

export type DraftGenerationResult = z.infer<typeof DraftGenerationSchema>
