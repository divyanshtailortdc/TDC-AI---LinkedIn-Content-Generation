import { articlesTable, type Article, type ArticleSnapshot } from '@/db/schema'
import { and, eq, isNull, lt, ne, or } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { addUsage, type CallUsage } from '~/lib/ai/usage'
import { ARTICLE_GENERATION_STALE_MS } from './status'

/**
 * Generating an article makes exactly one per idea, and only one generation
 * of it runs at a time. A double click, two tabs or a retry each used to be
 * able to start a second model call; now each one first claims the article
 * with a conditional write, and only the caller that gets the claim
 * generates:
 *
 *   claimArticleForIdea     inserts the idea's article as `generating` (the
 *                           unique idea_id makes a second insert a no-op), or
 *                           takes over one that failed or went stale.
 *   claimArticleRegeneration  ready/failed/stale → generating, for an
 *                           existing article.
 *   saveGeneratedArticle    writes the result only while the claim still
 *                           holds (same generation_started_at), keeping the
 *                           version it replaces.
 *   failArticleGeneration   records why it failed, under the same rule.
 *
 * The claim's token is its generation_started_at. Takes the database as an
 * argument so it can run on any connection (and in tests).
 */
export type ArticleDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

export type ArticleClaim = { articleId: string; claimedAt: Date }

/** Not generating, or generating under a claim that went stale. */
const claimable = (now: Date) =>
  or(
    ne(articlesTable.generationStatus, 'generating'),
    isNull(articlesTable.generationStartedAt),
    lt(
      articlesTable.generationStartedAt,
      new Date(now.getTime() - ARTICLE_GENERATION_STALE_MS)
    )
  )

/**
 * Starts the idea's article. `claimed`: this caller generates it. `generating`:
 * another request already is. `exists`: it is already written (regenerating
 * is a separate, deliberate action).
 */
export async function claimArticleForIdea(
  database: ArticleDb,
  input: { accountId: string; ideaId: string; title?: string | null },
  now = new Date()
): Promise<
  | ({ outcome: 'claimed' } & ArticleClaim)
  | { outcome: 'generating' | 'exists'; articleId: string }
> {
  const [inserted] = await database
    .insert(articlesTable)
    .values({
      accountId: input.accountId,
      ideaId: input.ideaId,
      title: input.title?.trim() || '',
      generationStatus: 'generating',
      generationStartedAt: now
    })
    .onConflictDoNothing({ target: articlesTable.ideaId })
    .returning({ id: articlesTable.id })
  if (inserted) {
    return { outcome: 'claimed', articleId: inserted.id, claimedAt: now }
  }

  const [existing] = await database
    .select({
      id: articlesTable.id,
      accountId: articlesTable.accountId,
      generationStatus: articlesTable.generationStatus
    })
    .from(articlesTable)
    .where(eq(articlesTable.ideaId, input.ideaId))
    .limit(1)
  // The idea is the caller's (checked first), so its article is too; this
  // only guards against a mismatch ever writing across accounts.
  if (!existing || existing.accountId !== input.accountId) {
    throw new Error('Article not found')
  }
  if (existing.generationStatus === 'ready') {
    return { outcome: 'exists', articleId: existing.id }
  }

  // Failed, or generating under a stale claim: take it over.
  const [retaken] = await database
    .update(articlesTable)
    .set({
      generationStatus: 'generating',
      generationStartedAt: now,
      generationError: null,
      updatedAt: now
    })
    .where(
      and(
        eq(articlesTable.id, existing.id),
        ne(articlesTable.generationStatus, 'ready'),
        claimable(now)
      )
    )
    .returning({ id: articlesTable.id })
  return retaken
    ? { outcome: 'claimed', articleId: retaken.id, claimedAt: now }
    : { outcome: 'generating', articleId: existing.id }
}

/**
 * Claims an existing article for a new version, with the reviewer's
 * direction. Null when it is already being generated (or is not this
 * account's).
 */
export async function claimArticleRegeneration(
  database: ArticleDb,
  input: { accountId: string; articleId: string; guidance?: string | null },
  now = new Date()
): Promise<ArticleClaim | null> {
  const [row] = await database
    .update(articlesTable)
    .set({
      generationStatus: 'generating',
      generationStartedAt: now,
      generationError: null,
      guidance: input.guidance?.trim() || null,
      updatedAt: now
    })
    .where(
      and(
        eq(articlesTable.id, input.articleId),
        eq(articlesTable.accountId, input.accountId),
        claimable(now)
      )
    )
    .returning({ id: articlesTable.id })
  return row ? { articleId: row.id, claimedAt: now } : null
}

