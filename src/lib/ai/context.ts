import { db } from '@/db'
import {
  accountsTable,
  audiencesTable,
  goalsTable,
  knowledgeDocumentsTable,
  offeringsTable,
  preferencesTable,
  samplePostsTable,
  voiceConfigsTable,
  type Account,
  type Audience,
  type ContentPillar,
  type Goal,
  type Guardrails,
  type KnowledgeDocument,
  type Offering,
  type PostConstraints,
  type SamplePost,
  type VoiceConfig
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { parseHashtagPolicy, type HashtagRange } from './hashtags'
import { pickWeightedPillars } from './pillars'

export { parseHashtagPolicy, pickWeightedPillars }

/**
 * Every generation stage reads its settings through this module.
 *
 * Before it existed each stage reached into `preferences` directly and used a
 * handful of fields, so research policy, media policy and guardrails were
 * configured in the UI but never reached the model.
 */

export const DEFAULT_IDEAS_PER_RUN = 5

/**
 * Research is not a per-account choice: every run reads the knowledge base,
 * and searches the web whenever a search key is configured.
 */
export const RESEARCH_SETTINGS = {
  use_web_search: true,
  freshness_days: 30,
  max_searches_per_run: 3,
  min_citations_per_post: 1
}

export const DEFAULT_POST_CONSTRAINTS: PostConstraints = {
  cta_required: true
}

export type LinkPlacement = 'body' | 'first_comment'

/**
 * Link placement is set on the goal, beside the link it applies to. Without a
 * goal, links go in the first comment, which protects reach.
 */
export function resolveLinkPlacement(goal: Goal | null | undefined): LinkPlacement {
  return goal?.linkStrategy === 'body' ? 'body' : 'first_comment'
}

/** Limits LinkedIn imposes, plus the length and alternate hooks every draft gets. */
export const FIXED_POST_LIMITS = {
  target_chars: 1300,
  /** LinkedIn's hard cap on a post. */
  max_chars: 3000,
  /** Roughly where LinkedIn folds a post behind "...see more". */
  hook_max_chars: 200,
  variants_per_post: 2
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  banned_topics: [],
  compliance_notes: ''
}

export type EmojiLevel = 'none' | 'bullets_only' | 'liberal'

/** What a voice config starts with, for accounts whose voice is not set up yet. */
const DEFAULT_EMOJI_LEVEL: EmojiLevel = 'bullets_only'
const DEFAULT_HASHTAG_POLICY = '0-3, end of post'

export type ResolvedPostConstraints = PostConstraints &
  typeof FIXED_POST_LIMITS & {
    /** From the voice config, so tone and formatting have one source. */
    emoji_level: EmojiLevel
    hashtag_policy: string
    /** Parsed from `hashtag_policy`; null when the policy names no count. */
    hashtags: HashtagRange | null
  }

export interface ResolvedPreferences {
  pillars: ContentPillar[]
  ideasPerRun: number
  research: typeof RESEARCH_SETTINGS
  constraints: ResolvedPostConstraints
  guardrails: Guardrails
}

export interface GenerationContext {
  account: Account
  voice: VoiceConfig | null
  offerings: Offering[]
  audiences: Audience[]
  knowledgeDocs: KnowledgeDocument[]
  samplePosts: SamplePost[]
  goals: Goal[]
  activeGoals: Goal[]
  primaryGoal: Goal | null
  preferencesId: string | null
  prefs: ResolvedPreferences
}

/**
 * Merges a stored jsonb policy over its defaults, tolerating null shapes.
 * Only keys the defaults declare are read, so settings that were removed from
 * the form cannot resurface from older rows.
 */
function merge<T extends object>(defaults: T, stored: unknown): T {
  const merged = { ...defaults } as Record<string, unknown>
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return merged as T
  }
  const values = stored as Record<string, unknown>
  for (const key of Object.keys(defaults)) {
    if (values[key] !== undefined) merged[key] = values[key]
  }
  return merged as T
}

function toEmojiLevel(policy: string | null | undefined): EmojiLevel {
  if (policy === 'none') return 'none'
  if (policy === 'liberal') return 'liberal'
  if (policy === 'bullets only' || policy === 'bullets_only') return 'bullets_only'
  return DEFAULT_EMOJI_LEVEL
}

/**
 * Also used by the Preferences page, so the form starts from exactly what the
 * pipeline sees. Emoji and hashtags come from `voice`; without it they fall
 * back to the defaults a new voice config starts with.
 */
