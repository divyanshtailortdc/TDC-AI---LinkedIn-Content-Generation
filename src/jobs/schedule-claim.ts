import { accountsTable, schedulesTable } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type SchedulesDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/** Enabled schedules of identities that are still active. */
export async function findRunnableSchedules(database: SchedulesDb) {
  const rows = await database
    .select({ schedule: schedulesTable })
    .from(schedulesTable)
    .innerJoin(accountsTable, eq(accountsTable.id, schedulesTable.accountId))
    .where(
      and(eq(schedulesTable.enabled, true), eq(accountsTable.isActive, true))
    )
  return rows.map(row => row.schedule)
}

/**
 * Claims a schedule's slot: true only for the caller whose write lands.
 *
 * The update is conditional on `lastRunAt` still being the value that was read
 * when the schedule was found due. Two ticks (or two processes) that found the
 * same schedule both try; the first changes `lastRunAt`, so the second matches
 * no row and gets false instead of enqueueing a second run.
 */
export async function claimScheduleSlot(
  database: SchedulesDb,
  schedule: { id: string; lastRunAt: Date | null },
  now: Date
): Promise<boolean> {
  const [claimed] = await database
    .update(schedulesTable)
    .set({ lastRunAt: now, updatedAt: now })
    .where(
      and(
        eq(schedulesTable.id, schedule.id),
        schedule.lastRunAt
          ? eq(schedulesTable.lastRunAt, schedule.lastRunAt)
          : isNull(schedulesTable.lastRunAt)
      )
    )
    .returning({ id: schedulesTable.id })
  return Boolean(claimed)
}
