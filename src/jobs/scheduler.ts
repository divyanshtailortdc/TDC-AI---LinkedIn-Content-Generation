import cron from 'node-cron'
import { db } from '@/db'
import { schedulesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { enqueueRun } from './queue'

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
      const activeSchedules = await db.query.schedulesTable.findMany({
        where: eq(schedulesTable.enabled, true)
      })

      const now = new Date()
      const currentDay = now.getDay()
      const nowMinutes = now.getHours() * 60 + now.getMinutes()

      for (const sched of activeSchedules) {
        const allowedDays = (sched.daysOfWeek as number[]) || [1, 3, 5]
        if (sched.frequency !== 'daily' && !allowedDays.includes(currentDay)) {
          continue
        }

        const [hourPart, minutePart] = (sched.timeOfDay || '09:00').split(':')
        const scheduledMinutes =
          Number(hourPart) * 60 + Number(minutePart || '0')
        if (Number.isNaN(scheduledMinutes)) continue

        // Fire once the scheduled time has passed, within a 15-minute window.
        const elapsed = nowMinutes - scheduledMinutes
        if (elapsed < 0 || elapsed >= 15) continue

        // Without this a restart inside the window would enqueue a second run.
        if (ranToday(sched.lastRunAt, now)) continue

        // Claim the slot before enqueueing so a duplicate tick cannot double up.
        const [claimed] = await db
          .update(schedulesTable)
          .set({ lastRunAt: now, updatedAt: new Date() })
          .where(eq(schedulesTable.id, sched.id))
          .returning()

        if (!claimed) continue

        try {
          await enqueueRun({
            accountId: sched.accountId,
            trigger: 'schedule'
          })
        } catch (err) {
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
