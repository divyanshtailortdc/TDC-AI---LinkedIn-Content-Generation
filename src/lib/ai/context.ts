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
  type CadencePolicy,
  type ContentPillar,
  type Goal,
  type Guardrails,
  type KnowledgeDocument,
  type MediaPolicy,
  type Offering,
  type PostConstraints,
  type ResearchPolicy,
  type SamplePost,
  type VoiceConfig
} from '@/db/schema'
import { eq } from 'drizzle-orm'
import { pickWeightedPillars } from './pillars'

export { pickWeightedPillars }

/**
 * Every generation stage reads its settings through this module.
 *
 * Before it existed each stage reached into `preferences` directly and used a
 * handful of fields, so research policy, media policy and guardrails were
 * configured in the UI but never reached the model.
 */

export const DEFAULT_CADENCE: CadencePolicy = {
  frequency: 3,
  days_of_week: ['Monday', 'Wednesday', 'Friday'],
  time_of_day: '08:30',
  posts_per_run: 1,
  ideas_per_run: 5
}

export const DEFAULT_RESEARCH_POLICY: ResearchPolicy = {
  use_knowledge_base: true,
  source_ids: [],
  use_web_search: true,
  provider: 'serper',
  domain_mode: 'none',
  allowed_domains: [],
  blocked_domains: [],
  freshness_days: 30,
  max_searches_per_run: 3,
  require_citations: true,
  min_citations_per_post: 1
}

export const DEFAULT_MEDIA_POLICY: MediaPolicy = {
  default_mode: 'none',
  image_style_prompt: '',
  aspect_ratio: '16:9',
  always_include_alt_text: true
}

export const DEFAULT_POST_CONSTRAINTS: PostConstraints = {
  max_chars: 3000,
  target_chars: 1300,
  hook_max_chars: 200,
  hashtag_count: 3,
  emoji_level: 'bullets_only',
  link_placement: 'first_comment',
  cta_required: true,
  variants_per_post: 2
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  banned_topics: [],
  banned_words: [],
  compliance_notes: ''
}

export interface ResolvedPreferences {
  pillars: ContentPillar[]
  formats: Array<{ format: string; weight: number }>
  cadence: CadencePolicy
  research: ResearchPolicy
  media: MediaPolicy
  constraints: PostConstraints
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

/** Merges a stored jsonb policy over its defaults, tolerating null/legacy shapes. */
function merge<T extends object>(defaults: T, stored: unknown): T {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...defaults }
  }
  return { ...defaults, ...(stored as Partial<T>) }
}

/**
 * The preferences form once packed every policy into the `pillars` column.
 * Rows are backfilled, but reading both keeps older rows working.
 */
function resolvePreferences(
  row:
    | (typeof preferencesTable.$inferSelect)
    | undefined
    | null
): ResolvedPreferences {
  const rawPillars = row?.pillars as unknown
  const legacy =
    rawPillars && typeof rawPillars === 'object' && !Array.isArray(rawPillars)
      ? (rawPillars as Record<string, unknown>)
      : null

  const pillars: ContentPillar[] = Array.isArray(rawPillars)
    ? (rawPillars as ContentPillar[])
    : Array.isArray(legacy?.pillars)
      ? (legacy!.pillars as ContentPillar[])
      : []

  const media = merge(
    DEFAULT_MEDIA_POLICY,
    row?.mediaPolicy ?? legacy?.media_policy
  )

  return {
    pillars,
    formats:
      (row?.formats as Array<{ format: string; weight: number }> | null) ||
      (legacy?.formats as Array<{ format: string; weight: number }>) ||
      [],
    cadence: merge(DEFAULT_CADENCE, row?.cadence ?? legacy?.cadence),
    research: merge(
      DEFAULT_RESEARCH_POLICY,
      row?.researchPolicy ?? legacy?.research_policy
    ),
    media: {
      ...media,
      // The form once emitted `stock_search`, which matched nothing downstream.
      default_mode:
        (media.default_mode as string) === 'stock_search'
          ? 'stock'
          : media.default_mode
    },
    constraints: merge(
      DEFAULT_POST_CONSTRAINTS,
      row?.postConstraints ?? legacy?.post_constraints
    ),
    guardrails: merge(
      DEFAULT_GUARDRAILS,
      row?.guardrails ?? legacy?.guardrails
    )
  }
}

