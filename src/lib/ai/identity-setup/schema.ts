import { z } from 'zod'
import { VoiceAnalysisSchema, WRITING_STYLES } from '../schemas'

/**
 * AI identity setup: one natural-language description in, suggestions for the
 * Profile, Voice, Knowledge, Goals and Preferences sections out.
 *
 * There are two shapes here:
 *
 * - `IdentitySetupModelSchema` is what the model writes. Every section is a
 *   list of `{ field, value, kind, source, confidence }` entries with no
 *   optional properties, which keeps the schema inside what native structured
 *   output handles and lets one bad entry be dropped without losing the rest.
 * - `IdentitySetupSuggestionsSchema` is the canonical, strictly validated
 *   result. Its keys match the database columns and form state, and it is
 *   re-validated whenever suggestions come back from the browser.
 *
 * `sanitizeIdentitySetup` turns the first into the second and enforces the
 * no-fabrication rules (see its comment).
 */

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const PROVENANCE = ['fact', 'recommendation'] as const
export const CONFIDENCE = ['high', 'medium', 'low'] as const

/** The writing styles the Voice page offers; stored in voice_configs.tone. */
export const VOICE_PRESETS = WRITING_STYLES.map(s => s.value) as [
  (typeof WRITING_STYLES)[number]['value'],
  ...(typeof WRITING_STYLES)[number]['value'][]
]

/** Matches GoalPayload['objectiveType']. */
export const GOAL_OBJECTIVES = [
  'awareness',
  'engagement',
  'authority',
  'lead_gen',
  'recruiting',
  'community'
] as const

export const LINK_PLACEMENTS = ['body', 'first_comment'] as const

/** Sources a fact can cite besides a fetched URL. */
export const DESCRIPTION_SOURCE = 'description'
export const PROVIDED_SOURCE = 'provided'

// ---------------------------------------------------------------------------
// Canonical suggestions (strict)
// ---------------------------------------------------------------------------

function suggested<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    kind: z.enum(PROVENANCE),
    source: z.string().trim().max(500).optional(),
    confidence: z.enum(CONFIDENCE)
  })
}

const text = (max = 2000) => z.string().trim().min(1).max(max)
const list = z
  .array(z.string().trim().min(1).max(300))
  .min(1)
  .max(15)
const scale = z.number().int().min(1).max(5)
const missing = z.array(z.string().trim().min(1).max(300)).max(15).default([])

export type Suggested<T> = {
  value: T
  kind: (typeof PROVENANCE)[number]
  source?: string
  confidence: (typeof CONFIDENCE)[number]
}

export const ProfileSuggestionsSchema = z.object({
  name: suggested(text(200)).optional(),
  company: suggested(text(200)).optional(),
  description: suggested(text(5000)).optional(),
  targetAudience: suggested(text(2000)).optional(),
  offerings: suggested(text(3000)).optional(),
  industry: suggested(text(200)).optional(),
  linkedinUrl: suggested(text(500)).optional(),
  websiteUrl: suggested(text(500)).optional(),
  missing
})

/** Matches the fields the Voice page saves (SaveVoiceInput). */
export const VoiceSuggestionsSchema = z.object({
  tone: suggested(z.enum(VOICE_PRESETS)).optional(),
  derivedStyleRubric: suggested(z.string().trim().min(20).max(3000)).optional(),
  formality: suggested(scale).optional(),
  directness: suggested(scale).optional(),
  perspective: suggested(VoiceAnalysisSchema.shape.perspective).optional(),
  emojiPolicy: suggested(VoiceAnalysisSchema.shape.emojiPolicy).optional(),
  hashtagPolicy: suggested(text(100)).optional(),
  bannedWords: suggested(list).optional(),
  missing
})

