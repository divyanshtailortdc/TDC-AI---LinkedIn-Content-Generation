import { schedulesTable } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type SchedulesDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/** Enabled schedules. */
export function findRunnableSchedules(database: SchedulesDb) {
  return database
    .select()
    .from(schedulesTable)
    .where(eq(schedulesTable.enabled, true))
}

/** `lastRunAt` equal to a value read earlier, or still unset. */
function lastRunIs(lastRunAt: Date | null) {
  return lastRunAt
    ? eq(schedulesTable.lastRunAt, lastRunAt)
    : isNull(schedulesTable.lastRunAt)
}

/**
 * Claims a schedule's slot: true only for the caller whose write lands.
 * `lastRunAt` becomes the slot's own time, the day it counts for.
 *
 * The update is conditional on `lastRunAt` still being the value that was read
 * when the schedule was found due. Two ticks (or two processes) that found the
 * same schedule both try; the first changes `lastRunAt`, so the second matches
 * no row and gets false instead of enqueueing a second run.
 *
 * `updatedAt` is left alone: it records when the user last saved the schedule,
 * which decides whether a slot that has already passed is theirs to run.
 */
export async function claimScheduleSlot(
  database: SchedulesDb,
  schedule: { id: string; lastRunAt: Date | null },
  slot: Date
): Promise<boolean> {
  const [claimed] = await database
    .update(schedulesTable)
    .set({ lastRunAt: slot })
    .where(
      and(eq(schedulesTable.id, schedule.id), lastRunIs(schedule.lastRunAt))
    )
    .returning({ id: schedulesTable.id })
  return Boolean(claimed)
}

/**
 * Gives a claimed slot back after the run could not be queued, so the next
 * tick tries again within the grace period. Only the claim of `slot` is
 * undone: a newer one is left alone.
 */
export async function releaseScheduleSlot(
  database: SchedulesDb,
  schedule: { id: string; lastRunAt: Date | null },
  slot: Date
): Promise<void> {
  await database
    .update(schedulesTable)
    .set({ lastRunAt: schedule.lastRunAt })
    .where(
      and(
        eq(schedulesTable.id, schedule.id),
        eq(schedulesTable.lastRunAt, slot)
      )
    )
}

/** What the Schedule page shows about the last attempt; null clears it. */
export async function recordScheduleOutcome(
  database: SchedulesDb,
  scheduleId: string,
  error: string | null
): Promise<void> {
  await database
    .update(schedulesTable)
    .set({ lastError: error })
    .where(eq(schedulesTable.id, scheduleId))
}
