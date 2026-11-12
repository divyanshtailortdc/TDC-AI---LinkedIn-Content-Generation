import { publicationsTable } from '@/db/schema'
import type { PlatformId } from '@/lib/platforms'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import type { PublishingDb } from './connection'
import type { PublicationErrorCode, PublicationStatus } from './status'

/**
 * Small publication queries shared by connection.ts, rejectDraft and the
 * Schedule page, so each rule lives in one place. No imports from
 * publishing.ts, which imports connection.ts (that would be a cycle).
 */

/**
 * Set just before the create request: from then the post may exist (and a
 * row still 'publishing' with its post id is waiting for the platform to
 * confirm it, see confirmPendingPublications).
 */
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
  scope: { accountId?: string; draftId?: string; platform?: PlatformId },
  reason: { message: string; code: PublicationErrorCode },
  options: { includeUnsentInFlight?: boolean; now?: Date } = {}
): Promise<number> {
  const filters: SQL[] = []
  if (scope.accountId) filters.push(eq(publicationsTable.accountId, scope.accountId))
  if (scope.draftId) filters.push(eq(publicationsTable.draftId, scope.draftId))
  if (filters.length === 0) throw new Error('cancelPendingPublications needs a scope.')
  // Narrows an identity's scope to one platform (a disconnect of X leaves LinkedIn's).
  if (scope.platform) filters.push(eq(publicationsTable.platform, scope.platform))

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
