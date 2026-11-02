import 'server-only'

import { db } from '@/db'
import {
  mailMessagesTable,
  type MailAddress,
  type MailAttachmentMeta
} from '@/db/schema'
import { MAX_INBOX_QUERY_LENGTH } from '@/lib/inbox-path'
import { loadPage } from '@/lib/pagination'
import { and, count, desc, eq, sql } from 'drizzle-orm'
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
