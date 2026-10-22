import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  vector
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { ACTIVE_RUN_STATUSES } from '../lib/run-status'
import { authUsersTable } from './auth-schema'

export * from './auth-schema'

// ---------------------------------------------------------------------------
// Shared field helpers
// ---------------------------------------------------------------------------

export const commonFieldDefs = {
  id: () => uuid('id').defaultRandom().primaryKey(),
  date: (name: string) =>
    timestamp(name, {
      mode: 'date',
      withTimezone: true
    }),
  dates: {
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true
    })
      .notNull()
      .defaultNow()
  }
}

// ---------------------------------------------------------------------------
// 1. Accounts — persona/profile identity
// ---------------------------------------------------------------------------

export const accountsTable = pgTable('accounts', {
  id: commonFieldDefs.id(),
  // The signed-in user who owns this identity; each user has at most one.
  // Null only for identities made before sign-in existed: those are hidden
  // from everyone until they are assigned to their owner
  // (docs/AUTHENTICATION.md, "Legacy identities"). Postgres allows any number
  // of nulls under the unique constraint.
  userId: uuid('user_id')
    .unique()
    .references(() => authUsersTable.id, {
      onDelete: 'cascade'
    }),
  name: text('name').notNull(),
  handle: text('handle').notNull(),
  headline: text('headline').notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  accountType: varchar('account_type', { length: 20 })
    .default('personal')
    .notNull(),
  company: text('company'),
  websiteUrl: text('website_url'),
  linkedinUrl: text('linkedin_url'),
  industry: text('industry'),
  // No longer read or written: identities used to be deactivatable. The
  // migration that dropped the feature disabled the schedules of the ones
  // that were off.
  isActive: boolean('is_active').default(true).notNull(),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 2. Voice Configs (1:1 with Account) — tone, style, banned words
// ---------------------------------------------------------------------------

// The voice is now the rubric plus the settings below. These older columns are
// no longer read or written but still exist in the database: warmth, humor,
// energy, story_vs_data, sentence_length, paragraph_style,
// reading_level_target, signature_phrases, opening_styles, closing_styles and
// rules. The migration that drops them must first append
// signature_phrases, opening_styles, closing_styles and rules (the writing
// patterns) to derived_style_rubric, or saved profiles lose that detail.
export const voiceConfigsTable = pgTable('voice_configs', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  tone: varchar('tone', { length: 50 }).default('candid').notNull(),
  perspective: varchar('perspective', { length: 30 }).default('I').notNull(),
  formality: integer('formality').default(3).notNull(),
  directness: integer('directness').default(4).notNull(),
  // Emoji and hashtags live here, not in preferences; resolvePreferences reads them.
  emojiPolicy: varchar('emoji_policy', { length: 30 })
    .default('none')
    .notNull(),
  hashtagPolicy: varchar('hashtag_policy', { length: 100 })
    .default('0-3, end of post')
    .notNull(),
  bannedWords: jsonb('banned_words').$type<string[]>().default([]),
  derivedStyleRubric: text('derived_style_rubric'),
  rawSamplesText: text('raw_samples_text'),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 3. Offerings (1:N with Account) — products, services, lead magnets
// ---------------------------------------------------------------------------

export const offeringsTable = pgTable('offerings', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: varchar('type', { length: 30 }).default('service').notNull(),
  tagline: text('tagline'),
  description: text('description'),
  whoItIsFor: text('who_it_is_for'),
  problemSolved: text('problem_solved'),
  keyFeatures: jsonb('key_features').$type<string[]>().default([]),
  differentiators: jsonb('differentiators').$type<string[]>().default([]),
  pricingNote: text('pricing_note'),
  // Real metrics, named customers, case studies. Without a stocked list of true,
  // specific numbers the model invents plausible ones.
  proofPoints: jsonb('proof_points')
    .$type<Array<{ label: string; detail?: string; sourceUrl?: string }>>()
    .default([]),
  url: text('url'),
  isActive: boolean('is_active').default(true).notNull(),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 4. Sample Posts (1:N with Account) — few-shot exemplars for the prompt
// ---------------------------------------------------------------------------

export const samplePostsTable = pgTable('sample_posts', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  performedWell: boolean('performed_well').default(false).notNull(),
  engagementNote: text('engagement_note'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow()
})

// ---------------------------------------------------------------------------
// 5. Audiences (1:N with Account) — target reader profiles
// ---------------------------------------------------------------------------

export const audiencesTable = pgTable('audiences', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  jobTitles: jsonb('job_titles').$type<string[]>().default([]),
  seniority: jsonb('seniority').$type<string[]>().default([]),
  industries: jsonb('industries').$type<string[]>().default([]),
  companySize: text('company_size'),
  geography: text('geography'),
  painPoints: jsonb('pain_points').$type<string[]>().default([]),
  goals: jsonb('goals').$type<string[]>().default([]),
  desires: jsonb('desires').$type<string[]>().default([]),
  objections: jsonb('objections').$type<string[]>().default([]),
  // Controls jargon density: "RAG pipeline" loses novices and insults experts.
  sophisticationLevel: varchar('sophistication_level', { length: 20 })
    .default('practitioner')
    .notNull(),
  // The belief the content has to move. Posts aimed at a belief beat posts aimed at a topic.
  whatTheyDontBelieveYet: text('what_they_dont_believe_yet'),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 6. Knowledge Documents (1:N with Account) — grounded fact base
// ---------------------------------------------------------------------------

export const knowledgeDocumentsTable = pgTable('knowledge_documents', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  sourceType: varchar('source_type', { length: 20 }).notNull(),
  sourceUrl: text('source_url'),
  content: text('content').notNull(),
  author: text('author'),
  publishedAt: commonFieldDefs.date('published_at'),
  wordCount: integer('word_count').default(0).notNull(),
  summary: text('summary'),
  topics: jsonb('topics').$type<string[]>().default([]),
  // The grounding layer: a draft's assertion points at a claim, which points at
  // a verbatim quote, which points at a URL.
  keyClaims: jsonb('key_claims')
    .$type<Array<{ claim: string; quote: string; confidence?: number }>>()
    .default([]),
  ...commonFieldDefs.dates
},
  table => [
    index('knowledge_documents_account_idx').on(table.accountId)
  ]
)

// ---------------------------------------------------------------------------
// 6b. Document Chunks (1:N with Knowledge Documents) — embeddings for retrieval
// ---------------------------------------------------------------------------

/** Must match the output size of `EMBEDDING_MODEL_ID` in `~/lib/ai`. */
export const EMBEDDING_DIMENSIONS = 1536

export const documentChunksTable = pgTable(
  'document_chunks',
  {
    id: commonFieldDefs.id(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocumentsTable.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accountsTable.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', {
      dimensions: EMBEDDING_DIMENSIONS
    }).notNull(),
    embeddingModel: varchar('embedding_model', { length: 100 }).notNull(),
    createdAt: commonFieldDefs.dates.createdAt
  },
  table => [
    index('document_chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
    index('document_chunks_account_idx').on(table.accountId),
    uniqueIndex('document_chunks_document_chunk_uq').on(
      table.documentId,
      table.chunkIndex
    )
  ]
)

// ---------------------------------------------------------------------------
// 7. Goals (1:N with Account) — campaign objectives
// ---------------------------------------------------------------------------

export const goalsTable = pgTable('goals', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  objective: varchar('objective', { length: 30 })
    .default('thought_leadership')
    .notNull(),
  // The single thing every post under this goal has to land.
  keyMessage: text('key_message'),
  desiredAction: text('desired_action'),
  targetUrl: text('target_url'),
  // Where targetUrl (and any other link) goes: the first comment protects reach.
  linkStrategy: varchar('link_strategy', { length: 20 })
    .$type<'body' | 'first_comment'>()
    .default('first_comment')
    .notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  ...commonFieldDefs.dates
},
  table => [
    index('goals_account_idx').on(table.accountId)
  ]
)

/** What an idea keeps of its goal; see ideas.goalSnapshot. */
export type GoalSnapshot = {
  title: string
  objective: string
  keyMessage: string | null
  desiredAction: string | null
  targetUrl: string | null
  linkStrategy: 'body' | 'first_comment'
}

// ---------------------------------------------------------------------------
// 8. Preferences (1:1 with Account) — what to write about and how
// ---------------------------------------------------------------------------

/**
 * Legacy: content pillars, replaced by goals. Nothing reads or writes them
 * any more; the type stays so the rows accounts saved still type-check.
 */
export type ContentPillar = {
  name: string
  weight_pct: number
  example_topics?: string[]
}

/**
 * Only choices that Voice and Goals do not already cover. Emoji, hashtags and
 * banned words come from the voice config, link placement from the goal next
 * to its link; post length, research and image defaults are fixed in
 * `src/lib/ai/context.ts`.
 */
export type PostConstraints = {
  cta_required: boolean
}

export type Guardrails = {
  banned_topics: string[]
  compliance_notes: string
}

export const preferencesTable = pgTable('preferences', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  // Legacy (see ContentPillar): kept so saved pillars are not lost.
  pillars: jsonb('pillars').$type<ContentPillar[]>().default([]),
  ideasPerRun: integer('ideas_per_run').default(5).notNull(),
  postConstraints: jsonb('post_constraints').$type<PostConstraints | null>(),
  guardrails: jsonb('guardrails').$type<Guardrails | null>(),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 9. Runs (1:N with Account) — pipeline execution lifecycle
// ---------------------------------------------------------------------------

export const runsTable = pgTable(
  'runs',
  {
    id: commonFieldDefs.id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accountsTable.id, { onDelete: 'cascade' }),
    // The first of goalIds, for runs read by code that knows one goal.
    goalId: uuid('goal_id').references(() => goalsTable.id, {
      onDelete: 'set null'
    }),
    // The goals picked for this run, in the order they were listed. Ideation
    // sees these and no others.
    goalIds: jsonb('goal_ids').$type<string[]>().default([]),
    preferenceSetId: uuid('preference_set_id').references(
      () => preferencesTable.id,
      {
        onDelete: 'set null'
      }
    ),
    workflow: varchar('workflow', { length: 30 }).default('standard').notNull(),
    trigger: varchar('trigger', { length: 20 }).default('manual').notNull(),
    status: varchar('status', { length: 30 }).default('queued').notNull(),
    currentStep: integer('current_step').default(0).notNull(),
    totalSteps: integer('total_steps').default(3).notNull(),
    researchConfig: jsonb('research_config')
      .$type<Record<string, any>>()
      .default({}),
    mediaConfig: jsonb('media_config').$type<Record<string, any>>().default({}),
    timings: jsonb('timings').$type<Record<string, number>>().default({}),
    // Summed from run_steps by refreshRunTotals; see src/lib/ai/usage.ts.
    tokenCounts: jsonb('token_counts')
      .$type<{
        calls?: number
        inputTokens?: number
        noCacheInputTokens?: number
        outputTokens?: number
        reasoningTokens?: number
        totalTokens?: number
        cacheReadTokens?: number
        cacheWriteTokens?: number
        costUsd?: number
        billedCalls?: number
        estimatedCalls?: number
      }>()
      .default({}),
    costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).default('0'),
    model: varchar('model', { length: 100 }).default('claude-opus-5'),
    logs: jsonb('logs')
      .$type<
        Array<{
          step: string
          status: string
          timestamp?: string
          message?: string
        }>
      >()
      .default([]),
    error: text('error'),
    ...commonFieldDefs.dates
  },
  table => [
    index('runs_account_created_idx').on(table.accountId, table.createdAt),
    index('runs_status_created_idx').on(table.status, table.createdAt),
    // One run in progress per identity: two at once research the same ground
    // and come back with near-identical ideas. enqueueRun checks first; this
    // catches anything that slips past it.
    uniqueIndex('runs_one_active_per_account_uq')
      .on(table.accountId)
      .where(
        sql.raw(
          `status in (${ACTIVE_RUN_STATUSES.map(s => `'${s}'`).join(', ')})`
        )
      )
  ]
)

// ---------------------------------------------------------------------------
// 9b. Run Steps (1:N with Run) — per-stage progress and observability
// ---------------------------------------------------------------------------

export const runStepsTable = pgTable('run_steps', {
  id: commonFieldDefs.id(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runsTable.id, { onDelete: 'cascade' }),
  stage: varchar('stage', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  startedAt: commonFieldDefs.date('started_at'),
  completedAt: commonFieldDefs.date('completed_at'),
  durationMs: integer('duration_ms'),
  requestSummary: text('request_summary'),
  responseJson: jsonb('response_json').$type<any>(),
  tokens: integer('tokens').default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }).default('0'),
  error: text('error'),
  ...commonFieldDefs.dates
},
  table => [
    index('run_steps_run_idx').on(table.runId)
  ]
)

// ---------------------------------------------------------------------------
// 9c. Research Findings (1:N with Run) — grounded research harvested during runs
// ---------------------------------------------------------------------------

export const researchFindingsTable = pgTable('research_findings', {
  id: commonFieldDefs.id(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runsTable.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title'),
  snippet: text('snippet'),
  publishedAt: text('published_at'),
  provider: varchar('provider', { length: 50 }).default('web_search'),
  retrievedAt: commonFieldDefs.date('retrieved_at').defaultNow(),
  ...commonFieldDefs.dates
},
  table => [
    index('research_findings_run_idx').on(table.runId)
  ]
)

// ---------------------------------------------------------------------------
// 10. Ideas (1:N with Account, Run) — the human approval gate
// ---------------------------------------------------------------------------

export const ideasTable = pgTable('ideas', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runsTable.id, {
    onDelete: 'set null'
  }),
  // The main goal this idea serves: it decides the post's call to action
  // and link.
  goalId: uuid('goal_id').references(() => goalsTable.id, {
    onDelete: 'set null'
  }),
  // Every goal picked for its run that the idea serves, the main one first.
  // Ids stay here after a goal is deleted; only the main goal is snapshotted.
  goalIds: jsonb('goal_ids').$type<string[]>().default([]).notNull(),
  // That goal as it was when the idea was made. Drafting uses the live goal,
  // and this only once the goal is deleted, so the post still lands the
  // message its idea was made for.
  goalSnapshot: jsonb('goal_snapshot').$type<GoalSnapshot | null>(),
  offeringId: uuid('offering_id').references(() => offeringsTable.id, {
    onDelete: 'set null'
  }),
  title: text('title').default(''),
  hook: text('hook').notNull(),
  angle: text('angle'),
  // Legacy: the content pillar of ideas made before goals replaced pillars.
  pillar: text('pillar'),
  format: varchar('format', { length: 50 }).default('thought_leadership'),
  thesis: text('thesis'),
  perspectiveAngle: varchar('perspective_angle', { length: 100 }),
  whyNow: text('why_now'),
  hookConcept: text('hook_concept'),
  coreArgument: text('core_argument'),
  audienceTakeaway: text('audience_takeaway'),
  supportingEvidence: jsonb('supporting_evidence')
    .$type<
      Array<{
        claim: string
        factType?: 'verified' | 'sourced' | 'inferred' | 'unsupported'
        sourceId?: string
        sourceUrl?: string
        sourceTitle?: string
        quote?: string
        publishedAt?: string
        confidence?: number
      }>
    >()
    .default([]),
  suggestedMedia: jsonb('suggested_media')
    .$type<{
      mode: 'ai_generated' | 'stock' | 'none'
      brief?: string
    }>()
    .default({ mode: 'none' }),
  noveltyNote: text('novelty_note'),
  score: integer('score').default(80).notNull(),
  groundingScore: integer('grounding_score').default(80).notNull(),
  originalityScore: integer('originality_score').default(80).notNull(),
  unsupportedClaims: jsonb('unsupported_claims').$type<string[]>().default([]),
  sourceIds: jsonb('source_ids').$type<string[]>().default([]),
  risks: jsonb('risks').$type<string[]>().default([]),
  status: varchar('status', { length: 20 }).default('proposed').notNull(),
  ...commonFieldDefs.dates
},
  table => [
    index('ideas_account_created_idx').on(table.accountId, table.createdAt),
    index('ideas_run_idx').on(table.runId)
  ]
)

