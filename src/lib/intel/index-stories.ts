import 'server-only'

import { db } from '@/db'
import {
  EMBEDDING_DIMENSIONS,
  intelArticlesTable,
  intelMentionsTable
} from '@/db/schema'
import { embedMany } from 'ai'
import { and, desc, eq, isNull, lt, ne, notInArray, or } from 'drizzle-orm'
import { getEmbeddingModel } from '../ai'
import { storyText } from './story-ranking'

/**
 * Extraction, step 3: each story's embedding, so a run can match stories to
 * its goals by meaning (retrieval.ts). A story waits for its article to be
 * read, so the article's summary counts too, but not for long: after an hour
 * it is embedded with what it has, and again once the article is read
 * (read-article.ts clears it). A new embedding model embeds every story
 * again. Two passes embedding the same story write the same vector, so no
 * claim is needed.
 */

const BATCH = 50
const ARTICLE_WAIT_MS = 60 * 60_000
const EMBED_TIMEOUT_MS = 60_000

const mentions = intelMentionsTable
const articles = intelArticlesTable

/** Embeds up to `limit` stories that need it; how many. 0 without an embedding model. */
export async function indexDueStories(limit = BATCH): Promise<number> {
  const handle = getEmbeddingModel()
  if (!handle) return 0
  const waited = new Date(Date.now() - ARTICLE_WAIT_MS)
  const rows = await db
    .select({
      id: mentions.id,
      headline: mentions.headline,
      blurb: mentions.blurb,
      articleTitle: articles.title,
      articleSummary: articles.summary
    })
    .from(mentions)
    .leftJoin(articles, eq(articles.id, mentions.articleId))
    .where(
      and(
        or(
          isNull(mentions.embedding),
          ne(mentions.embeddingModel, handle.modelId)
        ),
        or(
          isNull(mentions.articleId),
          notInArray(articles.status, ['pending', 'processing']),
          lt(mentions.createdAt, waited)
        )
      )
    )
    .orderBy(desc(mentions.createdAt))
    .limit(limit)
  if (rows.length === 0) return 0

  try {
    const { embeddings } = await embedMany({
      model: handle.model,
      values: rows.map(storyText),
      maxParallelCalls: 2,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
    })
    if (
      embeddings.length !== rows.length ||
      embeddings.some(e => e.length !== EMBEDDING_DIMENSIONS)
    ) {
      throw new Error(
        `Embedding model ${handle.modelId} returned vectors that do not match ${rows.length} stories of ${EMBEDDING_DIMENSIONS} dimensions`
      )
    }
    await db.transaction(async tx => {
      for (const [i, row] of rows.entries()) {
        await tx
          .update(mentions)
          .set({ embedding: embeddings[i]!, embeddingModel: handle.modelId })
          .where(eq(mentions.id, row.id))
      }
    })
    return rows.length
  } catch (err) {
    // Retried by the next pass; until then the stories are matched by words.
    console.warn('Could not embed newsletter stories:', err)
    return 0
  }
}
