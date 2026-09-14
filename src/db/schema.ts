import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  vector
} from 'drizzle-orm/pg-core'

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

/**
 * 1. Accounts table: stores persona and profile identity.
 */
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

/**
 * 2. Voice Configs table (1:1 with Account): tone, rules, banned words.
 */
export const voiceConfigsTable = pgTable('voice_configs', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .unique()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  tone: varchar('tone', { length: 50 }).default('candid').notNull(),
  perspective: varchar('perspective', { length: 30 })
    .default('first_person')
    .notNull(),
  formality: integer('formality').default(3).notNull(),
  bannedWords: jsonb('banned_words').$type<string[]>().default([]),
  rules: text('rules'),
  ...commonFieldDefs.dates
})

/**
 * 3. Offerings table (1:N with Account): products, services, lead magnets.
 */
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

/**
 * 4. Sample Posts table (1:N with Account): few-shot training examples.
 */
export const samplePostsTable = pgTable('sample_posts', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  hook: text('hook'),
  content: text('content').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow()
})

/**
 * 5. Audiences table (1:N with Account): target ICP, pain points, goals.
 */
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

/**
 * 6. Knowledge Documents table (1:N with Account): ingested articles, notes, URLs.
 */
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
  tags: jsonb('tags').$type<string[]>().default([]),
  ...commonFieldDefs.dates
})

/**
 * 7. Document Chunks table (1:N with Knowledge Documents): vector embeddings for RAG.
 */
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
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
      .notNull()
      .defaultNow()
  },
  table => [
    index('chunk_embedding_hnsw_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
    index('chunk_account_idx').on(table.accountId),
    index('chunk_document_idx').on(table.documentId)
  ]
)

/**
 * 8. Goals table (1:N with Account): campaign objectives.
 */
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

/**
 * 9. Preferences table (1:1 with Account): posting cadence and pillars.
 */
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

/**
 * 10. Runs table (1:N with Account): pipeline execution lifecycle & logs.
 */
export const runsTable = pgTable('runs', {
  id: commonFieldDefs.id(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accountsTable.id, { onDelete: 'cascade' }),
  goalId: uuid('goal_id').references(() => goalsTable.id, {
    onDelete: 'set null'
  }),
  workflow: varchar('workflow', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  currentStep: integer('current_step').default(0).notNull(),
  totalSteps: integer('total_steps').default(3).notNull(),
  logs: jsonb('logs')
    .$type<Array<{ step: string; status: string; timestamp?: string }>>()
    .default([]),
  error: text('error'),
  ...commonFieldDefs.dates
})

/**
 * 11. Ideas table (1:N with Account): human approval gate for hooks & angles.
 */
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

/**
 * 12. Post Drafts table (1:N with Account): final ready-to-post LinkedIn copy.
 */
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
  scheduledFor: commonFieldDefs.date('scheduled_for'),
  postedAt: commonFieldDefs.date('posted_at'),
  ...commonFieldDefs.dates
})

// Convenience aliases
export const accounts = accountsTable
export const voiceConfigs = voiceConfigsTable
export const offerings = offeringsTable
export const samplePosts = samplePostsTable
export const audiences = audiencesTable
export const knowledgeDocuments = knowledgeDocumentsTable
export const documentChunks = documentChunksTable
export const goals = goalsTable
export const preferences = preferencesTable
export const runs = runsTable
export const ideas = ideasTable
export const postDrafts = postDraftsTable

// Backward-compatible alias for previous draftsTable
export const draftsTable = postDraftsTable
export const drafts = postDraftsTable

// Inferred TypeScript Types
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

export type Idea = typeof ideasTable.$inferSelect
export type NewIdea = typeof ideasTable.$inferInsert

export type PostDraft = typeof postDraftsTable.$inferSelect
export type NewPostDraft = typeof postDraftsTable.$inferInsert
export type Draft = PostDraft