export function resolvePreferences(
  row: (typeof preferencesTable.$inferSelect) | undefined | null,
  voice?: VoiceConfig | null
): ResolvedPreferences {
  const hashtagPolicy = voice?.hashtagPolicy?.trim() || DEFAULT_HASHTAG_POLICY

  return {
    pillars: Array.isArray(row?.pillars) ? row.pillars : [],
    ideasPerRun: row?.ideasPerRun ?? DEFAULT_IDEAS_PER_RUN,
    research: RESEARCH_SETTINGS,
    constraints: {
      ...merge(DEFAULT_POST_CONSTRAINTS, row?.postConstraints),
      ...FIXED_POST_LIMITS,
      emoji_level: toEmojiLevel(voice?.emojiPolicy),
      hashtag_policy: hashtagPolicy,
      hashtags: parseHashtagPolicy(hashtagPolicy)
    },
    guardrails: merge(DEFAULT_GUARDRAILS, row?.guardrails)
  }
}

export async function loadGenerationContext(
  accountId: string,
  options?: { goalId?: string | null }
): Promise<GenerationContext> {
  const [
    account,
    voice,
    offerings,
    audiences,
    knowledgeDocs,
    samplePosts,
    goals,
    preferences
  ] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, accountId) }),
    db.query.voiceConfigsTable.findFirst({
      where: eq(voiceConfigsTable.accountId, accountId)
    }),
    db.query.offeringsTable.findMany({
      where: eq(offeringsTable.accountId, accountId)
    }),
    db.query.audiencesTable.findMany({
      where: eq(audiencesTable.accountId, accountId)
    }),
    db.query.knowledgeDocumentsTable.findMany({
      where: eq(knowledgeDocumentsTable.accountId, accountId)
    }),
    db.query.samplePostsTable.findMany({
      where: eq(samplePostsTable.accountId, accountId)
    }),
    db.query.goalsTable.findMany({ where: eq(goalsTable.accountId, accountId) }),
    db.query.preferencesTable.findFirst({
      where: eq(preferencesTable.accountId, accountId)
    })
  ])

  if (!account) {
    throw new Error(`Account ${accountId} not found`)
  }

  const activeGoals = (
    options?.goalId
      ? goals.filter(g => g.id === options.goalId)
      : goals.filter(g => g.isActive)
  )
    // Newest goal first, matching the goal a queued run picks by default.
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return {
    account,
    voice: voice ?? null,
    offerings: offerings.filter(o => o.isActive),
    audiences,
    knowledgeDocs,
    samplePosts: samplePosts.filter(s => s.isActive),
    goals,
    activeGoals,
    primaryGoal: activeGoals[0] ?? null,
    preferencesId: preferences?.id ?? null,
    prefs: resolvePreferences(preferences, voice)
  }
}

// ---------------------------------------------------------------------------
// Prompt fragments — one place that turns settings into instructions
// ---------------------------------------------------------------------------

const list = (values?: string[] | null) =>
  (values || []).filter(Boolean).join(', ')

export function renderIdentityBlock(ctx: GenerationContext): string {
  const a = ctx.account
  const lines = [
    `Name: ${a.name}`,
    `Type: ${a.accountType}`,
    `Headline: ${a.headline}`
  ]
  if (a.company) lines.push(`Company: ${a.company}`)
  if (a.industry) lines.push(`Industry: ${a.industry}`)
  if (a.bio) lines.push(`Bio: ${a.bio}`)
  if (a.websiteUrl) lines.push(`Website: ${a.websiteUrl}`)
  if (a.linkedinUrl) lines.push(`LinkedIn: ${a.linkedinUrl}`)

  if (ctx.offerings.length > 0) {
    lines.push('', 'What they offer:')
    for (const o of ctx.offerings) {
      const parts = [`- ${o.name} (${o.type})`]
      if (o.tagline) parts.push(`  Tagline: ${o.tagline}`)
      // The profile's offerings text lives here, one offering per line; the
      // name is only its first line.
      const details = o.description?.trim()
      if (details && details !== o.name.trim()) {
        parts.push(`  Details: ${details.replace(/\n+/g, '\n    ')}`)
      }
      if (o.whoItIsFor) parts.push(`  For: ${o.whoItIsFor}`)
      if (o.problemSolved) parts.push(`  Problem solved: ${o.problemSolved}`)
      const diff = list(o.differentiators)
      if (diff) parts.push(`  Differentiators: ${diff}`)
      const proof = (o.proofPoints || [])
        .map(p => (p.detail ? `${p.label} — ${p.detail}` : p.label))
        .filter(Boolean)
      if (proof.length > 0) {
        // The only numbers the model is allowed to state about this business.
        parts.push(`  Verified proof points: ${proof.join('; ')}`)
      }
      lines.push(parts.join('\n'))
    }
  }

  return lines.join('\n')
}

