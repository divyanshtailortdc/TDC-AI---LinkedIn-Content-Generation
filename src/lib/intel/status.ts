/**
 * Where extraction stands for an email and for an article. Client-safe: no
 * imports, so the schema, the pipeline and the inbox read the same lists.
 *
 * An email's extraction (mail_messages.extraction_status):
 * - pending: waiting for a pass, or for its retry time after a failure.
 * - processing: claimed by a pass.
 * - done: its stories and links are stored (none for a non-newsletter).
 * - failed: gave up after the last attempt; Try again starts over.
 */
export const EXTRACTION_STATUSES = [
  'pending',
  'processing',
  'done',
  'failed'
] as const

export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number]

/**
 * An article linked from a story (intel_articles.status):
 * - pending, processing, failed: as for an email.
 * - done: read and summarised.
 * - skipped: cannot be read (gone, not a web page, a paywall or sign-in
 *   page); the story keeps the newsletter's own words.
 * - duplicate: the same text as another article (duplicate_of_id), which its
 *   stories now point to.
 */
export const ARTICLE_STATUSES = [
  'pending',
  'processing',
  'done',
  'skipped',
  'failed',
  'duplicate'
] as const

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number]

/** What kind of email it is; only a newsletter's stories are extracted. */
export const DIGEST_KINDS = [
  'newsletter',
  'promotion',
  'transactional',
  'other'
] as const

export type DigestKind = (typeof DIGEST_KINDS)[number]

/**
 * Whether ideas may use a story (intel_mentions.use_in_ideas), set from the
 * Knowledge base's "From newsletters" view:
 * - auto: while it is recent, not sponsored and from a newsletter the user
 *   still receives, and only when it is relevant to a run's goals.
 * - keep: also after that, as long as it is relevant: an evergreen report.
 * - never: not at all: wrong, off-brand or not wanted.
 */
export const STORY_USES = ['auto', 'keep', 'never'] as const

export type StoryUse = (typeof STORY_USES)[number]
