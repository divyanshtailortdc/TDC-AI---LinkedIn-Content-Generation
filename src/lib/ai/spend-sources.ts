/**
 * What a paid model call was for, as the usage ledger (ai_usage) records it.
 * Plain constants: the schema, the ledger and the usage cards all read them.
 *
 * - runs: a run's research, ideation and drafting (the worker and the
 *   drafting queue);
 * - posts: work on a post after its run: another version, a rewrite, an
 *   image, a carousel;
 * - newsletters: reading received newsletters and the articles they link to,
 *   and discovering newsletters;
 * - identity: setting up an identity and its goals: AI setup, voice and style
 *   analysis, profile insights, knowledge documents, goal suggestions;
 * - unscoped: a call made outside any of those. Something to fix: every
 *   caller should say what it spends for (see withAiSpend).
 */
export const AI_SPEND_SOURCES = [
  'runs',
  'posts',
  'newsletters',
  'identity',
  'unscoped'
] as const

export type AiSpendSource = (typeof AI_SPEND_SOURCES)[number]

export const AI_SPEND_SOURCE_LABELS: Record<AiSpendSource, string> = {
  runs: 'Runs',
  posts: 'Post editing',
  newsletters: 'Newsletters',
  identity: 'Identity & goals',
  unscoped: 'Other'
}

/** The spending limit looks back this far: a rolling window, not a calendar month. */
export const SPEND_LIMIT_WINDOW_DAYS = 30
