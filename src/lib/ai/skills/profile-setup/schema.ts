import { optionalUrlError, URL_MESSAGE } from '@/lib/identity-profile'
import { idSchema } from '@/lib/ids'
import { normalizeUrlForCompare } from '@/lib/urls'
import { z } from 'zod'
import { VoiceAnalysisSchema, WRITING_STYLES } from '../voice-analysis/schema'

/**
 * AI Account Setup: one natural-language description in, suggestions for the
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
 * `sanitizeIdentitySetup` (./guard) turns the first into the second and
 * enforces the no-fabrication rules (see its comment).
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

/** Matches GoalPayload['linkStrategy']: where a goal's link goes. */
export const LINK_PLACEMENTS = ['first_comment', 'body'] as const

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
    confidence: z.enum(CONFIDENCE),
    /** Why this value was suggested, shown beside it in the review. */
    note: z.string().trim().min(1).max(1000).optional()
  })
}

const text = (max = 2000) => z.string().trim().min(1).max(max)
/** A link a person can edit in the review window: the same rule the save applies. */
const urlText = text(500).refine(value => !optionalUrlError(value), URL_MESSAGE)
const list = z.array(z.string().trim().min(1).max(300)).min(1).max(15)
const scale = z.number().int().min(1).max(5)
const missing = z.array(z.string().trim().min(1).max(300)).max(15).default([])

export type Suggested<T> = {
  value: T
  kind: (typeof PROVENANCE)[number]
  source?: string
  confidence: (typeof CONFIDENCE)[number]
  note?: string
}

/** Where one line of a list came from. */
export const LineBasisSchema = z.object({
  text: z.string().trim().min(1).max(300),
  kind: z.enum(PROVENANCE),
  source: z.string().trim().max(500).optional()
})

export type LineBasis = z.infer<typeof LineBasisSchema>

/**
 * Audience and offerings usually mix lines the user stated with lines the AI
 * suggests, so each line keeps its own provenance. The field as a whole is a
 * fact only when every line is one from the same source.
 */
function suggestedLines(max: number) {
  return suggested(text(max)).extend({
    lines: z.array(LineBasisSchema).max(15).optional()
  })
}

export const ProfileSuggestionsSchema = z.object({
  name: suggested(text(200)).optional(),
  company: suggested(text(200)).optional(),
  description: suggested(text(5000)).optional(),
  targetAudience: suggestedLines(2000).optional(),
  offerings: suggestedLines(3000).optional(),
  industry: suggested(text(200)).optional(),
  linkedinUrl: suggested(urlText).optional(),
  websiteUrl: suggested(urlText).optional(),
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
  targetUrl: suggested(urlText).optional(),
  linkStrategy: suggested(z.enum(LINK_PLACEMENTS)).optional(),
  missing
})

/** What to write about comes from goals now; content pillars are gone. */
export const PreferencesSuggestionsSchema = z.object({
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
        accessible: z.boolean(),
        /** On the business's own website, rather than a page about it. */
        official: z.boolean().optional()
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
        source: text(500),
        /** Quoted from the business's own website. */
        official: z.boolean().optional()
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

export type FieldSpec =
  | { type: 'text'; label: string; url?: boolean; noneIsAnswer?: boolean }
  | { type: 'list'; label: string; options?: readonly string[] }
  | { type: 'scale'; label: string }
  | { type: 'enum'; label: string; options: readonly string[] }

export type EntrySection = 'profile' | 'voice' | 'goals' | 'preferences'

export const FIELD_SPECS = {
  profile: {
    name: { type: 'text', label: 'Display name' },
    // Labelled by identity type where that is known (see fieldLabel).
    company: { type: 'text', label: 'Company' },
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
    targetUrl: { type: 'text', label: 'CTA link', url: true },
    linkStrategy: {
      type: 'enum',
      label: 'Links go in',
      options: LINK_PLACEMENTS
    }
  },
  preferences: {
    bannedTopics: { type: 'list', label: 'Topics to avoid' },
    complianceNotes: { type: 'text', label: 'Extra rules' }
  }
} as const satisfies Record<EntrySection, Record<string, FieldSpec>>

/** A URL's host without "www.", or null when it is not a web address. */
function hostLabel(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** The suggested website, when it is a link the user gave or research verified. */
export function officialSiteOf(
  suggestions: IdentitySetupSuggestions
): string | undefined {
  const site = suggestions.profile.websiteUrl
  return site?.kind === 'fact' ? site.value : undefined
}

/**
 * Where a suggested value came from, as the review shows it. Every page used
 * to read "From a web page", so a fan blog and the business's own site looked
 * the same, and a website found by search read as if a page stated it. The
 * page's host is named, the business's own site is marked as such, and a link
 * sourced to itself (research verified it) reads as found by web search.
 * `short` is the form for one line of a list.
 */
export function describeSource(
  item: { kind: string; source?: string; value?: unknown },
  officialUrl?: string,
  short = false
): string {
  if (item.source === 'edited') return 'Edited'
  if (item.kind !== 'fact') return short ? 'Suggested' : 'AI suggestion'
  const source = item.source ?? ''
  if (source.toLowerCase() === DESCRIPTION_SOURCE) {
    return short ? 'Your description' : 'From your description'
  }
  if (source === PROVIDED_SOURCE) return short ? 'You gave this' : 'You provided this'
  const host = hostLabel(source)
  if (!host) return short ? 'Your info' : 'From your info'
  if (
    typeof item.value === 'string' &&
    normalizeUrlForCompare(item.value) === normalizeUrlForCompare(source)
  ) {
    return 'Found by web search'
  }
  const official = officialUrl !== undefined && hostLabel(officialUrl) === host
  if (short) return official ? `${host} (official)` : host
  return official ? `From ${host}, the official site` : `From ${host}`
}

export const SECTION_LABELS: Record<SetupSection, string> = {
  profile: 'Profile',
  voice: 'Voice',
  knowledge: 'Knowledge',
  goals: 'Goals',
  preferences: 'Preferences'
}

/**
 * `accountType` names the company field the way the Profile form does: a
 * person's current company, or a company's parent company or brand.
 */
export function fieldLabel(
  section: SetupSection,
  field: string,
  accountType?: 'personal' | 'company'
): string {
  if (section === 'profile' && field === 'company' && accountType) {
    return accountType === 'company'
      ? 'Parent company / brand'
      : 'Current company'
  }
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
        'For facts: "description", "provided" (a value from <choices>) or the exact URL of the fetched page. Empty string for recommendations.'
      ),
    confidence: z.enum(CONFIDENCE)
  })
}

