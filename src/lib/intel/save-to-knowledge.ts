import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  knowledgeDocumentsTable
} from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { indexKnowledgeDocument } from '../ai/embeddings'

/**
 * "Save to Knowledge base" in the Library: a story's article becomes one of
 * the workspace's own knowledge documents. Its summary and claims were
 * already extracted, so they are copied rather than extracted again; the
 * document is embedded as any other is. From then on the article is the
 * workspace's own vetted material: every run reads it, its facts count as
 * verified, and it no longer comes in as newsletter evidence.
 *
 * The reason it cannot be saved, in words for the page, or null once saved
 * (or when it already was).
 */
export async function saveStoryToKnowledge(
  accountId: string,
  storyId: string
): Promise<string | null> {
  const mentions = intelMentionsTable
  const articles = intelArticlesTable
  const docs = knowledgeDocumentsTable
  const [story] = await db
    .select({
      headline: mentions.headline,
      url: articles.canonicalUrl,
      title: articles.title,
      content: articles.content,
      author: articles.author,
      publishedAt: articles.publishedAt,
      summary: articles.summary,
      topics: articles.topics,
      keyClaims: articles.keyClaims
    })
    .from(mentions)
    .innerJoin(articles, eq(articles.id, mentions.articleId))
    .where(
      and(
        eq(mentions.id, storyId),
        eq(mentions.accountId, accountId),
        eq(articles.status, 'done')
      )
    )
    .limit(1)
  if (!story?.content) {
    return 'Only a story whose article was read can be saved.'
  }

  const [existing] = await db
    .select({ id: docs.id })
    .from(docs)
    .where(and(eq(docs.accountId, accountId), eq(docs.sourceUrl, story.url)))
    .limit(1)
  if (existing) return null

  const [inserted] = await db
    .insert(docs)
    .values({
      accountId,
      title: (story.title || story.headline).slice(0, 300),
      sourceType: 'url',
      sourceUrl: story.url,
      content: story.content,
      author: story.author,
      publishedAt: story.publishedAt,
      wordCount: story.content.split(/\s+/).filter(Boolean).length,
      summary: story.summary,
      topics: story.topics,
      keyClaims: story.keyClaims
    })
    .returning()
  if (inserted) {
    try {
      await indexKnowledgeDocument(inserted)
    } catch (err) {
      // Runs embed it later (embeddings.ts backfills documents without chunks).
      console.warn(`Could not embed knowledge document ${inserted.id}:`, err)
    }
  }
  return null
}
