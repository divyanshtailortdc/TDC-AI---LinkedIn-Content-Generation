import cron from 'node-cron'
import { db } from '@/db'
import { goalsTable } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { enqueueRun } from './queue'
import { RunInProgressError } from './run-guard'
import { claimScheduleSlot, findRunnableSchedules } from './schedule-claim'

declare global {
   
  var __schedulerRunning: boolean | undefined
}

/** True when `date` already falls on the same calendar day as `now`. */
function ranToday(date: Date | null, now: Date): boolean {
  if (!date) return false
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

export function startScheduler() {
  if (globalThis.__schedulerRunning) return
  globalThis.__schedulerRunning = true

  // Every 15 minutes, so a schedule set to 08:30 fires near 08:30 rather than
  // at the top of the hour.
  cron.schedule('*/15 * * * *', async () => {
    try {
      const activeSchedules = await findRunnableSchedules(db)

      const now = new Date()
      const currentDay = now.getDay()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()

      for (const sched of activeSchedules) {
        const allowedDays = (sched.daysOfWeek as number[]) || [1, 3, 5]
        if (!allowedDays.includes(currentDay)) continue

        const [hourPart, minutePart] = (sched.timeOfDay || '09:00').split(':')
        const scheduledMinutes =
          Number(hourPart) * 60 + Number(minutePart || '0')
        if (Number.isNaN(scheduledMinutes)) continue

        // Fire once the scheduled time has passed, within a 15-minute window.
        const elapsed = nowMinutes - scheduledMinutes
        if (elapsed < 0 || elapsed >= 15) continue

        // Without this a restart inside the window would enqueue a second run.
        if (ranToday(sched.lastRunAt, now)) continue

        // Claim the slot before enqueueing. Every `next dev` on the shared
        // database runs its own scheduler, so the claim is conditional: only
        // one caller's write lands, and a second tick or process cannot double
        // up. (A second claim used to follow this one; it could never match
        // the row the first had just written, so no scheduled run started.)
        if (!(await claimScheduleSlot(db, sched, now))) continue

        // A scheduled run serves every active goal, newest first; a paused
        // goal never steers a run.
        const activeGoals = await db
          .select({ id: goalsTable.id })
          .from(goalsTable)
          .where(
            and(
              eq(goalsTable.accountId, sched.accountId),
              eq(goalsTable.isActive, true)
            )
          )
          .orderBy(desc(goalsTable.createdAt))
        if (activeGoals.length === 0) {
          console.warn(
            `Skipped the scheduled run for account ${sched.accountId}: it has no active goals.`
          )
          continue
        }

        try {
          await enqueueRun({
            accountId: sched.accountId,
            goalIds: activeGoals.map(g => g.id),
            trigger: 'schedule'
          })
        } catch (err) {
          // A run already in progress is expected, not a failure.
          if (err instanceof RunInProgressError) {
            console.warn(
              `Skipped the scheduled run for account ${sched.accountId}: one is already in progress.`
            )
            continue
          }
          console.error(
            `Failed to enqueue scheduled run for account ${sched.accountId}:`,
            err
          )
        }
      }
    } catch (err) {
      console.error('Scheduler tick error:', err)
    }
  })
}
