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