/** Matches GoalPayload. */
export const GoalSuggestionsSchema = z.object({
  title: suggested(text(200)).optional(),
  objectiveType: suggested(z.enum(GOAL_OBJECTIVES)).optional(),
  keyMessage: suggested(text(1000)).optional(),
  desiredAction: suggested(text(500)).optional(),
  targetUrl: suggested(text(500)).optional(),
  missing
})

/** Same shape as the ContentPillar stored in preferences.pillars. */
export const PillarSuggestionSchema = z.object({
  name: text(120),
  weight_pct: z.number().int().min(0).max(100),
  example_topics: z.array(z.string().trim().min(1).max(200)).max(10).default([])
})

export const PreferencesSuggestionsSchema = z.object({
  pillars: suggested(
    z
      .array(PillarSuggestionSchema)
      .min(1)
      .max(6)
      .refine(
        pillars => pillars.reduce((sum, p) => sum + p.weight_pct, 0) === 100,
        'Pillar weights must sum to 100'
      )
  ).optional(),
  linkPlacement: suggested(z.enum(LINK_PLACEMENTS)).optional(),
  bannedTopics: suggested(list).optional(),
  complianceNotes: suggested(text(1000)).optional(),
  missing
})

export const KnowledgeSuggestionsSchema = z.object({
  /** Only URLs the user supplied or mentioned; `accessible` means we fetched it. */
  sources: z
    .array(
      z.object({
        url: z.string().trim().max(500).optional(),
        title: text(200),
        reason: text(500),
        accessible: z.boolean()
      })
    )
    .max(10)
    .default([]),
  /** Each quote has been checked against the text it cites. */
  facts: z
    .array(
      z.object({
        statement: text(500),
        quote: text(1000),
        source: text(500)
      })
    )
    .max(15)
    .default([]),
  /** What the user could add when there is no source material yet. */
  suggestedAdditions: z.array(text(300)).max(10).default([]),
  missing
})

export const IdentitySetupSuggestionsSchema = z.object({
  profile: ProfileSuggestionsSchema,
  voice: VoiceSuggestionsSchema,
  goals: GoalSuggestionsSchema,
  preferences: PreferencesSuggestionsSchema,
  knowledge: KnowledgeSuggestionsSchema
})

export type IdentitySetupSuggestions = z.infer<
  typeof IdentitySetupSuggestionsSchema
>
export type ProfileSuggestions = IdentitySetupSuggestions['profile']
export type VoiceSuggestions = IdentitySetupSuggestions['voice']
export type GoalSuggestions = IdentitySetupSuggestions['goals']
export type PreferencesSuggestions = IdentitySetupSuggestions['preferences']
export type KnowledgeSuggestions = IdentitySetupSuggestions['knowledge']

export type SetupSection = keyof IdentitySetupSuggestions
export const SETUP_SECTIONS: SetupSection[] = [
  'profile',
  'voice',
  'knowledge',
  'goals',
  'preferences'
]

export const EMPTY_SUGGESTIONS: IdentitySetupSuggestions = {
  profile: { missing: [] },
  voice: { missing: [] },
  goals: { missing: [] },
  preferences: { missing: [] },
  knowledge: { sources: [], facts: [], suggestedAdditions: [], missing: [] }
}

// ---------------------------------------------------------------------------
// Field metadata: how the model's string values are read, plus UI labels
// ---------------------------------------------------------------------------

type FieldSpec =
  | { type: 'text'; label: string; url?: boolean; noneIsAnswer?: boolean }
  | { type: 'list'; label: string; options?: readonly string[] }
  | { type: 'scale'; label: string }
  | { type: 'enum'; label: string; options: readonly string[] }

type EntrySection = 'profile' | 'voice' | 'goals' | 'preferences'

