import { pgTable, text, timestamp, uuid, integer, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Ideas entity: stores discovered or proposed content ideas, angles, and virality scores.
 */
export const ideas = pgTable("ideas", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  hook: text("hook"),
  angle: text("angle"),
  rawNotes: text("raw_notes"),
  category: text("category").default("Tech & Engineering"),
  score: integer("score").default(85), // Estimated virality or relevance score (0-100)
  status: text("status").default("suggested").notNull(), // 'suggested' | 'approved' | 'drafted' | 'rejected'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Drafts entity: stores drafted LinkedIn posts, hook variations, copy, and publishing status.
 */
export const drafts = pgTable("drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  ideaId: uuid("idea_id").references(() => ideas.id, { onDelete: "set null" }),
  title: text("title"),
  hook: text("hook").notNull(),
  body: text("body").notNull(),
  hashtags: jsonb("hashtags").$type<string[]>().default([]),
  mediaUrls: jsonb("media_urls").$type<string[]>().default([]),
  characterCount: integer("character_count").default(0),
  readabilityScore: integer("readability_score").default(90),
  status: text("status").default("draft").notNull(), // 'draft' | 'review' | 'scheduled' | 'published'
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  linkedinPostUrn: text("linkedin_post_urn"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Sources entity: stores ingested reference materials, news articles, or repositories.
 */
export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  url: text("url"),
  title: text("title").notNull(),
  content: text("content"),
  sourceType: text("source_type").default("article").notNull(), // 'article' | 'github' | 'social' | 'manual'
  tags: jsonb("tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Runs entity: tracks pipeline executions, execution steps, and logs.
 */
export const runs = pgTable("runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workflowName: text("workflow_name").notNull(),
  status: text("status").default("pending").notNull(), // 'pending' | 'running' | 'completed' | 'failed'
  currentStep: integer("current_step").default(0),
  totalSteps: integer("total_steps").default(4),
  statusText: text("status_text"),
  steps: jsonb("steps").$type<Array<{ id: string; name: string; status: "pending" | "running" | "completed" | "failed" }>>().default([]),
  logs: jsonb("logs").$type<Array<{ timestamp: string; level: string; message: string }>>().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * Media Assets entity: stores generated visual assets, carousels, or infographics.
 */
export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  draftId: uuid("draft_id").references(() => drafts.id, { onDelete: "cascade" }),
  type: text("type").default("image").notNull(), // 'image' | 'carousel' | 'chart'
  url: text("url").notNull(),
  prompt: text("prompt"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Relations
export const ideasRelations = relations(ideas, ({ many }) => ({
  drafts: many(drafts),
}));

export const draftsRelations = relations(drafts, ({ one, many }) => ({
  idea: one(ideas, {
    fields: [drafts.ideaId],
    references: [ideas.id],
  }),
  mediaAssets: many(mediaAssets),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one }) => ({
  draft: one(drafts, {
    fields: [mediaAssets.draftId],
    references: [drafts.id],
  }),
}));

// Inferred TypeScript types from schema
export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;

export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type NewMediaAsset = typeof mediaAssets.$inferInsert;
