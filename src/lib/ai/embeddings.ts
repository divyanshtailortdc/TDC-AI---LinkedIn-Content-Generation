import { db } from '@/db'
import {
  documentChunksTable,
  EMBEDDING_DIMENSIONS,
  type KnowledgeDocument
} from '@/db/schema'
import { embed, embedMany } from 'ai'
import { and, asc, cosineDistance, eq, inArray, sql } from 'drizzle-orm'
import { getEmbeddingModel } from '~/lib/ai'
import { chunkText } from './chunking'
import type { GenerationContext } from './context'

const EMBED_TIMEOUT_MS = 60_000
const MAX_BACKFILL_PER_RUN = 10

export interface KnowledgePassage {
  documentId: string
  content: string
  similarity: number
}

type IndexableDocument = Pick<
  KnowledgeDocument,
  'id' | 'accountId' | 'title' | 'content'
>

export async function indexKnowledgeDocument(
  doc: IndexableDocument
): Promise<number> {
  const handle = getEmbeddingModel()
  if (!handle) return 0

  const chunks = chunkText(doc.content)
  if (chunks.length === 0) return 0

  const { embeddings } = await embedMany({
    model: handle.model,
    values: chunks.map(chunk => `${doc.title}\n\n${chunk}`),
    maxParallelCalls: 2,
    abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
  })

  if (
    embeddings.length !== chunks.length ||
    embeddings.some(e => e.length !== EMBEDDING_DIMENSIONS)
  ) {
    throw new Error(
      `Embedding model ${handle.modelId} returned vectors that do not match ${chunks.length} chunks of ${EMBEDDING_DIMENSIONS} dimensions`
    )
  }

  await db.transaction(async tx => {
    await tx
      .delete(documentChunksTable)
      .where(eq(documentChunksTable.documentId, doc.id))
    await tx.insert(documentChunksTable).values(
      chunks.map((content, chunkIndex) => ({
        documentId: doc.id,
        accountId: doc.accountId,
        chunkIndex,
        content,
        embedding: embeddings[chunkIndex]!,
        embeddingModel: handle.modelId
      }))
    )
  })

  return chunks.length
}

async function backfillMissingChunks(
  docs: IndexableDocument[],
  modelId: string
): Promise<void> {
  const indexed = await db
    .selectDistinct({ documentId: documentChunksTable.documentId })
    .from(documentChunksTable)
    .where(
      and(
        inArray(
          documentChunksTable.documentId,
          docs.map(d => d.id)
        ),
        eq(documentChunksTable.embeddingModel, modelId)
      )
    )
  const indexedIds = new Set(indexed.map(row => row.documentId))
  const missing = docs
    .filter(d => !indexedIds.has(d.id))
    .slice(0, MAX_BACKFILL_PER_RUN)

  for (const doc of missing) {
    try {
      await indexKnowledgeDocument(doc)
    } catch (err) {
      console.warn(`Could not embed knowledge document ${doc.id}:`, err)
    }
  }
}

export function buildRetrievalQuery(ctx: GenerationContext): string {
  const goal = ctx.primaryGoal
  const parts = [
    goal?.title,
    goal?.keyMessage,
    ...ctx.prefs.pillars.map(p =>
      p.example_topics?.length
        ? `${p.name}: ${p.example_topics.join(', ')}`
        : p.name
    )
  ]
  const query = parts.filter(Boolean).join('\n').trim()
  return query || ctx.account.headline
}
export async function retrieveKnowledgePassages(
  ctx: GenerationContext,
  docs: IndexableDocument[],
  options: { limit?: number; minSimilarity?: number } = {}
): Promise<KnowledgePassage[]> {
  const handle = getEmbeddingModel()
  const query = buildRetrievalQuery(ctx)
  if (!handle || docs.length === 0 || !query) return []

  const limit = options.limit ?? 6
  const minSimilarity = options.minSimilarity ?? 0.35

  try {
    await backfillMissingChunks(docs, handle.modelId)

    const { embedding } = await embed({
      model: handle.model,
      value: query,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
    })

    const distance = cosineDistance(documentChunksTable.embedding, embedding)
    const rows = await db
      .select({
        documentId: documentChunksTable.documentId,
        content: documentChunksTable.content,
        similarity: sql<number>`1 - (${distance})`.mapWith(Number)
      })
      .from(documentChunksTable)
      .where(
        and(
          eq(documentChunksTable.accountId, ctx.account.id),
          inArray(
            documentChunksTable.documentId,
            docs.map(d => d.id)
          ),
          eq(documentChunksTable.embeddingModel, handle.modelId)
        )
      )
      .orderBy(asc(distance))
      .limit(limit)

    return rows.filter(row => row.similarity >= minSimilarity)
  } catch (err) {
    console.warn(
      'Knowledge retrieval failed, continuing without passages:',
      err
    )
    return []
  }
}
