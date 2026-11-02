import 'server-only'

import { db } from '@/db'
import { mailSyncStateTable } from '@/db/schema'
import { and, eq, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { MAIL_SYNC_SETTINGS } from './settings'

/**
 * The app's place in the mailbox it reads: the IMAP cursor, the lease that
 * keeps one sync pass at a time across processes, and how the last pass went.
 * One row per mailbox (MAIL_IMAP_USER), created on first use.
 */

const state = mailSyncStateTable

/**
 * A pass's hold on the mailbox. `until` doubles as the token: every write the
 * pass makes is conditional on the row still carrying it, so a pass that lost
 * its lease (it overran and another took over) changes nothing.
 */
export type SyncLease = { mailboxId: string; until: Date }

/** Thrown when a pass no longer holds the mailbox; it stops quietly. */
export class LeaseLostError extends Error {
  constructor() {
    super('The mailbox is no longer held by this sync pass.')
    this.name = 'LeaseLostError'
  }
}

export const holdsLease = (lease: SyncLease) =>
  and(eq(state.id, lease.mailboxId), eq(state.syncLeaseUntil, lease.until))

export const nextLeaseEnd = () =>
  new Date(Date.now() + MAIL_SYNC_SETTINGS.leaseMs)

async function ensureMailbox(mailbox: string) {
  await db
    .insert(state)
    .values({ mailbox })
    .onConflictDoNothing({ target: state.mailbox })
}

/**
 * Claims the mailbox for one pass when it is due (its interval passed, or
 * Refresh was pressed) and no other pass holds it: its row and the lease, or
 * null. Conditional, so of two processes ticking together only one gets it.
 */
export async function claimSyncLease(mailbox: string) {
  await ensureMailbox(mailbox)
  const now = new Date()
  const until = nextLeaseEnd()
  const [row] = await db
    .update(state)
    .set({ syncLeaseUntil: until })
    .where(
      and(
        eq(state.mailbox, mailbox),
        or(isNull(state.syncLeaseUntil), lt(state.syncLeaseUntil, now)),
        or(lte(state.nextSyncAt, now), isNotNull(state.syncRequestedAt))
      )
    )
    .returning()
  return row
    ? { row, lease: { mailboxId: row.id, until } satisfies SyncLease }
    : null
}

/** "Refresh": the next tick syncs without waiting for the interval. */
export async function requestMailSync(mailbox: string) {
  const now = new Date()
  await db
    .insert(state)
    .values({ mailbox, syncRequestedAt: now })
    .onConflictDoUpdate({
      target: state.mailbox,
      set: { syncRequestedAt: now }
    })
}

export type MailSyncStatus = {
  lastSyncedAt: Date | null
  lastError: string | null
  /** A pass is running, or one was asked for and has not started yet. */
  syncing: boolean
}

/** How the mailbox's sync stands, for the inbox. */
export async function readMailSyncStatus(
  mailbox: string
): Promise<MailSyncStatus> {
  const [row] = await db
    .select({
      lastSyncedAt: state.lastSyncedAt,
      lastError: state.lastError,
      syncLeaseUntil: state.syncLeaseUntil,
      syncRequestedAt: state.syncRequestedAt
    })
    .from(state)
    .where(eq(state.mailbox, mailbox))
    .limit(1)
  const now = new Date()
  return {
    lastSyncedAt: row?.lastSyncedAt ?? null,
    lastError: row?.lastError ?? null,
    syncing: Boolean(row?.syncRequestedAt) || (row?.syncLeaseUntil ?? now) > now
  }
}

/** A pass that worked. A backlog (more mail than one pass takes) is due again at once. */
export async function recordSyncSuccess(
  lease: SyncLease,
  { startedAt, backlog }: { startedAt: Date; backlog: boolean }
) {
  const now = new Date()
  await db
    .update(state)
    .set({
      syncLeaseUntil: null,
      lastSyncedAt: now,
      lastError: null,
      consecutiveFailures: 0,
      nextSyncAt: backlog
        ? now
        : new Date(now.getTime() + MAIL_SYNC_SETTINGS.intervalMs),
      // A Refresh pressed while this pass ran still gets its own pass.
      syncRequestedAt: sql`case when ${state.syncRequestedAt} <= ${startedAt.toISOString()}::timestamptz then null else ${state.syncRequestedAt} end`,
      updatedAt: now
    })
    .where(holdsLease(lease))
}

/** How long to wait after `failures` failed passes in a row. */
function syncBackoffMs(failures: number) {
  return Math.min(
    MAIL_SYNC_SETTINGS.backoffBaseMs * 2 ** Math.max(0, failures - 1),
    MAIL_SYNC_SETTINGS.backoffMaxMs
  )
}

/** A pass that failed: backs off before the next one. */
export async function recordSyncFailure(
  lease: SyncLease,
  { message, failures }: { message: string; failures: number }
) {
  await db
    .update(state)
    .set({
      syncLeaseUntil: null,
      lastError: message,
      consecutiveFailures: failures,
      nextSyncAt: new Date(Date.now() + syncBackoffMs(failures)),
      syncRequestedAt: null,
      updatedAt: new Date()
    })
    .where(holdsLease(lease))
}