// ---------------------------------------------------------------------------
// 11. Post Drafts (1:N with Account) — final copy for review and copy-out
// ---------------------------------------------------------------------------

export const postDraftsTable = pgTable('post_drafts', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  ideaId: uuid('idea_id').references(() => ideasTable.id, {
    onDelete: 'set null'
  }),
  offeringId: uuid('offering_id').references(() => offeringsTable.id, {
    onDelete: 'set null'
  }),
  hook: text('hook').notNull(),
  body: text('body').notNull(),
  // The AI's output as generated. `hook` and `body` are edited in place during
  // review; these never change, so a reviewer's final version can be compared
  // against what the model actually wrote.
  originalHook: text('original_hook').notNull(),
  originalBody: text('original_body').notNull(),
  cta: text('cta'),
  firstComment: text('first_comment'),
  hashtags: jsonb('hashtags').$type<string[]>().default([]),
  format: varchar('format', { length: 50 }).default('thought_leadership'),
  charCount: integer('char_count').default(0).notNull(),
  selfScores: jsonb('self_scores')
    .$type<{
      hookStrength?: number
      onBrand?: number
      clarity?: number
      evidenceGrounding?: number
      originality?: number
    }>()
    .default({}),
  selfFlags: jsonb('self_flags').$type<string[]>().default([]),
  lintFindings: jsonb('lint_findings')
    .$type<
      Array<{
        rule: string
        severity: 'error' | 'warning' | 'info'
        message: string
        passed: boolean
      }>
    >()
    .default([]),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  editedBody: text('edited_body'),
  approvedAt: commonFieldDefs.date('approved_at'),
  // The day the reviewer plans to publish it, set on the Schedule page.
  // Nothing is published automatically: the reviewer posts it on LinkedIn
  // and then marks it posted, which sets postedAt.
  plannedFor: date('planned_for', { mode: 'string' }),
  postedAt: commonFieldDefs.date('posted_at'),
  ...commonFieldDefs.dates
},
  table => [
    index('post_drafts_account_created_idx').on(table.accountId, table.createdAt),
    index('post_drafts_idea_idx').on(table.ideaId),
    index('post_drafts_account_planned_idx').on(table.accountId, table.plannedFor)
  ]
)