/** The row while this claim holds it. */
const heldClaim = (claim: ArticleClaim) =>
  and(
    eq(articlesTable.id, claim.articleId),
    eq(articlesTable.generationStatus, 'generating'),
    eq(articlesTable.generationStartedAt, claim.claimedAt)
  )

export const snapshotOf = (
  article: Pick<Article, 'title' | 'subtitle' | 'content' | 'callToAction'>
): ArticleSnapshot => ({
  title: article.title,
  subtitle: article.subtitle,
  content: article.content ?? [],
  callToAction: article.callToAction
})

export type GeneratedArticleValues = Pick<
  Article,
  | 'title'
  | 'subtitle'
  | 'content'
  | 'callToAction'
  | 'wordCount'
  | 'coverSuggestion'
  | 'promoPost'
  | 'sources'
  | 'lintFindings'
  | 'selfFlags'
  | 'model'
> & { coverImageAlt?: string | null }

/**
 * Saves a finished generation, if the claim still holds: a deleted article,
 * a stale take-over or a newer claim makes it match nothing (false), and the
 * result is dropped. The text it replaces becomes the previous version.
 */
export async function saveGeneratedArticle(
  database: ArticleDb,
  claim: ArticleClaim,
  values: GeneratedArticleValues,
  usage: CallUsage,
  now = new Date()
): Promise<boolean> {
  return database.transaction(async tx => {
    const [current] = await tx
      .select()
      .from(articlesTable)
      .where(heldClaim(claim))
      .for('update')
      .limit(1)
    if (!current) return false

    const hadText = (current.content ?? []).length > 0
    const { coverImageAlt, ...rest } = values
    await tx
      .update(articlesTable)
      .set({
        ...rest,
        original: snapshotOf(values),
        previousVersion: hadText
          ? { ...snapshotOf(current), replacedAt: now.toISOString() }
          : current.previousVersion,
        // The reviewer's own alt text survives a regeneration.
        coverImageAlt: current.coverImageAlt || coverImageAlt || null,
        generationStatus: 'ready',
        generationError: null,
        generatedAt: now,
        generationCount: current.generationCount + 1,
        usage: addUsage(
          current.usage as Partial<CallUsage>,
          usage
        ) as unknown as Record<string, number>,
        updatedAt: now
      })
      .where(eq(articlesTable.id, claim.articleId))
    return true
  })
}

/**
 * Records a failed generation: the article keeps any earlier text and reads
 * failed, with why. What the attempt cost is added either way.
 */
export async function failArticleGeneration(
  database: ArticleDb,
  claim: ArticleClaim,
  error: string,
  usage: CallUsage,
  now = new Date()
): Promise<boolean> {
  return database.transaction(async tx => {
    const [current] = await tx
      .select({ usage: articlesTable.usage })
      .from(articlesTable)
      .where(heldClaim(claim))
      .for('update')
      .limit(1)
    if (!current) return false
    await tx
      .update(articlesTable)
      .set({
        generationStatus: 'failed',
        generationError: error.slice(0, 500),
        usage: addUsage(
          current.usage as Partial<CallUsage>,
          usage
        ) as unknown as Record<string, number>,
        updatedAt: now
      })
      .where(eq(articlesTable.id, claim.articleId))
    return true
  })
}

/**
 * Marks an article whose claim went stale as failed, so the page following
 * it stops waiting and offers to try again. Conditional: a generation that
 * finishes meanwhile wins.
 */
export async function expireStaleGeneration(
  database: ArticleDb,
  articleId: string,
  now = new Date()
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - ARTICLE_GENERATION_STALE_MS)
  const rows = await database
    .update(articlesTable)
    .set({
      generationStatus: 'failed',
      generationError:
        'Generation stopped before it finished (the server restarted or ran out of time). Try again.',
      updatedAt: now
    })
    .where(
      and(
        eq(articlesTable.id, articleId),
        eq(articlesTable.generationStatus, 'generating'),
        or(
          isNull(articlesTable.generationStartedAt),
          lt(articlesTable.generationStartedAt, staleBefore)
        )
      )
    )
    .returning({ id: articlesTable.id })
  return rows.length > 0
}
