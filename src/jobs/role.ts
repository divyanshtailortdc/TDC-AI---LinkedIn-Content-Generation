import { env } from '~/env'

/**
 * Whether this process runs the job worker and the scheduler. Production can
 * give them a service of their own (APP_ROLE=worker), so a run's work never
 * holds up page requests; the web service (APP_ROLE=web) then only queues runs.
 * By default, and in `next dev`, one process does both.
 */
export function runsJobsHere() {
  return env.APP_ROLE !== 'web'
}

/**
 * Whether this process polls for jobs on timers (the worker, recovery and the
 * scheduler). Not on Vercel: its functions are frozen between requests, so
 * the timers fired all at once on waking, on connections that had gone stale,
 * and timed out (CONNECT_TIMEOUT in the logs). There, runs start with the
 * request that queues them (`after`), and /api/cron/jobs does the rest when
 * called. `VERCEL` is set by Vercel itself.
 */
export function runsJobTimers() {
  return runsJobsHere() && !process.env.VERCEL
}
