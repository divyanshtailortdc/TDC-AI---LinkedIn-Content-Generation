import type {
  Account,
  Audience,
  ContentPillar,
  Goal,
  Guardrails,
  KnowledgeDocument,
  Offering,
  PostConstraints,
  preferencesTable,
  SamplePost,
  VoiceConfig
} from '@/db/schema'
import { parseHashtagPolicy, type HashtagRange } from './hashtags'
import { pickWeightedPillars } from './pillars'

export { parseHashtagPolicy, pickWeightedPillars }

/**
 * The pure half of ./context: the resolved settings shape and the prompt
 * blocks built from it. No database access, so tests can import it; stages
 * import both halves through ./context.
 *
 * Before ./context existed each stage reached into `preferences` directly and
 * used a handful of fields, so research policy, media policy and guardrails
 * were configured in the UI but never reached the model.
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

/**
 * What the reviewer has already seen and decided, newest first, so a run does
 * not repeat earlier work or ignore a rejection.
 */
export interface ReviewHistory {
  /** `originalHook` is what the model wrote; `hook` is the reviewer's version. */
  drafts: Array<{
    hook: string
    originalHook: string
    body: string
    /** The closing ask, so the next post can ask something different. */
    cta?: string | null
    status: string
  }>
  ideas: Array<{
    title: string
    hookConcept: string
    thesis: string
    coreArgument: string
    status: string
    runId: string | null
  }>
  /** What the reviewer wrote when rejecting a post or an idea. */
  rejectionReasons: string[]
}

export const EMPTY_HISTORY: ReviewHistory = {
  drafts: [],
  ideas: [],
  rejectionReasons: []
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
  history: ReviewHistory
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

// ---------------------------------------------------------------------------
// Prompt fragments — one place that turns settings into instructions
// ---------------------------------------------------------------------------

const list = (values?: string[] | null) =>
  (values || []).filter(Boolean).join(', ')

/** Free text saved from a textarea, one item per line, as an indented block. */
const multiline = (text: string, indent: string) =>
  text.replace(/\r\n?/g, '\n').trim().replace(/\n+/g, `\n${indent}`)

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
        parts.push(`  Details: ${multiline(details, '    ')}`)
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

/**
 * The column default. No form sets sophistication, so every audience carries
 * it; stating it told the model that consumers and executives alike were
 * "practitioners". Only a value someone actually chose is rendered.
 */
const DEFAULT_SOPHISTICATION = 'practitioner'

const sophisticationOf = (a: Audience) =>
  a.sophisticationLevel && a.sophisticationLevel !== DEFAULT_SOPHISTICATION
    ? a.sophisticationLevel
    : null

/** The structured details saved on an audience row, one per line. */
function audienceDetails(a: Audience): string[] {
  const lines: string[] = []
  const titles = list(a.jobTitles)
  if (titles) lines.push(`Job titles: ${titles}`)
  const seniority = list(a.seniority)
  if (seniority) lines.push(`Seniority: ${seniority}`)
  const industries = list(a.industries)
  if (industries) lines.push(`Industries: ${industries}`)
  const pains = list(a.painPoints)
  if (pains) lines.push(`Pain points: ${pains}`)
  const desires = list(a.desires)
  if (desires) lines.push(`Desires: ${desires}`)
  const objections = list(a.objections)
  if (objections) lines.push(`Objections: ${objections}`)
  if (a.whatTheyDontBelieveYet) {
    lines.push(
      `Belief to move (aim the post at this, not at the topic): ${a.whatTheyDontBelieveYet}`
    )
  }
  return lines
}

export function renderAudienceBlock(ctx: GenerationContext): string {
  if (ctx.audiences.length === 0) return 'Audience: not yet defined.'

  return ctx.audiences
    .map(a => {
      const level = sophisticationOf(a)
      // The profile saves the whole target-audience text as the name.
      const lines = [
        `- ${multiline(a.name, '  ')}${level ? ` (sophistication: ${level})` : ''}`
      ]
      for (const detail of audienceDetails(a)) lines.push(`  ${detail}`)
      return lines.join('\n')
    })
    .join('\n')
}

/** One reader group an idea can be written for. */
export interface AudienceSegment {
  /** The group in the profile's own words. */
  label: string
  /** Details saved on its audience row, if any. */
  details: string[]
}

/** More groups than this is a paragraph split wrongly, not a list. */
const MAX_AUDIENCE_SEGMENTS = 8
/** Lines, semicolons and inline bullets separate groups; commas do not. */
const SEGMENT_BREAK = /\r?\n|;|\s+[•|]\s+/
const LIST_MARKER = /^\s*(?:[-*•–]|\d+[.)])\s*/

