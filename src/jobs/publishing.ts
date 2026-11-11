import { publishDeps } from '~/lib/publishing/config'
import { runDuePublications } from '~/lib/publishing/engine'

declare global {
  var __publishingPass: Promise<unknown> | undefined
}

/**
 * One pass of publishing, for every platform set up: scheduled and
 * auto-published posts that are due, and posts Buffer is still sending to X. Called every minute by the scheduler, and by /api/cron/jobs where
 * timers do not run. A pass still going when the next tick comes is joined,
 * not doubled; rows are claimed one by one anyway, so two processes (or two
 * `next dev`s on one database) cannot publish the same post.
 */
export function runPublishing(): Promise<unknown> {
  const deps = publishDeps()
  if (!deps) return Promise.resolve(null)
  globalThis.__publishingPass ??= runDuePublications(deps)
    .then(result => {
      if (
        result.recovered +
          result.confirmed +
          result.queued +
          result.published +
          result.failed >
        0
      ) {
        console.info('Publishing pass:', result)
      }
      return result
    })
    .catch(err => console.error('Publishing pass failed:', err))
    .finally(() => {
      globalThis.__publishingPass = undefined
    })
  return globalThis.__publishingPass
}
