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
import { mapConcurrently } from '../research/web-search'
import { storyText } from './story-ranking'

/**
 * Extraction, step 3: each story's embedding, so a run can match stories to
 * its goals by meaning (retrieval.ts). A story waits for its article to be
 * read, so the article's summary counts too, but not for long: after an hour
 * it is embedded with what it has, and again once the article is read
 * (read-article.ts clears it). A new embedding model embeds every story
 * again. Two passes embedding the same story write the same vector, so no
 * claim is needed.
 *
 * Failures: with the model down, busy or out of budget, every story waits
 * for the next pass. When the model works but refuses something in a batch,
 * each story is embedded on its own, and one refused again is marked
 * (refusedBy) so it is not sent to that model again; it is matched by words
 * instead, and a new model tries it afresh.
 */

const BATCH = 50
const ARTICLE_WAIT_MS = 60 * 60_000
const EMBED_TIMEOUT_MS = 60_000

const mentions = intelMentionsTable
const articles = intelArticlesTable

type EmbeddingHandle = NonNullable<ReturnType<typeof getEmbeddingModel>>

/** embedding_model of a story the model refused: never one retrieval matches. */
const refusedBy = (modelId: string) => `refused:${modelId}`.slice(0, 100)

async function embed(handle: EmbeddingHandle, values: string[]) {
  const { embeddings } = await embedMany({
    model: handle.model,
    values,
    maxParallelCalls: 2,
    abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
  })
  if (
    embeddings.length !== values.length ||
    embeddings.some(e => e.length !== EMBEDDING_DIMENSIONS)
  ) {
    throw new Error(
      `Embedding model ${handle.modelId} returned vectors that do not match ${values.length} stories of ${EMBEDDING_DIMENSIONS} dimensions`
    )
  }
  return embeddings
}

/**
 * After a batch failed: null when the model itself fails (down, busy, out of
 * budget, misconfigured), so every story waits for the next pass. Otherwise
 * something in the batch was refused: each story on its own, null for each
 * one refused again.
 */
async function embedOneByOne(
  handle: EmbeddingHandle,
  values: string[],
  batchError: unknown
): Promise<Array<number[] | null> | null> {
  try {
    await embed(handle, ['A newsletter story.'])
  } catch {
    // Retried by the next pass; until then the stories are matched by words.
    console.warn('Could not embed newsletter stories:', batchError)
    return null
  }
  const vectors = await mapConcurrently(values, 2, value =>
    embed(handle, [value]).then(
      ([vector]) => vector ?? null,
      () => null
    )
  )
  const refused = vectors.filter(vector => vector === null).length
  if (refused > 0) {
    console.warn(
      `Embedding model ${handle.modelId} refused ${refused} newsletter stor${refused === 1 ? 'y' : 'ies'}; matched by words instead.`,
      batchError
    )
  }
  return vectors
}

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
          isNull(mentions.embeddingModel),
          ne(mentions.embeddingModel, refusedBy(handle.modelId))
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

  const values = rows.map(storyText)
  let vectors: Array<number[] | null>
  try {
    vectors = await embed(handle, values)
  } catch (err) {
    const oneByOne = await embedOneByOne(handle, values, err)
    if (!oneByOne) return 0
    vectors = oneByOne
  }
  await db.transaction(async tx => {
    for (const [i, row] of rows.entries()) {
      const vector = vectors[i]
      await tx
        .update(mentions)
        .set(
          vector
            ? { embedding: vector, embeddingModel: handle.modelId }
            : { embedding: null, embeddingModel: refusedBy(handle.modelId) }
        )
        .where(eq(mentions.id, row.id))
    }
  })
  return rows.length
}