export const FIELD_SPECS = {
  profile: {
    name: { type: 'text', label: 'Display name' },
    company: { type: 'text', label: 'Company name' },
    description: { type: 'text', label: 'Description' },
    targetAudience: { type: 'text', label: 'Target audience' },
    offerings: { type: 'text', label: 'Offerings' },
    industry: { type: 'text', label: 'Industry' },
    linkedinUrl: { type: 'text', label: 'LinkedIn URL', url: true },
    websiteUrl: { type: 'text', label: 'Website URL', url: true }
  },
  voice: {
    tone: { type: 'enum', label: 'Writing style', options: VOICE_PRESETS },
    derivedStyleRubric: { type: 'text', label: 'Voice summary' },
    formality: { type: 'scale', label: 'Formality' },
    directness: { type: 'scale', label: 'Directness' },
    perspective: {
      type: 'enum',
      label: 'Who is speaking',
      options: VoiceAnalysisSchema.shape.perspective.options
    },
    emojiPolicy: {
      type: 'enum',
      label: 'Emoji',
      options: VoiceAnalysisSchema.shape.emojiPolicy.options
    },
    hashtagPolicy: { type: 'text', label: 'Hashtags', noneIsAnswer: true },
    bannedWords: { type: 'list', label: 'Words to avoid' }
  },
  goals: {
    title: { type: 'text', label: 'Goal name' },
    objectiveType: {
      type: 'enum',
      label: 'Objective',
      options: GOAL_OBJECTIVES
    },
    keyMessage: { type: 'text', label: 'Key message' },
    desiredAction: { type: 'text', label: 'Call to action' },
    targetUrl: { type: 'text', label: 'CTA link', url: true }
  },
  preferences: {
    linkPlacement: {
      type: 'enum',
      label: 'Link placement',
      options: LINK_PLACEMENTS
    },
    bannedTopics: { type: 'list', label: 'Topics to avoid' },
    complianceNotes: { type: 'text', label: 'Extra rules' }
  }
} as const satisfies Record<EntrySection, Record<string, FieldSpec>>

export const SECTION_LABELS: Record<SetupSection, string> = {
  profile: 'Profile',
  voice: 'Voice',
  knowledge: 'Knowledge',
  goals: 'Goals',
  preferences: 'Preferences'
}

export function fieldLabel(section: SetupSection, field: string): string {
  if (field === 'pillars') return 'Content pillars'
  const specs = (FIELD_SPECS as Record<string, Record<string, FieldSpec>>)[
    section
  ]
  return specs?.[field]?.label ?? field
}

// ---------------------------------------------------------------------------
// What the model writes
// ---------------------------------------------------------------------------

function fieldNames<S extends EntrySection>(section: S) {
  return Object.keys(FIELD_SPECS[section]) as [string, ...string[]]
}

function entrySchema(section: EntrySection) {
  return z.object({
    field: z.enum(fieldNames(section)),
    value: z
      .string()
      .describe(
        'The value as text. Lists: one item per line. Scales: a number 1-5.'
      ),
    kind: z
      .enum(PROVENANCE)
      .describe(
        '"fact" only when the value is stated in the description or a fetched page; otherwise "recommendation".'
      ),
    source: z
      .string()
      .describe(
        'For facts: "description" or the exact URL of the fetched page. Empty string for recommendations.'
      ),
    confidence: z.enum(CONFIDENCE)
  })
}

const modelMissing = z
  .array(z.string())
  .describe('Information the user would need to supply to complete this section.')

export const IdentitySetupModelSchema = z.object({
  profile: z.object({
    fields: z.array(entrySchema('profile')),
    missing: modelMissing
  }),
  voice: z.object({
    fields: z.array(entrySchema('voice')),
    missing: modelMissing
  }),
  goals: z.object({
    fields: z.array(entrySchema('goals')),
    missing: modelMissing
  }),
  preferences: z.object({
    fields: z.array(entrySchema('preferences')),
    pillars: z.array(
      z.object({
        name: z.string(),
        weightPct: z.number(),
        topics: z.array(z.string())
      })
    ),
    missing: modelMissing
  }),
  knowledge: z.object({
    sources: z.array(
      z.object({
        url: z
          .string()
          .describe('A URL from the user input only. Empty string for a document.'),
        title: z.string(),
        reason: z.string()
      })
    ),
    facts: z.array(
      z.object({
        statement: z.string(),
        quote: z
          .string()
          .describe('Copied character-for-character from the cited source.'),
        source: z.string().describe('"description" or the fetched page URL.')
      })
    ),
    suggestedAdditions: z.array(z.string()),
    missing: modelMissing
  })
})

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const optionalUrlInput = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform(value => value || undefined)