/**
 * The reader groups in the account's audiences. The profile saves its whole
 * target-audience text as one row, one group per line, and ideation used to
 * show it as a single audience: a run for a brand selling to consumers and to
 * IT buyers wrote ideas aimed at both at once. Header lines such as "Primary
 * audiences:" introduce groups rather than name one.
 */
export function audienceSegments(
  ctx: Pick<GenerationContext, 'audiences'>
): AudienceSegment[] {
  const segments: AudienceSegment[] = []
  const seen = new Set<string>()
  for (const a of ctx.audiences) {
    const level = sophisticationOf(a)
    const details = [
      ...(level ? [`Sophistication: ${level}`] : []),
      ...audienceDetails(a)
    ]
    for (const part of a.name.split(SEGMENT_BREAK)) {
      const label = part.replace(LIST_MARKER, '').trim().replace(/[.,]+$/, '')
      if (!label || label.endsWith(':') || seen.has(label.toLowerCase())) continue
      seen.add(label.toLowerCase())
      segments.push({ label, details })
    }
  }
  return segments.slice(0, MAX_AUDIENCE_SEGMENTS)
}

/** The groups as ideation shows them, each with the label an idea cites. */
export function renderAudienceSegmentsBlock(segments: AudienceSegment[]): string {
  if (segments.length === 0) return 'Audience: not yet defined.'
  return segments
    .map((s, i) =>
      [`[A${i + 1}] ${s.label}`, ...s.details.map(d => `    ${d}`)].join('\n')
    )
    .join('\n')
}

/**
 * An idea's takeaway as saved, led by the reader group it was written for.
 * Ideas have no column for the group; here the reviewer sees it on the card
 * and the drafting brief reads it as the reader to write for.
 */