export function renderAudienceBlock(ctx: GenerationContext): string {
  if (ctx.audiences.length === 0) return 'Audience: not yet defined.'

  return ctx.audiences
    .map(a => {
      const lines = [`- ${a.name} (sophistication: ${a.sophisticationLevel})`]
      const titles = list(a.jobTitles)
      if (titles) lines.push(`  Job titles: ${titles}`)
      const seniority = list(a.seniority)
      if (seniority) lines.push(`  Seniority: ${seniority}`)
      const industries = list(a.industries)
      if (industries) lines.push(`  Industries: ${industries}`)
      const pains = list(a.painPoints)
      if (pains) lines.push(`  Pain points: ${pains}`)
      const desires = list(a.desires)
      if (desires) lines.push(`  Desires: ${desires}`)
      const objections = list(a.objections)
      if (objections) lines.push(`  Objections: ${objections}`)
      if (a.whatTheyDontBelieveYet) {
        lines.push(
          `  Belief to move (aim the post at this, not at the topic): ${a.whatTheyDontBelieveYet}`
        )
      }
      return lines.join('\n')
    })
    .join('\n')
}

export function renderGoalBlock(goal: Goal | null): string {
  if (!goal) return 'No active goal. Default to building credible authority.'

  const lines = [
    `Title: ${goal.title}`,
    `Objective: ${goal.objective}`,
    goal.keyMessage
      ? `The one message to land: ${goal.keyMessage}`
      : 'Key message: not specified.'
  ]
  if (goal.desiredAction) lines.push(`Desired reader action: ${goal.desiredAction}`)
  return lines.join('\n')
}

/** Renders the voice settings and the rubric derived from real posts. */
export function renderVoiceBlock(ctx: GenerationContext): string {
  const v = ctx.voice
  if (!v) return 'Voice: not yet analyzed. Write clearly, concretely and without hype.'

  const scale = (n: number, low: string, high: string) =>
    `${n}/5 (1 = ${low}, 5 = ${high})`

  const lines = [
    `Tone: ${v.tone}`,
    `Perspective: write as "${v.perspective}"`,
    `Formality: ${scale(v.formality, 'very casual', 'strictly formal')}`,
    // Emoji and hashtags are rendered once, in the constraints block.
    `Directness: ${scale(v.directness, 'diplomatic', 'bluntly punchy')}`
  ]

  if (v.derivedStyleRubric) {
    lines.push('', `Style rubric derived from their real posts:\n${v.derivedStyleRubric}`)
  }

  return lines.join('\n')
}

/** The voice's banned words, deduplicated. Voice is their only home. */
export function collectBannedWords(ctx: GenerationContext): string[] {
  return Array.from(
    new Set(
      ((ctx.voice?.bannedWords as string[] | null) || [])
        .map(w => w.trim())
        .filter(Boolean)
    )
  )
}

/** The hashtag instruction, shared by the constraints block and the draft brief. */
export function describeHashtags(c: ResolvedPostConstraints): string {
  const range = c.hashtags
  if (!range) return `follow the author's policy: "${c.hashtag_policy}"`
  if (range.max === 0) return 'none at all'
  if (range.min === range.max) return `exactly ${range.min}, at the end`
  return `between ${range.min} and ${range.max}, at the end`
}

export function renderGuardrailsBlock(ctx: GenerationContext): string {
  const g = ctx.prefs.guardrails
  const lines: string[] = []
  const banned = collectBannedWords(ctx)
  if (banned.length > 0) {
    lines.push(`Never use these words or phrases: ${banned.join(', ')}.`)
  }
  if ((g.banned_topics || []).length > 0) {
    lines.push(`Never write about: ${g.banned_topics.join(', ')}.`)
  }
  if (g.compliance_notes?.trim()) {
    lines.push(`Compliance: ${g.compliance_notes.trim()}`)
  }
  return lines.join('\n')
}

export function renderConstraintsBlock(ctx: GenerationContext): string {
  const c = ctx.prefs.constraints
  const emoji =
    c.emoji_level === 'none'
      ? 'Use no emoji at all.'
      : c.emoji_level === 'liberal'
        ? 'Emoji are welcome where they add warmth.'
        : 'Emoji only as list markers, never mid-sentence.'

  return [
    `Hook: at most ${c.hook_max_chars} characters — this is the "...see more" fold. Never break mid-word or mid-sentence.`,
    `Total length: aim for about ${c.target_chars} characters, hard maximum ${c.max_chars}.`,
    `Hashtags: ${describeHashtags(c)}.`,
    emoji,
    resolveLinkPlacement(ctx.primaryGoal) === 'first_comment'
      ? 'Any external link goes in firstComment, never in the body — LinkedIn suppresses reach on body links.'
      : 'External links may appear in the body.',
    c.cta_required
      ? 'Close with a call to action.'
      : 'A call to action is optional; do not force one.',
    'LinkedIn renders plain text only. No markdown: no **bold**, no ## headings, no [text](url), no backtick code fences.'
  ].join('\n')
}