export const AnalyzeIdentityInputSchema = z.object({
  accountId: z.string().uuid().optional(),
  description: z
    .string()
    .trim()
    .min(1, 'Describe yourself or your business before analyzing.')
    .max(8000, 'Keep the description under 8,000 characters.'),
  linkedinUrl: optionalUrlInput,
  websiteUrl: optionalUrlInput
})

export type AnalyzeIdentityInput = z.input<typeof AnalyzeIdentityInputSchema>

export type SourceFetchStatus = {
  url: string
  kind: 'linkedin' | 'website'
  status: 'fetched' | 'unavailable'
  title?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// Sanitizing model output
// ---------------------------------------------------------------------------

export type SanitizeContext = {
  /** The user's own description. Facts may quote it. */
  description: string
  /** URLs the user typed into the form. */
  providedUrls: string[]
  /** Pages that were fetched successfully, with the text the model saw. */
  fetchedSources: Array<{ url: string; content: string }>
}

const EMPTY_VALUE = /^(n\/?a|unknown|not specified|not provided|-+)$/i
/** "none" is a real answer for enums like emoji policy, but not for a company name. */
const NONE_VALUE = /^none$/i

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}

/** Lowercase host, no scheme, no "www.", no trailing slash. */
export function normalizeUrlForCompare(raw: string): string {
  const trimmed = raw.trim()
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    return `${host}${path}${url.search}`
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '')
  }
}

/** URLs written in the user's description, e.g. "see acme.com/case-study". */
export function extractUrls(textValue: string): string[] {
  const matches =
    textValue.match(
      /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s)<>"']*)?/gi
    ) || []
  return matches
    .map(m => m.replace(/[.,;:!?]+$/, ''))
    .filter(m => m.includes('/') || /\.(com|io|ai|co|org|net|dev|app)\b/i.test(m))
}

function normalizeForQuote(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function readListValue(value: unknown): string[] {
  const items = Array.isArray(value)
    ? value.map(asString)
    : asString(value).split(/\n+/)
  return Array.from(
    new Set(
      items
        .map(item => item.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
        .filter(item => item && !EMPTY_VALUE.test(item) && !NONE_VALUE.test(item))
    )
  ).slice(0, 15)
}

function enumKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '_')
}

/** Reads one model entry's value into the type its field expects. */
function readEntryValue(spec: FieldSpec, raw: unknown): unknown {
  switch (spec.type) {
    case 'scale': {
      const match = /\d+(?:\.\d+)?/.exec(asString(raw))
      return match ? Math.round(Number(match[0])) : undefined
    }
    case 'enum': {
      // "first comment", "First_Comment" and "first-comment" all mean first_comment.
      const value = asString(raw)
      const key = enumKey(value)
      return spec.options.find(o => enumKey(o) === key) ?? value
    }
    case 'list': {
      const items = readListValue(raw)
      if (!spec.options) return items
      return items
        .map(item => {
          const key = enumKey(item)
          return spec.options!.find(o => enumKey(o) === key)
        })
        .filter((o): o is string => Boolean(o))
    }
    default:
      return asString(raw)
  }
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return !value.trim() || EMPTY_VALUE.test(value.trim())
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** Largest-remainder rounding so the weights land on exactly 100. */
export function normalizeWeights(weights: number[]): number[] {
  if (weights.length === 0) return []
  const positive = weights.map(w => (Number.isFinite(w) && w > 0 ? w : 0))
  const total = positive.reduce((a, b) => a + b, 0)
  const shares =
    total > 0
      ? positive.map(w => (w / total) * 100)
      : positive.map(() => 100 / weights.length)
  const floored = shares.map(Math.floor)
  let remainder = 100 - floored.reduce((a, b) => a + b, 0)
  const order = shares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const { index } of order) {
    if (remainder <= 0) break
    floored[index] = (floored[index] ?? 0) + 1
    remainder--
  }
  return floored
}

