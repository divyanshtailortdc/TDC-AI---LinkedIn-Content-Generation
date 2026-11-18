/**
 * What a paid model call was for, as the usage ledger (ai_usage) records it.
 * Plain constants: the schema, the ledger and the usage cards all read them.
 *
 * - runs: a run's research, ideation and drafting (the worker and the
 *   drafting queue);
 * - posts: work on a post after its run: another version, a rewrite, an
 *   image, a carousel;
 * - newsletters: discovering newsletters to subscribe to;
 * - inbox: reading received email and the articles it links to. Anyone who
 *   knows an inbox address can start this work, so it has limits of its own
 *   (see INBOX_SHARE_OF_USER_LIMITS);
 * - identity: setting up an identity and its goals: AI setup, voice and style
 *   analysis, profile insights, knowledge documents, goal suggestions;
 * - unscoped: a call made outside any of those. Something to fix: every
 *   caller should say what it spends for (see withAiSpend).
 */
export const AI_SPEND_SOURCES = [
  'runs',
  'posts',
  'newsletters',
  'inbox',
  'identity',
  'unscoped'
] as const

export type AiSpendSource = (typeof AI_SPEND_SOURCES)[number]

export const AI_SPEND_SOURCE_LABELS: Record<AiSpendSource, string> = {
  runs: 'Runs',
  posts: 'Post editing',
  newsletters: 'Newsletter discovery',
  inbox: 'Inbox',
  identity: 'Identity & goals',
  unscoped: 'Other'
}

/** The spending limit looks back this far: a rolling window, not a calendar month. */
export const SPEND_LIMIT_WINDOW_DAYS = 30

/** The daily limits look back this far: any 24 hours, not a calendar day. */
export const DAILY_LIMIT_WINDOW_HOURS = 24

/**
 * Received email starts AI work that its owner did not ask for, and anyone
 * who knows an inbox address can send it. So inbox work stops when its owner
 * has spent this share of their 30-day or daily limit: a flood of email can
 * use up at most this much, and the rest is kept for work the owner starts.
 * Each identity's inbox also has a daily limit of its own
 * (AI_INBOX_DAILY_LIMIT_USD).
 */
export const INBOX_SHARE_OF_USER_LIMITS = 0.8