export function withReaderGroup(takeaway: string, group?: string): string {
  const text = takeaway.trim()
  return group ? `For ${group}: ${text}` : text
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

/** Closing asks of the account's latest posts, newest first, without repeats. */
export function recentCtasOf(ctx: GenerationContext, limit = 6): string[] {
  return unique(
    ctx.history.drafts.map(d => d.cta?.trim() || '').filter(Boolean)
  ).slice(0, limit)
}

/**
 * The closing ask. Without the goal's action the model fell back to the same
 * "we would be glad to hear how you approach it" on every post, and an offer
 * the goal never names (a call, an audit, a template) is a promise the author
 * did not make. With it, every post ended on the same offer, so a feed of the
 * author's posts read as one advert: the goal's action is now used where it
 * follows from the post, and the recent asks are shown so this one differs.
 */
export function describeCta(ctx: GenerationContext): string {
  const action = ctx.primaryGoal?.desiredAction?.trim()
  const recent = recentCtasOf(ctx)
  return [
    ctx.prefs.constraints.cta_required
      ? 'required.'
      : 'optional; leave it empty when no ask follows naturally from the post.',
    action
      ? `Steer the reader toward: ${action}. Name it only when this post's argument leads to it; otherwise ask a question the reader can answer from their own work. Never use the same sentence as an earlier post.`
      : "Ask for something this reader can do or answer from their own work, and that follows from this post's argument.",
    'It is an ask, not a summary of the post. Never a generic "Thoughts?", "Agree?" or "What do you think?".',
    `Offer nothing the goal does not name: no call, demo, audit, download, template or DM offer${action ? ' beyond the action above' : ''}.`,
    recent.length > 0
      ? `Recent posts already ended with these asks, so do not repeat their wording or shape:\n${bullets(recent.map(r => `"${r}"`))}`
      : ''
  ]
    .filter(Boolean)
    .join(' ')
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

// ---------------------------------------------------------------------------
// Review history — what the reviewer already saw, approved and turned down
// ---------------------------------------------------------------------------

const unique = (values: string[]) =>
  Array.from(new Set(values.map(v => v.trim()).filter(Boolean)))

const bullets = (values: string[]) => values.map(v => `- ${v}`).join('\n')

/**
 * Earlier work, for ideation: angles already covered, ideas the reviewer
 * rejected, and what they said when rejecting. `currentRunId` leaves out the
 * run being generated, so a rerun does not treat its own ideas as history.
 */
export function renderIdeationHistoryBlock(
  ctx: GenerationContext,
  currentRunId?: string | null
): string {
  const earlier = ctx.history.ideas.filter(
    i => !currentRunId || i.runId !== currentRunId
  )
  const covered = unique([
    ...ctx.history.drafts.slice(0, 12).map(d => d.hook),
    // A drafted idea is already covered by its post's hook above.
    ...earlier
      .filter(i => i.status !== 'rejected' && i.status !== 'drafted')
      .slice(0, 15)
      .map(i => i.title)
  ])
  const rejected = unique(
    earlier
      .filter(i => i.status === 'rejected')
      .slice(0, 10)
      .map(i => i.title)
  )
  const reasons = unique(ctx.history.rejectionReasons).slice(0, 6)

  const sections: string[] = []
  if (covered.length > 0) {
    sections.push(
      `ALREADY COVERED FOR THIS ACCOUNT (drafted or awaiting review) — do not repeat these angles:\n${bullets(covered)}`
    )
  }
  if (rejected.length > 0) {
    sections.push(
      `IDEAS THE REVIEWER REJECTED — do not propose these again, and steer away from what they have in common:\n${bullets(rejected)}`
    )
  }
  if (reasons.length > 0) {
    sections.push(
      `WHAT THE REVIEWER SAID WHEN REJECTING EARLIER WORK — apply it:\n${bullets(reasons.map(r => `"${r}"`))}`
    )
  }
  return sections.join('\n\n')
}

/**
 * The reviewer's corrections, for drafting: why posts were rejected and how
 * they rewrote the model's hooks. Only human actions change it, so the
 * drafting instructions stay cacheable across a run.
 */
export function renderReviewerFeedbackBlock(ctx: GenerationContext): string {
  const lines = unique(ctx.history.rejectionReasons)
    .slice(0, 5)
    .map(r => `- Rejected earlier work because: "${r}"`)

  const hookEdits = ctx.history.drafts
    .filter(d => d.originalHook.trim() && d.hook.trim() !== d.originalHook.trim())
    .slice(0, 3)
  for (const d of hookEdits) {
    lines.push(`- Rewrote the hook "${d.originalHook.trim()}" as "${d.hook.trim()}"`)
  }
  return lines.join('\n')
}

/**
 * Who posts and who reads, for the image brief. Without it every account got
 * the same dark technical diagram whatever its field or audience.
 */
export function renderMediaContext(ctx: GenerationContext): string {
  const a = ctx.account
  const org = a.company && a.company !== a.name ? ` (${a.company})` : ''
  const lines = [
    `Posted by: ${a.name}${org}, ${a.accountType === 'company' ? 'a company page' : 'a person'}`
  ]
  if (a.industry) lines.push(`Industry: ${a.industry}`)
  const audiences = ctx.audiences
    .map(x => x.name.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (audiences.length > 0) {
    lines.push(`Seen by: ${audiences.join('; ').slice(0, 400)}`)
  }
  return lines.join('\n')
}
