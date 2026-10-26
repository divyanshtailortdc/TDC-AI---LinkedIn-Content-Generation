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