/** True when the goal's date window (if any) includes today. */
function isGoalInWindow(goal: Goal, now = new Date()): boolean {
  if (goal.startDate && new Date(goal.startDate) > now) return false
  if (goal.endDate && new Date(goal.endDate) < now) return false
  return true
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
      : goals.filter(g => g.isActive && isGoalInWindow(g))
  )
    // Heaviest goal first so the run leads with what matters most.
    .sort((a, b) => (b.weight ?? 5) - (a.weight ?? 5))

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
    prefs: resolvePreferences(preferences)
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
  if (a.bio) lines.push(`Bio: ${a.bio}`)
  if (a.websiteUrl) lines.push(`Website: ${a.websiteUrl}`)

  if (ctx.offerings.length > 0) {
    lines.push('', 'What they offer:')
    for (const o of ctx.offerings) {
      const parts = [`- ${o.name} (${o.type})`]
      if (o.tagline) parts.push(`  Tagline: ${o.tagline}`)
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

export function renderAudienceBlock(ctx: GenerationContext, goal?: Goal | null): string {
  const targeted = goal?.audienceId
    ? ctx.audiences.filter(a => a.id === goal.audienceId)
    : ctx.audiences

  const audiences = targeted.length > 0 ? targeted : ctx.audiences
  if (audiences.length === 0) return 'Audience: not yet defined.'

  return audiences
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
  if (goal.description) lines.push(`Context: ${goal.description}`)
  if (goal.desiredAction) lines.push(`Desired reader action: ${goal.desiredAction}`)
  if (goal.successMetric) lines.push(`Success metric: ${goal.successMetric}`)
  const dos = list(goal.dos)
  if (dos) lines.push(`Do: ${dos}`)
  const donts = list(goal.donts)
  if (donts) lines.push(`Do NOT: ${donts}`)
  return lines.join('\n')
}

/** Renders every voice axis, not just the derived rubric. */
export function renderVoiceBlock(ctx: GenerationContext): string {
  const v = ctx.voice
  if (!v) return 'Voice: not yet analyzed. Write clearly, concretely and without hype.'

  const scale = (n: number, low: string, high: string) =>
    `${n}/5 (1 = ${low}, 5 = ${high})`

  const lines = [
    `Tone: ${v.tone}`,
    `Perspective: write as "${v.perspective}"`,
    `Formality: ${scale(v.formality, 'very casual', 'strictly formal')}`,
    `Warmth: ${scale(v.warmth, 'clinical', 'empathetic')}`,
    `Directness: ${scale(v.directness, 'diplomatic', 'bluntly punchy')}`,
    `Story vs data: ${scale(v.storyVsData, 'personal narrative', 'data-driven')}`,
    `Humor: ${v.humor}`,
    `Energy: ${v.energy}`,
    `Sentence length: ${v.sentenceLength}`,
    `Paragraph style: ${v.paragraphStyle}`,
    `Reading level target: ${v.readingLevelTarget}`,
    `Emoji policy: ${v.emojiPolicy}`,
    `Hashtag policy: ${v.hashtagPolicy}`
  ]

  const openings = list(v.openingStyles)
  if (openings) lines.push(`Opening styles that work for this author: ${openings}`)
  const closings = list(v.closingStyles)
  if (closings) lines.push(`Closing styles that work for this author: ${closings}`)
  const signatures = list(v.signaturePhrases)
  if (signatures) lines.push(`Signature phrases (use sparingly, never all at once): ${signatures}`)

  if (v.derivedStyleRubric) {
    lines.push('', `Style rubric derived from their real posts:\n${v.derivedStyleRubric}`)
  }
  if (v.rules) lines.push('', `Editorial rules:\n${v.rules}`)

  return lines.join('\n')
}

/** Voice banned words plus preference guardrails, deduplicated. */
export function collectBannedWords(ctx: GenerationContext): string[] {
  return Array.from(
    new Set(
      [
        ...((ctx.voice?.bannedWords as string[] | null) || []),
        ...(ctx.prefs.guardrails.banned_words || [])
      ]
        .map(w => w.trim())
        .filter(Boolean)
    )
  )
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
    `Hashtags: exactly ${c.hashtag_count}${c.hashtag_count === 0 ? ' (none at all)' : ', at the end'}.`,
    emoji,
    c.link_placement === 'first_comment'
      ? 'Any external link goes in firstComment, never in the body — LinkedIn suppresses reach on body links.'
      : 'External links may appear in the body.',
    c.cta_required
      ? 'Close with a call to action.'
      : 'A call to action is optional; do not force one.',
    'LinkedIn renders plain text only. No markdown: no **bold**, no ## headings, no [text](url), no backtick code fences.'
  ].join('\n')
}
