import 'server-only'

import { db } from '@/db'
import {
  intelArticlesTable,
  intelMentionsTable,
  mailMessagesTable,
  type MailAddress,
  type MailAttachmentMeta
} from '@/db/schema'
import { MAX_INBOX_QUERY_LENGTH } from '@/lib/inbox-path'
import { loadPage } from '@/lib/pagination'
import { and, asc, count, desc, eq, sql } from 'drizzle-orm'
import type {
  ArticleStatus,
  DigestKind,
  ExtractionStatus
} from '~/lib/intel/status'
import { inboxSearchQuery } from '~/lib/mail/search'

/** Emails are one-line rows, so a page holds more of them than other lists. */
const INBOX_PAGE_SIZE = 20

export type InboxListItem = {
  id: string
  fromName: string | null
  fromAddress: string | null
  subject: string | null
  snippet: string | null
  receivedAt: Date
  hasAttachments: boolean
}

export type InboxMessage = {
  id: string
  fromName: string | null
  fromAddress: string | null
  toAddresses: MailAddress[]
  ccAddresses: MailAddress[]
  subject: string | null
  sentAt: Date | null
  receivedAt: Date
  textBody: string | null
  htmlBody: string | null
  attachments: MailAttachmentMeta[]
  truncated: boolean
}

const messages = mailMessagesTable

/** ?q= as the search box shows it. */
export function parseInboxQuery(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  return (raw ?? '').trim().slice(0, MAX_INBOX_QUERY_LENGTH)
}

/**
 * One page of the identity's emails, newest first, optionally matching a
 * search. Callers pass the signed-in user's own identity (requireIdentityId),
 * so it can only ever list theirs.
 */
export function loadInboxPage(
  accountId: string,
  { page, query }: { page: number; query: string }
) {
  const tsQuery = inboxSearchQuery(query)
  const where = and(
    eq(messages.accountId, accountId),
    tsQuery
      ? sql`${messages.searchVector} @@ to_tsquery('simple', ${tsQuery})`
      : undefined
  )
  return loadPage<InboxListItem>({
    page,
    pageSize: INBOX_PAGE_SIZE,
    count: async () => {
      const [row] = await db.select({ n: count() }).from(messages).where(where)
      return row?.n ?? 0
    },
    rows: (offset, limit) =>
      db
        .select({
          id: messages.id,
          fromName: messages.fromName,
          fromAddress: messages.fromAddress,
          subject: messages.subject,
          snippet: messages.snippet,
          receivedAt: messages.receivedAt,
          hasAttachments: sql<boolean>`jsonb_array_length(${messages.attachments}) > 0`
        })
        .from(messages)
        .where(where)
        .orderBy(desc(messages.receivedAt), desc(messages.id))
        .offset(offset)
        .limit(limit)
  })
}

/** One of the identity's emails in full, or null for a missing or foreign id. */
export async function loadInboxMessage(
  accountId: string,
  messageId: string
): Promise<InboxMessage | null> {
  const [row] = await db
    .select({
      id: messages.id,
      fromName: messages.fromName,
      fromAddress: messages.fromAddress,
      toAddresses: messages.toAddresses,
      ccAddresses: messages.ccAddresses,
      subject: messages.subject,
      sentAt: messages.sentAt,
      receivedAt: messages.receivedAt,
      textBody: messages.textBody,
      htmlBody: messages.htmlBody,
      attachments: messages.attachments,
      truncated: messages.truncated
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.accountId, accountId)))
    .limit(1)
  return row ?? null
}

/** A story extracted from an email, with what was read of its article. */
export type InboxStory = {
  id: string
  headline: string
  blurb: string | null
  url: string | null
  sponsored: boolean
  article: {
    status: ArticleStatus
    title: string | null
    siteName: string | null
    publishedAt: Date | null
    summary: string | null
    /** Its first few claims, each backed by a verbatim quote. */
    claims: string[]
    /** Why it was skipped or failed. */
    note: string | null
  } | null
}

/** What extraction found in an email (src/lib/intel), for the reading pane. */
export type InboxInsights = {
  status: ExtractionStatus
  error: string | null
  kind: DigestKind | null
  summary: string | null
  topics: string[]
  stories: InboxStory[]
  /**
   * The newer version of this issue (a correction, a resend), which carries
   * the stories both have; null while this is the newest.
   */
  newerVersion: { subject: string | null; receivedAt: Date } | null
  /** Who sent it, and whether the user unsubscribed from them; null without an address. */
  sender: { address: string; unsubscribed: boolean } | null
}

const SHOWN_CLAIMS = 3

/** One of the identity's emails' extraction, or null for a missing or foreign id. */
export async function loadInboxInsights(
  accountId: string,
  messageId: string
): Promise<InboxInsights | null> {
  const [message] = await db
    .select({
      status: messages.extractionStatus,
      error: messages.extractionError,
      kind: messages.digestKind,
      summary: messages.digestSummary,
      topics: messages.digestTopics,
      supersededById: messages.supersededById,
      fromAddress: messages.fromAddress,
      senderUnsubscribedAt: messages.senderUnsubscribedAt
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.accountId, accountId)))
    .limit(1)
  if (!message) return null
  const { supersededById, fromAddress, senderUnsubscribedAt, ...extraction } =
    message

  const [newerVersion] = supersededById
    ? await db
        .select({ subject: messages.subject, receivedAt: messages.receivedAt })
        .from(messages)
        .where(
          and(
            eq(messages.id, supersededById),
            eq(messages.accountId, accountId)
          )
        )
        .limit(1)
    : []

  const mentions = intelMentionsTable
  const articles = intelArticlesTable
  const rows = await db
    .select({
      id: mentions.id,
      headline: mentions.headline,
      blurb: mentions.blurb,
      url: mentions.url,
      sponsored: mentions.isSponsored,
      articleStatus: articles.status,
      title: articles.title,
      siteName: articles.siteName,
      publishedAt: articles.publishedAt,
      articleSummary: articles.summary,
      claims: articles.keyClaims,
      note: articles.lastError
    })
    .from(mentions)
    .leftJoin(articles, eq(articles.id, mentions.articleId))
    .where(
      and(eq(mentions.messageId, messageId), eq(mentions.accountId, accountId))
    )
    .orderBy(asc(mentions.position))

  return {
    ...extraction,
    newerVersion: newerVersion ?? null,
    sender: fromAddress
      ? { address: fromAddress, unsubscribed: senderUnsubscribedAt !== null }
      : null,
    stories: rows.map(row => ({
      id: row.id,
      headline: row.headline,
      blurb: row.blurb,
      url: row.url,
      sponsored: row.sponsored,
      article: row.articleStatus
        ? {
            status: row.articleStatus,
            title: row.title,
            siteName: row.siteName,
            publishedAt: row.publishedAt,
            summary: row.articleSummary,
            claims: (row.claims ?? [])
              .slice(0, SHOWN_CLAIMS)
              .map(claim => claim.claim),
            note: row.note
          }
        : null
    }))
  }
}
