import cron from 'node-cron'
import { db } from '@/db'
import { schedulesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { enqueueRun } from './queue'

declare global {
  // eslint-disable-next-line no-var
  var __schedulerRunning: boolean | undefined
}

export function startScheduler() {
  if (globalThis.__schedulerRunning) {
    return
  }

  globalThis.__schedulerRunning = true

  // Check every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    try {
      const activeSchedules = await db.query.schedulesTable.findMany({
        where: eq(schedulesTable.enabled, true)
      })

      const now = new Date()
      const currentDay = now.getDay() // 0 = Sun, 1 = Mon, etc.
      const currentHour = now.getHours().toString().padStart(2, '0')
      const currentMinute = now.getMinutes().toString().padStart(2, '0')
      const currentTime = `${currentHour}:${currentMinute}`

      for (const sched of activeSchedules) {
        const allowedDays = (sched.daysOfWeek as number[]) || [1, 3, 5]
        if (allowedDays.includes(currentDay) && sched.timeOfDay.startsWith(currentHour)) {
          await enqueueRun({
            accountId: sched.accountId,
            trigger: 'schedule'
          })

          await db
            .update(schedulesTable)
            .set({ lastRunAt: now })
            .where(eq(schedulesTable.id, sched.id))
        }
      }
    } catch (err) {
      console.error('Scheduler cron tick error:', err)
    }
  })
}
