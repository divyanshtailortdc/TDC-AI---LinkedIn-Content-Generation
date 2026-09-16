import { z } from 'zod'

/**
 * Generic grammatical fragments and common filler that should NEVER be treated
 * as distinctive signature phrases.
 */
export const GENERIC_PHRASE_BLACKLIST = new Set([
  'so i',
  'it doesnt',
  "it doesn't",
  'thats why',
  "that's why",
  'in other words',
  'i think',
  'for example',
  'as a result',
  'and then',
  'here are',
  'this is',
  'at the end of the day',
  'to be honest',
  'in my opinion',
  'i believe',
  'first of all',
  'the thing is',
  'if you want',
  'you can also',
  'let me know'
])

export const VoiceAnalysisSchema = z.object({
  derivedStyleRubric: z
    .string()
    .min(30, 'Style rubric must be descriptive and actionable')
    .describe(
      'A comprehensive 3-4 sentence actionable style rubric detailing hook style, body cadence, structural contrast patterns, tone, and ending convention for future post generation.'
    ),
  writingPatterns: z
    .array(z.string())
    .default([])
    .describe(
      '2 to 5 reusable structural/syntactic patterns observed in the author\'s writing (e.g. "X isn\'t the problem. Y is.", "You don\'t need X. You need Y.", "Blame creates fear. Curiosity creates problem solvers.").'
    ),
  tone: z
    .string()
    .default('candid')
    .describe(
      'Core tone descriptor, e.g. candid, analytical, pragmatic, direct, conversational'
    ),
  formality: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1 = very casual/conversational, 5 = strictly formal/academic'),
  warmth: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1 = clinical/detached, 5 = empathetic/vulnerable'),
  directness: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1 = diplomatic/elaborate, 5 = bluntly punchy/straight to point'),
  humor: z.enum(['none', 'dry', 'playful']),
  energy: z.enum(['measured', 'punchy']),
  perspective: z.enum(['I', 'we', 'third person']),
  storyVsData: z
    .number()
    .int()
    .min(1)
    .max(5)
    .describe('1 = purely personal narratives, 5 = data & metric-driven'),
  emojiPolicy: z.enum(['none', 'bullets only', 'liberal']),
  hashtagPolicy: z
    .string()
    .describe('e.g. "0-3, end of post", "none", "3-5 relevant tags"'),
  sentenceLength: z.enum(['short', 'mixed', 'long']),
  paragraphStyle: z.enum(['single-line breaks', 'short paras', 'dense']),
  readingLevelTarget: z.string().describe('e.g. "grade 7-9", "grade 9-10"'),
  bannedWords: z
    .array(z.string())
    .describe(
      "Corporate buzzwords, hollow hyperbole, or cliches that strongly clash with this author's specific voice. Do NOT list words just because they were absent."
    ),
  signaturePhrases: z
    .array(z.string())
    .describe(
      'Distinctive, characteristic phrases, trademark transitions, or memorable conceptual formulations unique to this author. Strictly exclude generic fragments like "So I", "It doesn\'t", "That\'s why".'
    ),
  openingStyles: z
    .array(z.string())
    .describe(
      'Specific opening hook patterns observed in the samples (e.g. "Concrete number + timeline", "Three staccato negations", "Counter-intuitive lesson"), NOT generic textbook labels.'
    ),
  closingStyles: z
    .array(z.string())
    .describe(
      'Specific closing patterns observed in the samples (e.g. "Imperative takeaway without question", "Open philosophical question", "Drop-the-mic contrast"), NOT generic textbook labels.'
    ),
  rules: z
    .string()
    .optional()
    .describe(
      'Specific editorial rules derived from writing patterns and voice habits.'
    )
})

export type VoiceAnalysisResult = z.infer<typeof VoiceAnalysisSchema>

/**
 * Validates and sanitizes Claude's voice analysis result to filter out generic fragments,
 * ensure banned words are legitimate anti-patterns, and incorporate writing patterns into rules.
 */
export function sanitizeVoiceAnalysis(
  raw: VoiceAnalysisResult
): VoiceAnalysisResult {
  // Filter signaturePhrases:
  // Must be >= 6 chars, not in blacklist, and not just 1-2 generic words
  const cleanedSignaturePhrases = (raw.signaturePhrases || [])
    .map(p => p.trim())
    .filter(p => {
      if (p.length < 6) return false
      const normalized = p
        .toLowerCase()
        .replace(/[^\w\s']/g, '')
        .trim()
      if (GENERIC_PHRASE_BLACKLIST.has(normalized)) return false
      // Exclude simple generic starters
      if (
        /^(so\s+i|it\s+doesn't|it\s+doesnt|that's\s+why|thats\s+why|that\s+is\s+why|i\s+think|here\s+is|and\s+so|we\s+also|if\s+you|you\s+can)$/i.test(
          normalized
        )
      ) {
        return false
      }
      return true
    })

  // Deduplicate and clean writing patterns
  const cleanedPatterns = (raw.writingPatterns || [])
    .map(p => p.trim())
    .filter(p => p.length > 5)

  // Ensure writing patterns are explicitly documented in derivedStyleRubric and rules
  let enhancedRubric = raw.derivedStyleRubric.trim()
  if (cleanedPatterns.length > 0) {
    const patternSummary = cleanedPatterns.map(p => `"${p}"`).join('; ')
    if (
      !enhancedRubric.toLowerCase().includes('pattern') &&
      !enhancedRubric.includes(cleanedPatterns[0]!)
    ) {
      enhancedRubric = `${enhancedRubric} Uses distinct contrast patterns such as: ${patternSummary}.`
    }
  }

  // Ensure rules includes patterns
  const rules =
    raw.rules ||
    (cleanedPatterns.length > 0
      ? `Core Writing Patterns:\n${cleanedPatterns.map(p => `- ${p}`).join('\n')}`
      : undefined)

  // Filter banned words: remove duplicates, strip excessive whitespace, drop generic words
  const cleanedBannedWords = Array.from(
    new Set(
      (raw.bannedWords || [])
        .map(w => w.trim().toLowerCase())
        .filter(
          w =>
            w.length > 2 &&
            ![
              'the',
              'and',
              'with',
              'from',
              'this',
              'that',
              'about',
              'some'
            ].includes(w)
        )
    )
  )

  // Clamp numeric scores to 1..5
  const formality = Math.min(5, Math.max(1, Math.round(raw.formality || 3)))
  const warmth = Math.min(5, Math.max(1, Math.round(raw.warmth || 3)))
  const directness = Math.min(5, Math.max(1, Math.round(raw.directness || 4)))
  const storyVsData = Math.min(5, Math.max(1, Math.round(raw.storyVsData || 3)))

  return {
    ...raw,
    derivedStyleRubric: enhancedRubric,
    writingPatterns: cleanedPatterns,
    signaturePhrases: cleanedSignaturePhrases,
    bannedWords: cleanedBannedWords,
    rules,
    formality,
    warmth,
    directness,
    storyVsData
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
    .describe('0-4 clean hashtags without the # symbol or formatted like #Topic'),
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
