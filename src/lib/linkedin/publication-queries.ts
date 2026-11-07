import { linkedinPublicationsTable } from '@/db/schema'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { LinkedInDb } from './connection'
import type { PublicationErrorCode, PublicationStatus } from './status'

/**
 * Small publication queries shared by connection.ts, rejectDraft and the
 * Schedule page, so each rule lives in one place. No imports from
 * publishing.ts, which imports connection.ts (that would be a cycle).
 */

/** Set just before the create request: from then the post may exist. */
export const postRequested = sql`${linkedinPublicationsTable.metadata} ? 'postRequestedAt'`

/**
 * Calls off the publications that have not reached LinkedIn: every
 * 'scheduled' row, and with `includeUnsentInFlight` also 'publishing' rows
 * whose create request was not sent yet (the worker holding one stops before
 * creating the post: its fenced write no longer matches). Returns how many.
 * `database` may be a transaction.
 */
export async function cancelPendingPublications(
  database: LinkedInDb,
  scope: { userId?: string; draftId?: string },
  reason: { message: string; code: PublicationErrorCode },
  options: { includeUnsentInFlight?: boolean; now?: Date } = {}
): Promise<number> {
  const filters: SQL[] = []
  if (scope.userId) filters.push(eq(linkedinPublicationsTable.userId, scope.userId))
  if (scope.draftId) filters.push(eq(linkedinPublicationsTable.draftId, scope.draftId))
  if (filters.length === 0) throw new Error('cancelPendingPublications needs a scope.')

  const pending = options.includeUnsentInFlight
    ? sql`(${linkedinPublicationsTable.status} = 'scheduled' or (${linkedinPublicationsTable.status} = 'publishing' and not (${postRequested})))`
    : eq(linkedinPublicationsTable.status, 'scheduled')

  const rows = await database
    .update(linkedinPublicationsTable)
    .set({
      status: 'cancelled',
      lockedAt: null,
      error: reason.message,
      errorCode: reason.code,
      updatedAt: options.now ?? new Date()
    })
    .where(and(...filters, pending))
    .returning({ id: linkedinPublicationsTable.id })
  return rows.length
}

/** Whether the post has a publication in one of `statuses` (default: in flight or out). */
export async function hasLivePublication(
  database: LinkedInDb,
  draftId: string,
  statuses: readonly PublicationStatus[] = ['publishing', 'published']
): Promise<boolean> {
  const [row] = await database
    .select({ id: linkedinPublicationsTable.id })
    .from(linkedinPublicationsTable)
    .where(
      and(
        eq(linkedinPublicationsTable.draftId, draftId),
        inArray(linkedinPublicationsTable.status, [...statuses])
      )
    )
    .limit(1)
  return Boolean(row)
}
