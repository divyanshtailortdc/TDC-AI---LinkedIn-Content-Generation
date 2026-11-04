import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  mailMessagesTable
} from '@/db/schema'
import { embedMany } from 'ai'
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  gte,
  isNull,
  ne,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { getEmbeddingModel } from '../ai'
import type { GenerationContext } from '../ai/context-blocks'
import {
  buildRetrievalQueries,
  interleave
} from '../ai/pipeline/grounding-corpus'
import {
  pickStories,
  rankByWords,
  type NewsletterStory,
  type StoryRow
} from './story-ranking'

export type { NewsletterStory } from './story-ranking'

/**
 * Newsletter stories for a run's evidence: the workspace's own, from emails
 * that arrived within the freshness window, with what was read of each
 * article. Each of the run's goals finds the stories closest to it in
 * meaning (their embeddings, index-stories.ts), the goals' best in turn.
 * Stories not embedded yet, or all of them without an embedding model, are
 * matched by the words they share with the goals. Either way a story must be
 * close to a goal: an unrelated one is not evidence. Sponsored stories never
 * count (story-ranking.ts has the rest of the rules).
 */

/** Stories a run's evidence takes; each brings up to four items. */
export const NEWSLETTER_STORIES_PER_RUN = 8
/** Stories each goal's search returns before the closeness cut. */
const PER_GOAL = 12
/**
 * Cosine similarity below which a story is about something else than the
 * goal. Measured on the first real issues (text-embedding-3-small): stories
 * on a goal's subject scored 0.30 to 0.58 against its text, unrelated ones
 * up to 0.29.
 */
export const MIN_STORY_SIMILARITY = 0.3
/** Stories looked at when matching by words. */
const WORD_CANDIDATES = 80
const EMBED_TIMEOUT_MS = 30_000

const mentions = intelMentionsTable
const messages = mailMessagesTable
const articles = intelArticlesTable

const storyFields = {
  id: mentions.id,
  headline: mentions.headline,
  blurb: mentions.blurb,
  url: mentions.url,
  articleId: mentions.articleId,
  fromName: messages.fromName,
  fromAddress: messages.fromAddress,
  receivedAt: messages.receivedAt,
  articleTitle: articles.title,
  articleSummary: articles.summary,
  articlePublishedAt: articles.publishedAt,
  articleClaims: articles.keyClaims,
  articleTopics: articles.topics
}

/** The stories closest to each query, each query's best in turn. */
async function byMeaning(
  recent: SQL,
  queries: string[],
  handle: NonNullable<ReturnType<typeof getEmbeddingModel>>
): Promise<StoryRow[]> {
  const { embeddings } = await embedMany({
    model: handle.model,
    values: queries,
    abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS)
  })
  const perGoal = await Promise.all(
    embeddings.map(async embedding => {
      const distance = cosineDistance(mentions.embedding, embedding)
      const rows = await db
        .select({
          ...storyFields,
          similarity: sql<number>`1 - (${distance})`.mapWith(Number)
        })
        .from(mentions)
        .innerJoin(messages, eq(messages.id, mentions.messageId))
        .leftJoin(
          articles,
          and(eq(articles.id, mentions.articleId), eq(articles.status, 'done'))
        )
        .where(and(recent, eq(mentions.embeddingModel, handle.modelId)))
        .orderBy(asc(distance))
        .limit(PER_GOAL)
      return rows.filter(row => row.similarity >= MIN_STORY_SIMILARITY)
    })
  )
  return interleave(perGoal)
}

export async function retrieveNewsletterStories(
  ctx: GenerationContext,
  now = new Date()
): Promise<NewsletterStory[]> {
  const queries = buildRetrievalQueries(ctx)
  if (queries.length === 0) return []
  const since = new Date(
    now.getTime() - ctx.prefs.research.freshness_days * 24 * 60 * 60 * 1000
  )
  const recent = and(
    eq(mentions.accountId, ctx.account.id),
    eq(mentions.isSponsored, false),
    eq(messages.digestKind, 'newsletter'),
    gte(messages.receivedAt, since)
  )!

  const handle = getEmbeddingModel()
  let closest: StoryRow[] = []
  let matchedByMeaning = false
  if (handle) {
    try {
      closest = await byMeaning(recent, queries, handle)
      matchedByMeaning = true
    } catch (err) {
      console.warn(
        'Matching newsletter stories by meaning failed, using words:',
        err
      )
    }
  }

  // Stories without an embedding yet; all of them when meaning could not be used.
  const unembedded =
    handle && matchedByMeaning
      ? and(
          recent,
          or(
            isNull(mentions.embedding),
            ne(mentions.embeddingModel, handle.modelId)
          )
        )
      : recent
  const wordRows = await db
    .select(storyFields)
    .from(mentions)
    .innerJoin(messages, eq(messages.id, mentions.messageId))
    .leftJoin(
      articles,
      and(eq(articles.id, mentions.articleId), eq(articles.status, 'done'))
    )
    .where(unembedded)
    .orderBy(desc(messages.receivedAt), asc(mentions.position))
    .limit(WORD_CANDIDATES)

  return pickStories(
    [closest, rankByWords(wordRows, queries)],
    ctx.knowledgeDocs.flatMap(doc => (doc.sourceUrl ? [doc.sourceUrl] : [])),
    NEWSLETTER_STORIES_PER_RUN
  )
}