// ---------------------------------------------------------------------------
// 12. Post Variants (1:N with PostDraft) — alternative hooks and body takes
// ---------------------------------------------------------------------------

export const postVariantsTable = pgTable('post_variants', {
  id: commonFieldDefs.id(),
  draftId: uuid('draft_id')
    .notNull()
    .references(() => postDraftsTable.id, { onDelete: 'cascade' }),
  variantType: varchar('variant_type', { length: 20 }).notNull(), // 'hook' | 'body'
  content: text('content').notNull(),
  ...commonFieldDefs.dates
},
  table => [
    index('post_variants_draft_idx').on(table.draftId)
  ]
)

// ---------------------------------------------------------------------------
// 13. Post Citations (1:N with PostDraft) — grounded source links per draft
// ---------------------------------------------------------------------------

export const postCitationsTable = pgTable('post_citations', {
  id: commonFieldDefs.id(),
  draftId: uuid('draft_id')
    .notNull()
    .references(() => postDraftsTable.id, { onDelete: 'cascade' }),
  claim: text('claim').notNull(),
  quote: text('quote'),
  sourceUrl: text('source_url'),
  sourceTitle: text('source_title'),
  ...commonFieldDefs.dates
},
  table => [
    index('post_citations_draft_idx').on(table.draftId)
  ]
)