/**
 * Validates raw model output field by field and applies the honesty rules:
 *
 * - An invalid or unexpected field is dropped with a warning; the rest survive.
 * - A "fact" must cite the description or a page that was actually fetched,
 *   otherwise it is downgraded to a recommendation.
 * - Voice settings are always recommendations: no posts were analyzed here.
 * - URLs (profile links, CTA link, knowledge sources) survive only if the user
 *   typed them, either in the form or in the description.
 * - Knowledge facts survive only if their quote appears verbatim in the text
 *   they cite.
 */
export function sanitizeIdentitySetup(
  raw: unknown,
  context: SanitizeContext
): { suggestions: IdentitySetupSuggestions; warnings: string[] } {
  const warnings: string[] = []
  const root = asRecord(raw)
  if (!root) {
    return {
      suggestions: structuredClone(EMPTY_SUGGESTIONS),
      warnings: ['The AI response was not a JSON object, so nothing could be used.']
    }
  }

  const allowedUrls = new Map<string, string>()
  for (const url of [...context.providedUrls, ...extractUrls(context.description)]) {
    allowedUrls.set(normalizeUrlForCompare(url), url)
  }
  const fetchedByKey = new Map(
    context.fetchedSources.map(s => [normalizeUrlForCompare(s.url), s])
  )

  const resolveSourceText = (source: string): string | null => {
    if (source.toLowerCase() === DESCRIPTION_SOURCE) return context.description
    return fetchedByKey.get(normalizeUrlForCompare(source))?.content ?? null
  }

  const resolveAllowedUrl = (value: string): string | null =>
    allowedUrls.get(normalizeUrlForCompare(value)) ?? null

  const readSection = <S extends EntrySection>(
    section: S,
    schema: z.ZodObject<z.ZodRawShape>
  ): Record<string, unknown> => {
    const sectionRaw = asRecord(root[section])
    const result: Record<string, unknown> = {
      missing: readListValue(sectionRaw?.missing)
    }
    if (!sectionRaw) {
      if (root[section] !== undefined) {
        warnings.push(`${SECTION_LABELS[section]}: the AI returned an invalid section.`)
      }
      return result
    }

    const specs = FIELD_SPECS[section] as Record<string, FieldSpec>
    for (const entryRaw of asArray(sectionRaw.fields)) {
      const entry = asRecord(entryRaw)
      const field = asString(entry?.field)
      const spec = specs[field]
      if (!entry || !spec) {
        warnings.push(
          `${SECTION_LABELS[section]}: ignored an unexpected field${field ? ` "${field}"` : ''}.`
        )
        continue
      }
      if (field in result) continue

      let value = readEntryValue(spec, entry.value)
      if (isEmptyValue(value)) continue
      if (spec.type === 'text' && !spec.noneIsAnswer && NONE_VALUE.test(String(value))) {
        continue
      }

      let kind = asString(entry.kind) === 'fact' ? 'fact' : 'recommendation'
      let source: string | undefined = asString(entry.source) || undefined

      if (spec.type === 'text' && spec.url) {
        const allowed = resolveAllowedUrl(String(value))
        if (!allowed) {
          warnings.push(
            `${SECTION_LABELS[section]} → ${spec.label}: dropped a URL you did not provide.`
          )
          continue
        }
        value = allowed
        kind = 'fact'
        source = PROVIDED_SOURCE
      } else if (kind === 'fact' && (!source || resolveSourceText(source) === null)) {
        kind = 'recommendation'
        source = undefined
      }

      if (section === 'voice') {
        kind = 'recommendation'
        source = undefined
      }
      if (kind === 'recommendation') source = undefined

      const candidate = {
        value,
        kind,
        source,
        confidence: CONFIDENCE.includes(asString(entry.confidence) as never)
          ? asString(entry.confidence)
          : 'medium'
      }
      const fieldSchema = schema.shape[field] as z.ZodType | undefined
      const parsed = fieldSchema?.safeParse(candidate)
      if (!parsed?.success) {
        warnings.push(
          `${SECTION_LABELS[section]} → ${spec.label}: ignored an invalid value.`
        )
        continue
      }
      result[field] = parsed.data
    }
    return result
  }

  const profile = readSection('profile', ProfileSuggestionsSchema)
  const voice = readSection('voice', VoiceSuggestionsSchema)
  const goals = readSection('goals', GoalSuggestionsSchema)
  const preferences = readSection('preferences', PreferencesSuggestionsSchema)

  // Links the user typed into the form are facts by definition.
  for (const url of context.providedUrls) {
    const field = /(^|\.)linkedin\.com/i.test(normalizeUrlForCompare(url))
      ? 'linkedinUrl'
      : 'websiteUrl'
    if (!profile[field]) {
      profile[field] = {
        value: url,
        kind: 'fact',
        source: PROVIDED_SOURCE,
        confidence: 'high'
      }
    }
  }

  // Pillars: always recommendations, weights normalized to 100.
  const prefsRaw = asRecord(root.preferences)
  const pillarsRaw = asArray(prefsRaw?.pillars)
    .map(asRecord)
    .filter((p): p is Record<string, unknown> => Boolean(p && asString(p.name)))
    .slice(0, 6)
  if (pillarsRaw.length > 0) {
    const weights = normalizeWeights(pillarsRaw.map(p => Number(p.weightPct)))
    const pillars = pillarsRaw.map((p, index) => ({
      name: asString(p.name).slice(0, 120),
      weight_pct: weights[index] ?? 0,
      example_topics: readListValue(p.topics).slice(0, 10)
    }))
    const parsed = PreferencesSuggestionsSchema.shape.pillars.safeParse({
      value: pillars,
      kind: 'recommendation',
      confidence: 'medium'
    })
    if (parsed.success) {
      preferences.pillars = parsed.data
    } else {
      warnings.push('Preferences → Content pillars: ignored an invalid value.')
    }
  } else if (prefsRaw && prefsRaw.pillars !== undefined && !Array.isArray(prefsRaw.pillars)) {
    warnings.push('Preferences → Content pillars: ignored an invalid value.')
  }

  // Knowledge
  const knowledgeRaw = asRecord(root.knowledge)
  const suggestedAdditions = readListValue(knowledgeRaw?.suggestedAdditions)
  const sources: KnowledgeSuggestions['sources'] = []
  for (const sourceRaw of asArray(knowledgeRaw?.sources)) {
    const item = asRecord(sourceRaw)
    const title = asString(item?.title).slice(0, 200)
    const reason = asString(item?.reason).slice(0, 500)
    const rawUrl = asString(item?.url)
    if (!title || !reason) continue

    if (!rawUrl) {
      suggestedAdditions.push(`${title}: ${reason}`)
      continue
    }
    const url = resolveAllowedUrl(rawUrl)
    if (!url) {
      // Keep the idea, never the invented link.
      suggestedAdditions.push(`${title}: ${reason}`)
      warnings.push('Knowledge: dropped a source URL you did not provide.')
      continue
    }
    if (sources.some(s => s.url && normalizeUrlForCompare(s.url) === normalizeUrlForCompare(url))) {
      continue
    }
    sources.push({
      url,
      title,
      reason,
      accessible: fetchedByKey.has(normalizeUrlForCompare(url))
    })
  }

  const facts: KnowledgeSuggestions['facts'] = []
  for (const factRaw of asArray(knowledgeRaw?.facts)) {
    const item = asRecord(factRaw)
    const statement = asString(item?.statement)
    const quote = asString(item?.quote)
    const source = asString(item?.source)
    const sourceText = source ? resolveSourceText(source) : null
    if (!statement || quote.length < 15 || sourceText === null) {
      warnings.push('Knowledge: dropped a fact without a checkable source.')
      continue
    }
    if (!normalizeForQuote(sourceText).includes(normalizeForQuote(quote))) {
      warnings.push('Knowledge: dropped a fact whose quote is not in its source.')
      continue
    }
    facts.push({
      statement: statement.slice(0, 500),
      quote: quote.slice(0, 1000),
      source:
        source.toLowerCase() === DESCRIPTION_SOURCE
          ? DESCRIPTION_SOURCE
          : (fetchedByKey.get(normalizeUrlForCompare(source))?.url ?? source)
    })
  }

  const knowledge = {
    sources: sources.slice(0, 10),
    facts: facts.slice(0, 15),
    suggestedAdditions: Array.from(new Set(suggestedAdditions))
      .map(s => s.slice(0, 300))
      .slice(0, 10),
    missing: readListValue(knowledgeRaw?.missing)
  }

  // Every field was checked above; this guarantees the overall shape.
  const final = IdentitySetupSuggestionsSchema.safeParse({
    profile,
    voice,
    goals,
    preferences,
    knowledge
  })
  if (!final.success) {
    return {
      suggestions: structuredClone(EMPTY_SUGGESTIONS),
      warnings: [...warnings, 'The AI response could not be validated.']
    }
  }
  return { suggestions: final.data, warnings: Array.from(new Set(warnings)) }
}

