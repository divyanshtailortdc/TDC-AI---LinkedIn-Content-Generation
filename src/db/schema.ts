import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid
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
 * Ideas table: stores discovered or brainstormed content topics, hooks, and virality scores.
 */
export const ideasTable = pgTable('ideas', {
  id: commonFieldDefs.id(),
  title: text('title').notNull(),
  hook: text('hook'),
  angle: text('angle'),
  rawNotes: text('raw_notes'),
  category: text('category').default('Tech & Engineering'),
  score: integer('score').default(85),
  status: text('status').default('suggested').notNull(),
  ...commonFieldDefs.dates
})

/**
 * Drafts table: stores drafted LinkedIn post copy, formatting, and scheduling metadata.
 */
export const draftsTable = pgTable('drafts', {
  id: commonFieldDefs.id(),
  ideaId: uuid('idea_id').references(() => ideasTable.id, {
    onDelete: 'set null'
  }),
  title: text('title'),
  hook: text('hook').notNull(),
  body: text('body').notNull(),
  hashtags: jsonb('hashtags').$type<string[]>().default([]),
  mediaUrls: jsonb('media_urls').$type<string[]>().default([]),
  characterCount: integer('character_count').default(0),
  readabilityScore: integer('readability_score').default(90),
  status: text('status').default('draft').notNull(),
  scheduledFor: commonFieldDefs.date('scheduled_for'),
  postedAt: commonFieldDefs.date('posted_at'),
  linkedinPostUrn: text('linkedin_post_urn'),
  ...commonFieldDefs.dates
})

/**
 * Sources table: stores ingested reference materials, links, and articles.
 */
export const sourcesTable = pgTable('sources', {
  id: commonFieldDefs.id(),
  url: text('url'),
  title: text('title').notNull(),
  content: text('content'),
  sourceType: text('source_type').default('article').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow()
})

/**
 * Runs table: tracks asynchronous pipeline executions, steps, and logs.
 */
export const runsTable = pgTable('runs', {
  id: commonFieldDefs.id(),
  workflowName: text('workflow_name').notNull(),
  status: text('status').default('pending').notNull(),
  currentStep: integer('current_step').default(0),
  totalSteps: integer('total_steps').default(4),
  statusText: text('status_text'),
  steps: jsonb('steps')
    .$type<
      Array<{
        id: string
        name: string
        status: 'pending' | 'running' | 'completed' | 'failed'
      }>
    >()
    .default([]),
  logs: jsonb('logs')
    .$type<Array<{ timestamp: string; level: string; message: string }>>()
    .default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  startedAt: timestamp('started_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: commonFieldDefs.date('completed_at')
})

/**
 * Media Assets table: stores generated images, carousels, or infographics.
 */
export const mediaAssetsTable = pgTable('media_assets', {
  id: commonFieldDefs.id(),
  draftId: uuid('draft_id').references(() => draftsTable.id, {
    onDelete: 'cascade'
  }),
  type: text('type').default('image').notNull(),
  url: text('url').notNull(),
  prompt: text('prompt'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true })
    .notNull()
    .defaultNow()
})

// Backwards-compatible aliases
export const ideas = ideasTable
export const drafts = draftsTable
export const sources = sourcesTable
export const runs = runsTable
export const mediaAssets = mediaAssetsTable

// Types
export type Idea = typeof ideasTable.$inferSelect
export type NewIdea = typeof ideasTable.$inferInsert

export type Draft = typeof draftsTable.$inferSelect
export type NewDraft = typeof draftsTable.$inferInsert

export type Source = typeof sourcesTable.$inferSelect
export type NewSource = typeof sourcesTable.$inferInsert

export type Run = typeof runsTable.$inferSelect
export type NewRun = typeof runsTable.$inferInsert

export type MediaAsset = typeof mediaAssetsTable.$inferSelect
export type NewMediaAsset = typeof mediaAssetsTable.$inferInsert
