import 'server-only'

import { db } from '@/db'
import { articlesTable, ideasTable, postDraftsTable } from '@/db/schema'
import { isStaleGeneration } from '@/lib/articles/status'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { and, count, desc, eq } from 'drizzle-orm'
import { viewableImageUrl } from '~/lib/media/image-store'

/**
 * The Articles pages' reads. Every query is scoped to the signed-in user's
 * identity (the caller passes its id from getIdentity), so an article id from
 * another account is simply not found.
 */

export type ArticleListItem = Awaited<
  ReturnType<typeof loadArticlesPage>
>['articles'][number]

/** One page of the identity's articles, most recently changed first. */
export async function loadArticlesPage(accountId: string, page: number) {
  const ofAccount = eq(articlesTable.accountId, accountId)
  const { rows, pageInfo } = await loadPage({
    page,
    pageSize: PAGE_SIZE,
    count: async () =>
      (await db.select({ n: count() }).from(articlesTable).where(ofAccount))[0]
        ?.n ?? 0,
    rows: (offset, limit) =>
      db
        .select({
          id: articlesTable.id,
          title: articlesTable.title,
          subtitle: articlesTable.subtitle,
          generationStatus: articlesTable.generationStatus,
          generationStartedAt: articlesTable.generationStartedAt,
          generationError: articlesTable.generationError,
          status: articlesTable.status,
          wordCount: articlesTable.wordCount,
          updatedAt: articlesTable.updatedAt,
          publishedAt: articlesTable.publishedAt,
          ideaId: articlesTable.ideaId,
          ideaTitle: ideasTable.title
        })
        .from(articlesTable)
        .leftJoin(ideasTable, eq(ideasTable.id, articlesTable.ideaId))
        .where(ofAccount)
        .orderBy(desc(articlesTable.updatedAt), desc(articlesTable.id))
        .offset(offset)
        .limit(limit)
  })
  const now = new Date()
  return {
    articles: rows.map(({ generationStartedAt, ...row }) => ({
      ...row,
      // A claim that went stale reads as failed; opening it settles the row.
      generationStatus: isStaleGeneration(
        { generationStatus: row.generationStatus, generationStartedAt },
        now
      )
        ? ('failed' as const)
        : row.generationStatus
    })),
    pageInfo
  }
}

/**
 * One article for its editor, with its idea (for context and the back link),
 * a cover link the browser can load, and the link posts made from it.
 */
export async function loadArticleForEditor(
  accountId: string,
  articleId: string
) {
  const [row] = await db
    .select({
      article: articlesTable,
      idea: {
        id: ideasTable.id,
        title: ideasTable.title,
        hook: ideasTable.hook,
        status: ideasTable.status
      }
    })
    .from(articlesTable)
    .leftJoin(ideasTable, eq(ideasTable.id, articlesTable.ideaId))
    .where(
      and(
        eq(articlesTable.id, articleId),
        eq(articlesTable.accountId, accountId)
      )
    )
    .limit(1)
  if (!row) return null

  const [coverUrl, linkPosts] = await Promise.all([
    row.article.coverImageUrl
      ? viewableImageUrl(row.article.coverImageUrl).catch(err => {
          console.error(
            `Could not load the cover of article ${articleId}:`,
            err
          )
          return null
        })
      : Promise.resolve(null),
    db
      .select({
        id: postDraftsTable.id,
        status: postDraftsTable.status,
        linkUrl: postDraftsTable.linkUrl,
        postedAt: postDraftsTable.postedAt,
        createdAt: postDraftsTable.createdAt
      })
      .from(postDraftsTable)
      .where(
        and(
          eq(postDraftsTable.articleId, articleId),
          eq(postDraftsTable.accountId, accountId)
        )
      )
      .orderBy(desc(postDraftsTable.createdAt))
  ])

  const { article } = row
  return {
    id: article.id,
    ideaId: article.ideaId,
    idea: row.idea?.id ? row.idea : null,
    generationStatus: isStaleGeneration(article)
      ? ('failed' as const)
      : article.generationStatus,
    generationError: isStaleGeneration(article)
      ? 'Generation stopped before it finished. Try again.'
      : article.generationError,
    generationCount: article.generationCount,
    generatedAt: article.generatedAt?.toISOString() ?? null,
    guidance: article.guidance,
    status: article.status,
    title: article.title,
    subtitle: article.subtitle,
    content: article.content ?? [],
    callToAction: article.callToAction,
    wordCount: article.wordCount,
    coverUrl,
    hasCover: Boolean(article.coverImageUrl),
    coverImageAlt: article.coverImageAlt,
    coverSuggestion: article.coverSuggestion,
    promoPost: article.promoPost,
    sources: article.sources ?? [],
    lintFindings: article.lintFindings ?? [],
    selfFlags: article.selfFlags ?? [],
    hasPreviousVersion: Boolean(article.previousVersion?.content?.length),
    previousVersionAt: article.previousVersion?.replacedAt ?? null,
    costUsd: Number((article.usage as { costUsd?: number })?.costUsd ?? 0),
    model: article.model,
    publishedUrl: article.publishedUrl,
    publishedAt: article.publishedAt?.toISOString() ?? null,
    updatedAt: article.updatedAt.toISOString(),
    linkPosts: linkPosts.map(p => ({
      ...p,
      postedAt: p.postedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString()
    }))
  }
}

export type ArticleEditorData = NonNullable<
  Awaited<ReturnType<typeof loadArticleForEditor>>
>
