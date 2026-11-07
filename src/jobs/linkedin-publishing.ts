import { publishDeps } from '~/lib/linkedin/config'
import { runDuePublications } from '~/lib/linkedin/publishing'

declare global {
  var __linkedinPublishingPass: Promise<unknown> | undefined
}

/**
 * One pass of LinkedIn publishing: scheduled and auto-published posts that
 * are due. Called every minute by the scheduler, and by /api/cron/jobs where
 * timers do not run. A pass still going when the next tick comes is joined,
 * not doubled; rows are claimed one by one anyway, so two processes (or two
 * `next dev`s on one database) cannot publish the same post.
 */
export function runLinkedInPublishing(): Promise<unknown> {
  const deps = publishDeps()
  if (!deps) return Promise.resolve(null)
  globalThis.__linkedinPublishingPass ??= runDuePublications(deps)
    .then(result => {
      if (
        result.recovered + result.queued + result.published + result.failed >
        0
      ) {
        console.info('LinkedIn publishing pass:', result)
      }
      return result
    })
    .catch(err => console.error('LinkedIn publishing pass failed:', err))
    .finally(() => {
      globalThis.__linkedinPublishingPass = undefined
    })
  return globalThis.__linkedinPublishingPass
}
