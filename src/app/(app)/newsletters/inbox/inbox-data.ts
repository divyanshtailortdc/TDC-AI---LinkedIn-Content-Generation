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
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type {
  ArticleStatus,
  DigestKind,
  ExtractionStatus
} from '~/lib/intel/status'
import { inboxSearchQuery } from '~/lib/mail/search'
import type { InboxFilter } from './inbox-status'

export type InboxListItem = {
  id: string
  fromName: string | null
  fromAddress: string | null
  subject: string | null
  snippet: string | null
  receivedAt: Date
  hasAttachments: boolean
  // What extraction made of it, for the list's status chip.
  extractionStatus: ExtractionStatus
  extractionError: string | null
  digestKind: DigestKind | null
  /** The digest's one-line summary, shown instead of the snippet when there is one. */
  digestSummary: string | null
  /** A newer version of the issue carries its stories. */
  superseded: boolean
  storyCount: number
}

/** What the identity's inbox has collected so far, for the top of the page. */
export type InboxStats = {
  received: number
  newsletters: number
  stories: number
  /** Waiting to be read (including retries later on), or being read. */
  processing: number
  /** Being read, or due to be now: the list refreshes while this is above 0. */
  due: number
  failed: number
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

/** The emails a filter keeps; undefined for all of them. */
function filterCondition(filter: InboxFilter | null) {
  switch (filter) {
    case 'newsletters':
      return eq(messages.digestKind, 'newsletter')
    case 'processing':
      return inArray(messages.extractionStatus, ['pending', 'processing'])
    case 'failed':
      return eq(messages.extractionStatus, 'failed')
    default:
      return undefined
  }
}

/**
 * One page of the identity's emails, newest first, optionally matching a
 * search and a filter. Callers pass the signed-in user's own identity
 * (requireIdentityId), so it can only ever list theirs.
 */
export function loadInboxPage(
  accountId: string,
  {
    page,
    query,
    filter = null
  }: { page: number; query: string; filter?: InboxFilter | null }
) {
  const tsQuery = inboxSearchQuery(query)
  const where = and(
    eq(messages.accountId, accountId),
    tsQuery
      ? sql`${messages.searchVector} @@ to_tsquery('simple', ${tsQuery})`
      : undefined,
    filterCondition(filter)
  )
  const mentions = intelMentionsTable
  return loadPage<InboxListItem>({
    page,
    pageSize: PAGE_SIZE,
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
          hasAttachments: sql<boolean>`jsonb_array_length(${messages.attachments}) > 0`,
          extractionStatus: messages.extractionStatus,
          extractionError: messages.extractionError,
          digestKind: messages.digestKind,
          digestSummary: messages.digestSummary,
          superseded: sql<boolean>`${messages.supersededById} is not null`,
          // A page is ten emails; each count is one probe of the
          // (message_id, position) index.
          storyCount:
            sql<number>`(select count(*) from ${mentions} where ${mentions.messageId} = ${messages.id} and ${mentions.accountId} = ${messages.accountId})`.mapWith(
              Number
            )
        })
        .from(messages)
        .where(where)
        .orderBy(desc(messages.receivedAt), desc(messages.id))
        .offset(offset)
        .limit(limit)
  })
}

/** Where an email's extraction stands, for the inbox's poll (pollInbox). */
export type InboxProgress = {
  id: string
  extractionStatus: ExtractionStatus
  digestKind: DigestKind | null
  storyCount: number
}

/**
 * Where the listed emails stand: a few ids from the page, only the
 * identity's own (any other id is simply not found).
 */
export function loadInboxProgress(
  accountId: string,
  messageIds: string[]
): Promise<InboxProgress[]> {
  if (messageIds.length === 0) return Promise.resolve([])
  const mentions = intelMentionsTable
  return db
    .select({
      id: messages.id,
      extractionStatus: messages.extractionStatus,
      digestKind: messages.digestKind,
      storyCount:
        sql<number>`(select count(*) from ${mentions} where ${mentions.messageId} = ${messages.id} and ${mentions.accountId} = ${messages.accountId})`.mapWith(
          Number
        )
    })
    .from(messages)
    .where(
      and(eq(messages.accountId, accountId), inArray(messages.id, messageIds))
    )
}

/**
 * The figures at the top of the inbox, in one pass over the identity's
 * emails, with its stories counted alongside.
 */
export async function loadInboxStats(accountId: string): Promise<InboxStats> {
  const mentions = intelMentionsTable
  const [row] = await db
    .select({
      received: count(),
      newsletters:
        sql<number>`count(*) filter (where ${messages.digestKind} = 'newsletter')`.mapWith(
          Number
        ),
      processing:
        sql<number>`count(*) filter (where ${messages.extractionStatus} in ('pending', 'processing'))`.mapWith(
          Number
        ),
      due: sql<number>`count(*) filter (where ${messages.extractionStatus} = 'processing' or (${messages.extractionStatus} = 'pending' and ${messages.extractionNextAt} <= now()))`.mapWith(
        Number
      ),
      failed:
        sql<number>`count(*) filter (where ${messages.extractionStatus} = 'failed')`.mapWith(
          Number
        ),
      stories:
        sql<number>`(select count(*) from ${mentions} where ${mentions.accountId} = ${accountId})`.mapWith(
          Number
        )
    })
    .from(messages)
    .where(eq(messages.accountId, accountId))
  return (
    row ?? {
      received: 0,
      newsletters: 0,
      stories: 0,
      processing: 0,
      due: 0,
      failed: 0
    }
  )
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
