import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  knowledgeDocumentsTable,
  mailMessagesTable
} from '@/db/schema'
import { MAX_LIBRARY_QUERY_LENGTH } from '@/lib/library-path'
import { loadPage } from '@/lib/pagination'
import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm'
import type { ArticleStatus } from '~/lib/intel/status'
import { inboxSearchQuery } from '~/lib/mail/search'

const LIBRARY_PAGE_SIZE = 20
/** Claims shown under an article; the rest stay in the article. */
const SHOWN_CLAIMS = 3

/** A story from one of the identity's newsletters, with its article. */
export type LibraryStory = {
  id: string
  headline: string
  blurb: string | null
  url: string | null
  sponsored: boolean
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
  /** Its article is one of the identity's knowledge documents. */
  saved: boolean
}

const mentions = intelMentionsTable
const messages = mailMessagesTable
const articles = intelArticlesTable

/** ?q= as the search box shows it. */
export function parseLibraryQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  return (raw ?? '').trim().slice(0, MAX_LIBRARY_QUERY_LENGTH)
}

/**
 * One page of the identity's newsletter stories, newest first, optionally
 * matching a search of the stories and their articles. Callers pass the
 * signed-in user's own identity, so it only ever lists theirs.
 */
export async function loadLibraryPage(
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
  const saved = sql<boolean>`exists (select 1 from ${knowledgeDocumentsTable} where ${knowledgeDocumentsTable.accountId} = ${mentions.accountId} and ${knowledgeDocumentsTable.sourceUrl} = ${articles.canonicalUrl})`

  const { rows, pageInfo } = await loadPage({
    page,
    pageSize: LIBRARY_PAGE_SIZE,
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
          fromName: messages.fromName,
          fromAddress: messages.fromAddress,
          receivedAt: messages.receivedAt,
          articleStatus: articles.status,
          title: articles.title,
          siteName: articles.siteName,
          author: articles.author,
          publishedAt: articles.publishedAt,
          wordCount: articles.wordCount,
          summary: articles.summary,
          claims: articles.keyClaims,
          topics: articles.topics,
          note: articles.lastError,
          saved
        })
        .from(mentions)
        .innerJoin(messages, eq(messages.id, mentions.messageId))
        .leftJoin(articles, eq(articles.id, mentions.articleId))
        .where(where)
        .orderBy(desc(messages.receivedAt), asc(mentions.position))
        .offset(offset)
        .limit(limit)
  })

  return {
    pageInfo,
    stories: rows.map((row): LibraryStory => ({
      id: row.id,
      headline: row.headline,
      blurb: row.blurb,
      url: row.url,
      sponsored: row.sponsored,
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
        : null,
      saved: Boolean(row.saved)
    }))
  }
}
