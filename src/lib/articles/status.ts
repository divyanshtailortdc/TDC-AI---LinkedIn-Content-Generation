/**
 * States of a long-form article (the `articles` table). Shared by the schema
 * (check constraints) and the code, so they cannot drift apart. No imports,
 * so the schema, tests and client components can all read it.
 */

/**
 * What an idea can be written up as. A post lives in `post_drafts`, an
 * article in `articles`; both point back at the idea they came from, so
 * one idea can have one of each.
 */
export const CONTENT_TYPES = ['post', 'article'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

/**
 * generating: a model call holds the article (the claim; see
 * ARTICLE_GENERATION_STALE_MS). ready: there is content to review. failed:
 * the last generation did not finish; any earlier content is kept.
 */
export const ARTICLE_GENERATION_STATUSES = [
  'generating',
  'ready',
  'failed'
] as const
export type ArticleGenerationStatus =
  (typeof ARTICLE_GENERATION_STATUSES)[number]

/**
 * draft: being reviewed and edited here. published: the reviewer published it
 * on the platform by hand (native articles cannot be published through the
 * API; see docs/ARTICLES.md) and marked it so, usually with its link.
 */
export const ARTICLE_PUBLISH_STATUSES = ['draft', 'published'] as const
export type ArticlePublishStatus = (typeof ARTICLE_PUBLISH_STATUSES)[number]

/**
 * A generation claim older than this belongs to a process that went away (a
 * deploy, a function past its time limit): the article reads as failed and
 * may be generated again. Comfortably longer than one generation takes.
 */
export const ARTICLE_GENERATION_STALE_MS = 8 * 60 * 1000

/** Idea statuses an article can be generated from: approved at some point. */
export const ARTICLE_ELIGIBLE_IDEA_STATUSES = [
  'approved',
  'drafting',
  'drafted'
] as const

export function canGenerateArticleFrom(ideaStatus: string): boolean {
  return (ARTICLE_ELIGIBLE_IDEA_STATUSES as readonly string[]).includes(
    ideaStatus
  )
}

/**
 * Whether a generation claim is stale: started before the TTL and still
 * marked generating.
 */
export function isStaleGeneration(
  article: {
    generationStatus: string
    generationStartedAt: Date | string | null
  },
  now = new Date()
): boolean {
  if (article.generationStatus !== 'generating') return false
  if (!article.generationStartedAt) return true
  const started = new Date(article.generationStartedAt).getTime()
  return now.getTime() - started > ARTICLE_GENERATION_STALE_MS
}
