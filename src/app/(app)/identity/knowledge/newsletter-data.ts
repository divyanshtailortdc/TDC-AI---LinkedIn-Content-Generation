import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  mailMessagesTable
} from '@/db/schema'
import { MAX_NEWSLETTER_QUERY_LENGTH } from '@/lib/knowledge-path'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm'
import { RESEARCH_SETTINGS } from '~/lib/ai/context-blocks'
import type { ArticleStatus, StoryUse } from '~/lib/intel/status'
import { inboxSearchQuery } from '~/lib/mail/search'

/** Claims shown under an article; the rest stay in the article. */
const SHOWN_CLAIMS = 3

/** A story from one of the identity's newsletters, with its article. */
export type KnowledgeStory = {
  id: string
  headline: string
  blurb: string | null
  url: string | null
  sponsored: boolean
  /** From a sender the user unsubscribed from. */
  unsubscribed: boolean
  /** Whether ideas may use it (STORY_USES). */
  use: StoryUse
  /** Until when ideas use it automatically: the freshness window. */
  freshUntil: Date
  newsletter: string
  receivedAt: Date
  article: {
    status: ArticleStatus
    title: string | null
    siteName: string | null
    author: string | null
    publishedAt: Date | null
    wordCount: number | null
    summary: string | null
    claims: string[]
    topics: string[]
    /** Why it was skipped or failed. */
    note: string | null
  } | null
}

const mentions = intelMentionsTable
const messages = mailMessagesTable
const articles = intelArticlesTable

/** ?q= as the search box shows it. */
export function parseNewsletterQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  return (raw ?? '').trim().slice(0, MAX_NEWSLETTER_QUERY_LENGTH)
}

/**
 * One page of the identity's newsletter stories, newest first, optionally
 * matching a search of the stories and their articles. Callers pass the
 * signed-in user's own identity, so it only ever lists theirs.
 */
export async function loadNewsletterStories(
  accountId: string,
  { page, query }: { page: number; query: string }
) {
  const tsQuery = inboxSearchQuery(query)
  const where = and(
    eq(mentions.accountId, accountId),
    tsQuery
      ? or(
          sql`${mentions.searchVector} @@ to_tsquery('simple', ${tsQuery})`,
          sql`${articles.searchVector} @@ to_tsquery('simple', ${tsQuery})`
        )
      : undefined
  )

  const { rows, pageInfo } = await loadPage({
    page,
    pageSize: PAGE_SIZE,
    count: async () => {
      const [row] = await db
        .select({ n: count() })
        .from(mentions)
        .leftJoin(articles, eq(articles.id, mentions.articleId))
        .where(where)
      return row?.n ?? 0
    },
    rows: (offset, limit) =>
      db
        .select({
          id: mentions.id,
          headline: mentions.headline,
          blurb: mentions.blurb,
          url: mentions.url,
          sponsored: mentions.isSponsored,
          use: mentions.useInIdeas,
          fromName: messages.fromName,
          fromAddress: messages.fromAddress,
          receivedAt: messages.receivedAt,
          unsubscribedAt: messages.senderUnsubscribedAt,
          articleStatus: articles.status,
          title: articles.title,
          siteName: articles.siteName,
          author: articles.author,
          publishedAt: articles.publishedAt,
          wordCount: articles.wordCount,
          summary: articles.summary,
          claims: articles.keyClaims,
          topics: articles.topics,
          note: articles.lastError
        })
        .from(mentions)
        .innerJoin(messages, eq(messages.id, mentions.messageId))
        .leftJoin(articles, eq(articles.id, mentions.articleId))
        .where(where)
        .orderBy(desc(messages.receivedAt), asc(mentions.position))
        .offset(offset)
        .limit(limit)
  })

  const freshMs = RESEARCH_SETTINGS.freshness_days * 24 * 60 * 60_000
  return {
    pageInfo,
    stories: rows.map((row): KnowledgeStory => ({
      id: row.id,
      headline: row.headline,
      blurb: row.blurb,
      url: row.url,
      sponsored: row.sponsored,
      unsubscribed: row.unsubscribedAt !== null,
      use: row.use,
      freshUntil: new Date(row.receivedAt.getTime() + freshMs),
      newsletter: row.fromName || row.fromAddress || 'Newsletter',
      receivedAt: row.receivedAt,
      article: row.articleStatus
        ? {
            status: row.articleStatus,
            title: row.title,
            siteName: row.siteName,
            author: row.author,
            publishedAt: row.publishedAt,
            wordCount: row.wordCount,
            summary: row.summary,
            claims: (row.claims ?? [])
              .slice(0, SHOWN_CLAIMS)
              .map(claim => claim.claim),
            topics: row.topics ?? [],
            note: row.note
          }
        : null
    }))
  }
}
