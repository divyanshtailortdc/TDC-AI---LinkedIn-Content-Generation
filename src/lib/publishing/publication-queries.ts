import { publicationsTable } from '@/db/schema'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { PublishingDb } from './connection'
import type { PublicationErrorCode, PublicationStatus } from './status'

/**
 * Small publication queries shared by connection.ts, rejectDraft and the
 * Schedule page, so each rule lives in one place. No imports from
 * publishing.ts, which imports connection.ts (that would be a cycle).
 */

/** Set just before the create request: from then the post may exist. */
export const postRequested = sql`${publicationsTable.metadata} ? 'postRequestedAt'`

/**
 * Calls off the publications that have not reached the platform: every
 * 'scheduled' row, and with `includeUnsentInFlight` also 'publishing' rows
 * whose create request was not sent yet (the worker holding one stops before
 * creating the post: its fenced write no longer matches). Returns how many.
 * `database` may be a transaction.
 */
export async function cancelPendingPublications(
  database: PublishingDb,
  scope: { userId?: string; draftId?: string },
  reason: { message: string; code: PublicationErrorCode },
  options: { includeUnsentInFlight?: boolean; now?: Date } = {}
): Promise<number> {
  const filters: SQL[] = []
  if (scope.userId) filters.push(eq(publicationsTable.userId, scope.userId))
  if (scope.draftId) filters.push(eq(publicationsTable.draftId, scope.draftId))
  if (filters.length === 0) throw new Error('cancelPendingPublications needs a scope.')

  const pending = options.includeUnsentInFlight
    ? sql`(${publicationsTable.status} = 'scheduled' or (${publicationsTable.status} = 'publishing' and not (${postRequested})))`
    : eq(publicationsTable.status, 'scheduled')

  const rows = await database
    .update(publicationsTable)
    .set({
      status: 'cancelled',
      lockedAt: null,
      error: reason.message,
      errorCode: reason.code,
      updatedAt: options.now ?? new Date()
    })
    .where(and(...filters, pending))
    .returning({ id: publicationsTable.id })
  return rows.length
}

/** Whether the post has a publication in one of `statuses` (default: in flight or out). */
export async function hasLivePublication(
  database: PublishingDb,
  draftId: string,
  statuses: readonly PublicationStatus[] = ['publishing', 'published']
): Promise<boolean> {
  const [row] = await database
    .select({ id: publicationsTable.id })
    .from(publicationsTable)
    .where(
      and(
        eq(publicationsTable.draftId, draftId),
        inArray(publicationsTable.status, [...statuses])
      )
    )
    .limit(1)
  return Boolean(row)
}