// ---------------------------------------------------------------------------
// 14. Post Media (1:1 / 1:N with PostDraft) — image briefs, stock candidates & assets
// ---------------------------------------------------------------------------

export const postMediaTable = pgTable('post_media', {
  id: commonFieldDefs.id(),
  draftId: uuid('draft_id')
    .notNull()
    .references(() => postDraftsTable.id, { onDelete: 'cascade' }),
  version: integer('version').default(1).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(), // 'active' | 'superseded' | 'rejected'
  previousMediaId: uuid('previous_media_id'),
  regenerationAttempt: integer('regeneration_attempt').default(0).notNull(),
  rejectionReason: text('rejection_reason'),
  mode: varchar('mode', { length: 20 }).notNull(), // 'ai_generated' | 'stock' | 'none'
  imageUrl: text('image_url'),
  // The generated image before the brand logo was laid over it; null when no
  // logo was added. "Use current image" edits this one, so an edit model
  // never redraws (and misdraws) the logo. Never selected for lists.
  baseImageUrl: text('base_image_url'),
  altText: text('alt_text'),
  promptOrQuery: text('prompt_or_query'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  ...commonFieldDefs.dates
},
  table => [
    index('post_media_draft_status_idx').on(table.draftId, table.status)
  ]
)

// ---------------------------------------------------------------------------
// 15. Schedules (1:1 with Account) — when automatic runs fire
// ---------------------------------------------------------------------------

export const schedulesTable = pgTable('schedules', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  daysOfWeek: jsonb('days_of_week').$type<number[]>().default([1, 3, 5]),
  timeOfDay: varchar('time_of_day', { length: 10 }).default('09:00').notNull(),
  // IANA zone the days and time are read in; null is the server's zone, for
  // schedules saved before zones were stored.
  timezone: varchar('timezone', { length: 64 }),
  // The goals each chosen day's run serves, by weekday (0 is Sunday). A day
  // with no entry, or null here, serves every active goal.
  dayGoals: jsonb('day_goals').$type<Record<string, string[]> | null>(),
  enabled: boolean('enabled').default(false).notNull(),
  lastRunAt: commonFieldDefs.date('last_run_at'),
  // Why the last scheduled run did not start; null after one that did.
  lastError: text('last_error'),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 16. Feedback (1:N with Account) — compounding asset from reviews & edits
// ---------------------------------------------------------------------------

export const feedbackTable = pgTable('feedback', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  draftId: uuid('draft_id').references(() => postDraftsTable.id, {
    onDelete: 'set null'
  }),
  verdict: varchar('verdict', { length: 20 }).notNull(), // 'approved' | 'rejected' | 'edited'
  reasonTags: jsonb('reason_tags').$type<string[]>().default([]),
  reasonText: text('reason_text'),
  originalBody: text('original_body'),
  finalBody: text('final_body'),
  editDistance: integer('edit_distance').default(0),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 17. Brand Themes (1:1 with Account) — how generated images look
// ---------------------------------------------------------------------------

export const brandThemesTable = pgTable('brand_themes', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  // A PNG data URL, re-encoded on upload. Placed on every generated image by
  // the canvas renderer, never described to the image model.
  logoImage: text('logo_image'),
  // Whether the logo goes on images at all.
  showLogo: boolean('show_logo').default(true).notNull(),
  // Lower-case #rrggbb; see src/lib/brand/theme.ts. The background must be
  // light: every image is laid out on it.
  primaryColor: text('primary_color'),
  accentColor: text('accent_color'),
  backgroundColor: text('background_color'),
  // Google Fonts families from FONT_CHOICES (src/lib/brand/fonts.ts).
  headingFont: text('heading_font'),
  bodyFont: text('body_font'),
  // 'auto' | 'diagram' | 'illustration': what fills the image's right side.
  visualStyle: varchar('visual_style', { length: 20 }).default('auto').notNull(),
  // 'dots' | 'grid' | 'plain'
  backgroundPattern: varchar('background_pattern', { length: 20 })
    .default('dots')
    .notNull(),
  // The website or handle on images; none when empty.
  footerText: text('footer_text'),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// Convenience aliases
// ---------------------------------------------------------------------------

export const accounts = accountsTable
export const voiceConfigs = voiceConfigsTable
export const offerings = offeringsTable
export const samplePosts = samplePostsTable
export const audiences = audiencesTable
export const knowledgeDocuments = knowledgeDocumentsTable
export const goals = goalsTable
export const preferences = preferencesTable
export const runs = runsTable
export const runSteps = runStepsTable
export const researchFindings = researchFindingsTable
export const ideas = ideasTable
export const postDrafts = postDraftsTable
export const postVariants = postVariantsTable
export const postCitations = postCitationsTable
export const postMedia = postMediaTable
export const schedules = schedulesTable
export const feedback = feedbackTable

// Backward-compatible aliases
export const draftsTable = postDraftsTable
export const drafts = postDraftsTable

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type Account = typeof accountsTable.$inferSelect
export type NewAccount = typeof accountsTable.$inferInsert

export type VoiceConfig = typeof voiceConfigsTable.$inferSelect
export type NewVoiceConfig = typeof voiceConfigsTable.$inferInsert

export type Offering = typeof offeringsTable.$inferSelect
export type NewOffering = typeof offeringsTable.$inferInsert

export type SamplePost = typeof samplePostsTable.$inferSelect
export type NewSamplePost = typeof samplePostsTable.$inferInsert

export type Audience = typeof audiencesTable.$inferSelect
export type NewAudience = typeof audiencesTable.$inferInsert

export type KnowledgeDocument = typeof knowledgeDocumentsTable.$inferSelect
export type NewKnowledgeDocument = typeof knowledgeDocumentsTable.$inferInsert

export type DocumentChunk = typeof documentChunksTable.$inferSelect
export type NewDocumentChunk = typeof documentChunksTable.$inferInsert

export type Goal = typeof goalsTable.$inferSelect
export type NewGoal = typeof goalsTable.$inferInsert

export type Preference = typeof preferencesTable.$inferSelect
export type NewPreference = typeof preferencesTable.$inferInsert

export type Run = typeof runsTable.$inferSelect
export type NewRun = typeof runsTable.$inferInsert

export type RunStep = typeof runStepsTable.$inferSelect
export type NewRunStep = typeof runStepsTable.$inferInsert

export type ResearchFinding = typeof researchFindingsTable.$inferSelect
export type NewResearchFinding = typeof researchFindingsTable.$inferInsert

export type Idea = typeof ideasTable.$inferSelect
export type NewIdea = typeof ideasTable.$inferInsert

export type PostDraft = typeof postDraftsTable.$inferSelect
export type NewPostDraft = typeof postDraftsTable.$inferInsert
export type Draft = PostDraft

export type PostVariant = typeof postVariantsTable.$inferSelect
export type NewPostVariant = typeof postVariantsTable.$inferInsert

export type PostCitation = typeof postCitationsTable.$inferSelect
export type NewPostCitation = typeof postCitationsTable.$inferInsert

export type PostMedia = typeof postMediaTable.$inferSelect
export type NewPostMedia = typeof postMediaTable.$inferInsert

export type Schedule = typeof schedulesTable.$inferSelect
export type NewSchedule = typeof schedulesTable.$inferInsert

export type Feedback = typeof feedbackTable.$inferSelect
export type NewFeedback = typeof feedbackTable.$inferInsert

export type BrandTheme = typeof brandThemesTable.$inferSelect
export type NewBrandTheme = typeof brandThemesTable.$inferInsert