// ---------------------------------------------------------------------------
// Section status
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Record<SetupSection, string[]> = {
  profile: ['name', 'description', 'targetAudience', 'offerings', 'industry'],
  // Every voice setting has a default, so these two are what make it the user's.
  voice: ['tone', 'derivedStyleRubric'],
  goals: ['title', 'keyMessage'],
  preferences: ['pillars'],
  knowledge: []
}

export type SectionStatus = {
  state: 'ready' | 'partial' | 'empty'
  filled: string[]
  /** Required fields with no suggestion, as labels. */
  missingRequired: string[]
  /** What the AI said it would need to know. */
  missingInfo: string[]
}

export function suggestedFields(
  suggestions: IdentitySetupSuggestions,
  section: SetupSection
): string[] {
  if (section === 'knowledge') return []
  const data = suggestions[section] as Record<string, unknown>
  return Object.keys(data).filter(key => key !== 'missing' && data[key])
}

export function getSectionStatus(
  suggestions: IdentitySetupSuggestions,
  section: SetupSection
): SectionStatus {
  const missingInfo = suggestions[section].missing ?? []

  if (section === 'knowledge') {
    const k = suggestions.knowledge
    const count = k.sources.length + k.facts.length
    return {
      state: count > 0 ? 'ready' : k.suggestedAdditions.length > 0 ? 'partial' : 'empty',
      filled: [],
      missingRequired: [],
      missingInfo
    }
  }

  const filled = suggestedFields(suggestions, section)
  const missingRequired = REQUIRED_FIELDS[section]
    .filter(field => !filled.includes(field))
    .map(field => fieldLabel(section, field))

  return {
    state:
      filled.length === 0
        ? 'empty'
        : missingRequired.length === 0
          ? 'ready'
          : 'partial',
    filled,
    missingRequired,
    missingInfo
  }
}

export function hasAnySuggestion(suggestions: IdentitySetupSuggestions): boolean {
  return SETUP_SECTIONS.some(
    section => getSectionStatus(suggestions, section).state !== 'empty'
  )
}
