import { timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import { env } from '~/env'
import { recoverAbandonedDrafting } from '~/jobs/drafting-queue'
import { runsJobsHere } from '~/jobs/role'
import { runDueSchedules } from '~/jobs/scheduler'
import { processQueuedRuns } from '~/jobs/worker'
import { recoverInterruptedRuns } from '~/lib/ai/run-lifecycle'

/**
 * One pass of the job timers, for hosts where they do not run (Vercel; see
 * runsJobTimers): fails runs whose process died, starts the runs of due
 * schedules, runs queued runs, and resumes abandoned drafting. Call it every
 * few minutes from a scheduler with `Authorization: Bearer <CRON_SECRET>`;
 * Vercel Cron sends that header itself. A schedule's slot stays due for two
 * hours, so a late call still starts it.
 */

function authorized(request: Request) {
  if (!env.CRON_SECRET) return false
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`)
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  // A separate worker service (APP_ROLE=web here) does all of this itself.
  if (!runsJobsHere()) return Response.json({ success: true, skipped: true })

  const recovered = await recoverInterruptedRuns()
  await runDueSchedules()

  // The runs and drafts take minutes: they continue after the response, and
  // `after` keeps the function alive until they finish.
  after(() =>
    Promise.all([
      processQueuedRuns().catch(err => console.error('Cron run error:', err)),
      recoverAbandonedDrafting().catch(err =>
        console.error('Drafting recovery error:', err)
      )
    ])
  )

  return Response.json({ success: true, recoveredRuns: recovered.length })
}
