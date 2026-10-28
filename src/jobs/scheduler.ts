import cron from 'node-cron'
import { db } from '@/db'
import { goalsTable, schedulesTable } from '@/db/schema'
import { dueSlot, WEEKDAY_NAMES } from '@/lib/schedule-time'
import { and, desc, eq } from 'drizzle-orm'
import { enqueueRun } from './queue'
import { MAX_GOALS_PER_RUN } from './run-goals'
import { RunInProgressError } from './run-guard'
import {
  claimScheduleSlot,
  findRunnableSchedules,
  recordScheduleOutcome,
  releaseScheduleSlot
} from './schedule-claim'

declare global {
   
  var __schedulerRunning: boolean | undefined
}

type Schedule = typeof schedulesTable.$inferSelect

/**
 * The goals a scheduled run serves on one weekday: the ones the schedule names
 * for that day (every active goal when it names none) that still exist and are
 * active, newest first.
 */
async function scheduledGoalIds(
  schedule: Schedule,
  weekday: number
): Promise<string[]> {
  const goals = await db
    .select({ id: goalsTable.id })
    .from(goalsTable)
    .where(
      and(
        eq(goalsTable.accountId, schedule.accountId),
        eq(goalsTable.isActive, true)
      )
    )
    .orderBy(desc(goalsTable.createdAt))
  const picked = schedule.dayGoals?.[String(weekday)]
  return goals
    .map(g => g.id)
    .filter(id => !picked || picked.includes(id))
    .slice(0, MAX_GOALS_PER_RUN)
}

/**
 * Starts a run for one schedule if its slot is due. This only generates
 * ideas: they wait on Ideas for review, and nothing is written into a post or
 * published until the user asks.
 */
export async function runScheduleIfDue(sched: Schedule, now = new Date()) {
  try {
    const due = dueSlot(sched, now)
    if (!due) return

    // Claim the slot before enqueueing. Every `next dev` on the shared
    // database runs its own scheduler, so the claim is conditional: only one
    // caller's write lands, and a second tick or process cannot double up.
    // The slot, not the tick, is recorded: a late-evening slot ticked after
    // midnight must still count for its own day (see dueSlot).
    if (!(await claimScheduleSlot(db, sched, due.slot))) return

    let goalIds: string[]
    try {
      goalIds = await scheduledGoalIds(sched, due.weekday)
      if (goalIds.length > 0) {
        await enqueueRun({
          accountId: sched.accountId,
          goalIds,
          trigger: 'schedule'
        })
      }
    } catch (err) {
      // The slot goes back, so the next tick retries until the grace period
      // ends. A run already in progress is expected, not a failure.
      await releaseScheduleSlot(db, sched, due.slot)
      if (err instanceof RunInProgressError) {
        console.warn(
          `Delayed the scheduled run for account ${sched.accountId}: one is already in progress.`
        )
        return
      }
      console.error(
        `Failed to enqueue scheduled run for account ${sched.accountId}:`,
        err
      )
      await recordScheduleOutcome(
        db,
        sched.id,
        'The last scheduled run could not be started. It will try again shortly.'
      )
      return
    }

    // From here the run is queued (or deliberately skipped), so a failure
    // below must not give the slot back: the next tick would queue it again.
    if (goalIds.length === 0) {
      // Not worth retrying: it stays so until the user picks a goal.
      const message = `No goals to write for on ${WEEKDAY_NAMES[due.weekday]}: pick at least one active goal for that day.`
      console.warn(
        `Skipped the scheduled run for account ${sched.accountId}: ${message}`
      )
      await recordScheduleOutcome(db, sched.id, message)
      return
    }
    console.info(
      `Queued the scheduled run for account ${sched.accountId} (${WEEKDAY_NAMES[due.weekday]} ${due.slot.toISOString()}).`
    )
    await recordScheduleOutcome(db, sched.id, null)
  } catch (err) {
    // One schedule's failure must not stop the others.
    console.error(`Scheduler failed for account ${sched.accountId}:`, err)
  }
}

/** Every enabled schedule whose slot is due. */
export async function runDueSchedules(now = new Date()) {
  for (const sched of await findRunnableSchedules(db)) {
    await runScheduleIfDue(sched, now)
  }
}

export function startScheduler() {
  if (globalThis.__schedulerRunning) return
  globalThis.__schedulerRunning = true

  // Every 5 minutes: a slot is due for two hours after its time (see
  // dueSlot), so a run that could not start is retried on a later tick.
  cron.schedule(
    '*/5 * * * *',
    async () => {
      try {
        await runDueSchedules()
      } catch (err) {
        console.error('Scheduler tick error:', err)
      }
    },
    // node-cron drops a tick whose timer fires over a second late, as it does
    // while a run's work holds the event loop. A late tick is still right to
    // run: dueSlot decides from the time it actually runs.
    { missedExecutionTolerance: 60_000 }
  )
  console.info('Scheduler started: checking schedules every 5 minutes.')
}