const modelMissing = z
  .array(z.string())
  .describe(
    'Information the user would need to supply to complete this section.'
  )

export const IdentitySetupModelSchema = z.object({
  profile: z.object({
    identityType: z
      .enum(['person', 'company'])
      .describe(
        'The identity every field is written for: the identity type in <choices>, or the one decided from the input.'
      ),
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
    missing: modelMissing
  }),
  knowledge: z.object({
    sources: z.array(
      z.object({
        url: z
          .string()
          .describe(
            'A URL from the user input only. Empty string for a document.'
          ),
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
  .refine(value => !optionalUrlError(value ?? ''), URL_MESSAGE)
  .transform(value => value || undefined)

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform(value => value || undefined)

/**
 * Choices from Advanced analysis. Each one the user sets is treated as their
 * own information: the model is told to use it, and applyGuidance (./guard)
 * writes it into the result whatever the model returned.
 */
export const AnalysisGuidanceSchema = z.object({
  accountType: z.enum(['personal', 'company']).optional(),
  tone: z.enum(VOICE_PRESETS).optional(),
  perspective: VoiceAnalysisSchema.shape.perspective.optional(),
  formality: z.number().int().min(1).max(5).optional(),
  emojiPolicy: VoiceAnalysisSchema.shape.emojiPolicy.optional(),
  objectiveType: z.enum(GOAL_OBJECTIVES).optional(),
  /** What the user wants LinkedIn to achieve, in their words. */
  goal: optionalText(1000),
  callToAction: optionalText(300),
  ctaUrl: optionalUrlInput,
  targetAudience: optionalText(1000),
  focusTopics: optionalText(1000),
  avoidTopics: optionalText(1000)
})

/** Every choice is optional; anything left out is up to the model. */
export type AnalysisGuidance = Partial<z.infer<typeof AnalysisGuidanceSchema>>

export const AnalyzeIdentityInputSchema = z.object({
  accountId: idSchema().optional(),
  description: z
    .string()
    .trim()
    .min(1, 'Describe yourself or your business before analyzing.')
    .max(8000, 'Keep the description under 8,000 characters.'),
  linkedinUrl: optionalUrlInput,
  websiteUrl: optionalUrlInput,
  guidance: AnalysisGuidanceSchema.optional()
})

export type AnalyzeIdentityInput = z.input<typeof AnalyzeIdentityInputSchema>

export type SourceFetchStatus = {
  url: string
  /**
   * "web" is a page found by search rather than one the user gave; "site" is
   * a page their own website links to, read for their offerings.
   */
  kind: 'linkedin' | 'website' | 'web' | 'site'
  status: 'fetched' | 'unavailable'
  title?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// Section status
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Record<SetupSection, string[]> = {
  profile: ['name', 'description', 'targetAudience', 'offerings', 'industry'],
  // Every voice setting has a default, so these two are what make it the user's.
  voice: ['tone', 'derivedStyleRubric'],
  goals: ['title', 'keyMessage'],
  preferences: [],
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
      state:
        count > 0
          ? 'ready'
          : k.suggestedAdditions.length > 0
            ? 'partial'
            : 'empty',
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

/**
 * Whether the review window has anything to apply. Knowledge facts and "worth
 * adding" ideas are handled on the Knowledge step itself, so on their own they
 * do not keep the card on "Apply Suggestions".
 */
export function hasReviewableSuggestions(
  suggestions: IdentitySetupSuggestions
): boolean {
  return SETUP_SECTIONS.some(section =>
    section === 'knowledge'
      ? suggestions.knowledge.sources.length > 0
      : getSectionStatus(suggestions, section).state !== 'empty'
  )
}

export function hasAnySuggestion(
  suggestions: IdentitySetupSuggestions
): boolean {
  return SETUP_SECTIONS.some(
    section => getSectionStatus(suggestions, section).state !== 'empty'
  )
}

export type IdentitySetupAnalysis = {
  /**
   * The identity type the suggestions were written for: the one the user
   * chose, or, when they had not, the one the AI read from their description.
   * Name and company only mean the right thing under this type.
   */
  accountType: 'personal' | 'company'
  suggestions: IdentitySetupSuggestions
  warnings: string[]
  sources: SourceFetchStatus[]
  modelUsed: string
}
