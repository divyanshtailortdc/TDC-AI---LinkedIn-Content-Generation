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
