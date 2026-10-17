import { runsTable } from '@/db/schema'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type RunsDb = PgDatabase<PostgresJsQueryResultHKT, any, any>
type NewRun = typeof runsTable.$inferInsert

/** Thrown when an identity already has a run in progress. */
export class RunInProgressError extends Error {
  constructor() {
    super(
      'A run is already in progress for this identity. Wait for it to finish, then start another.'
    )
    this.name = 'RunInProgressError'
  }
}

/** The advisory lock that serialises run creation for one identity. */
export function runLockKey(accountId: string) {
  return `run:${accountId}`
}

/**
 * Inserts a run unless the identity already has one queued or in progress.
 *
 * Two runs for one identity read the same history, so they propose the same
 * ideas. The check and the insert share a transaction holding an advisory lock
 * on the identity, so two requests arriving together cannot both pass the
 * check: the second waits, then sees the first.
 */
export async function insertRunUnlessActive(database: RunsDb, run: NewRun) {
  return database.transaction(async tx => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${runLockKey(run.accountId)}))`
    )
    const [active] = await tx
      .select({ id: runsTable.id })
      .from(runsTable)
      .where(
        and(
          eq(runsTable.accountId, run.accountId),
          inArray(runsTable.status, ACTIVE_RUN_STATUSES)
        )
      )
      .limit(1)
    if (active) throw new RunInProgressError()

    const [inserted] = await tx.insert(runsTable).values(run).returning()
    return inserted
  })
}
