import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'

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
  name: text('name').notNull(),
  handle: text('handle').notNull().unique(),
  headline: text('headline').notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  accountType: varchar('account_type', { length: 20 })
    .default('personal')
    .notNull(),
  company: text('company'),
  websiteUrl: text('website_url'),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 2. Voice Configs (1:1 with Account) — tone, style, banned words
// ---------------------------------------------------------------------------

export const voiceConfigsTable = pgTable('voice_configs', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  tone: varchar('tone', { length: 50 }).default('candid').notNull(),
  perspective: varchar('perspective', { length: 30 }).default('I').notNull(),
  formality: integer('formality').default(3).notNull(),
  warmth: integer('warmth').default(3).notNull(),
  directness: integer('directness').default(4).notNull(),
  humor: varchar('humor', { length: 30 }).default('dry').notNull(),
  energy: varchar('energy', { length: 30 }).default('measured').notNull(),
  storyVsData: integer('story_vs_data').default(3).notNull(),
  emojiPolicy: varchar('emoji_policy', { length: 30 })
    .default('none')
    .notNull(),
  hashtagPolicy: varchar('hashtag_policy', { length: 100 })
    .default('0-3, end of post')
    .notNull(),
  sentenceLength: varchar('sentence_length', { length: 30 })
    .default('short')
    .notNull(),
  paragraphStyle: varchar('paragraph_style', { length: 50 })
    .default('short paras')
    .notNull(),
  readingLevelTarget: varchar('reading_level_target', { length: 50 })
    .default('grade 7-9')
    .notNull(),
  bannedWords: jsonb('banned_words')
    .$type<string[]>()
    .default([
      'delve',
      'leverage',
      'unlock',
      'game-changer',
      'fast-paced world',
      'thrilled to announce'
    ]),
  signaturePhrases: jsonb('signature_phrases').$type<string[]>().default([]),
  openingStyles: jsonb('opening_styles')
    .$type<string[]>()
    .default(['concrete scene', 'bold claim', 'question']),
  closingStyles: jsonb('closing_styles')
    .$type<string[]>()
    .default(['question CTA', 'soft takeaway']),
  derivedStyleRubric: text('derived_style_rubric'),
  rawSamplesText: text('raw_samples_text'),
  rules: text('rules'),
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
  painPoints: jsonb('pain_points').$type<string[]>().default([]),
  goals: jsonb('goals').$type<string[]>().default([]),
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
  summary: text('summary'),
  ...commonFieldDefs.dates
})

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
  targetCount: integer('target_count').default(5).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 8. Preferences (1:1 with Account) — cadence and content pillars
// ---------------------------------------------------------------------------

export const preferencesTable = pgTable('preferences', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  postsPerWeek: integer('posts_per_week').default(3).notNull(),
  pillars: jsonb('pillars')
    .$type<Array<{ name: string; weight: number }>>()
    .default([]),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 9. Runs (1:N with Account) — pipeline execution lifecycle
// ---------------------------------------------------------------------------

export const runsTable = pgTable('runs', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id').references(() => goalsTable.id, {
    onDelete: 'set null'
  }),
  workflow: varchar('workflow', { length: 30 }).notNull(),
  status: varchar('status', { length: 30 }).default('pending').notNull(),
  currentStep: integer('current_step').default(0).notNull(),
  totalSteps: integer('total_steps').default(3).notNull(),
  logs: jsonb('logs')
    .$type<Array<{ step: string; status: string; timestamp?: string }>>()
    .default([]),
  error: text('error'),
  ...commonFieldDefs.dates
})

// ---------------------------------------------------------------------------
// 10. Ideas (1:N with Account) — the human approval gate
// ---------------------------------------------------------------------------

export const ideasTable = pgTable('ideas', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  runId: uuid('run_id').references(() => runsTable.id, {
    onDelete: 'set null'
  }),
  offeringId: uuid('offering_id').references(() => offeringsTable.id, {
    onDelete: 'set null'
  }),
  hook: text('hook').notNull(),
  angle: text('angle'),
  pillar: text('pillar'),
  score: integer('score').default(80).notNull(),
  status: varchar('status', { length: 20 }).default('suggested').notNull(),
  ...commonFieldDefs.dates
})

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
  hashtags: jsonb('hashtags').$type<string[]>().default([]),
  charCount: integer('char_count').default(0).notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  postedAt: commonFieldDefs.date('posted_at'),
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
export const ideas = ideasTable
export const postDrafts = postDraftsTable

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

export type Goal = typeof goalsTable.$inferSelect
export type NewGoal = typeof goalsTable.$inferInsert

export type Preference = typeof preferencesTable.$inferSelect
export type NewPreference = typeof preferencesTable.$inferInsert

export type Run = typeof runsTable.$inferSelect
export type NewRun = typeof runsTable.$inferInsert

export type Idea = typeof ideasTable.$inferSelect
export type NewIdea = typeof ideasTable.$inferInsert

export type PostDraft = typeof postDraftsTable.$inferSelect
export type NewPostDraft = typeof postDraftsTable.$inferInsert
export type Draft = PostDraft
