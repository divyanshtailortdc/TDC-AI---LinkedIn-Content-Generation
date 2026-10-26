import { markDataChanged } from '@/components/refresh-on-back'
import { showToast } from '@/components/toast-notification'
import type { PostDetail } from './posts-client'

/**
 * The image generation running for a post, kept outside the posts page so
 * that leaving the page does not stop it. The request carries on while the
 * reviewer is elsewhere in the app; the server saves the image as usual; and
 * a posts page opened meanwhile picks the job up again, showing its progress
 * and the image when it lands. With no posts page open, a toast says how it
 * went. One job runs at a time, as on the page.
 *
 * Closing or reloading the browser tab still ends the request, and with it a
 * generation the server can stop.
 */

export type MediaJobOutcome =
  | { postId: string; status: 'created'; media: NonNullable<PostDetail['media']> }
  | { postId: string; status: 'failed'; error: string }
  | { postId: string; status: 'stopped' }

export interface MediaJob {
  postId: string
  /** What the progress panel says while it runs. */
  loadingText: string
  /** Stops it; null for a job the server cannot stop (a server action). */
  controller: AbortController | null
  done: Promise<MediaJobOutcome>
}

let active: MediaJob | null = null
let pagesOpen = 0

/** The job running now, if any. */
export const currentMediaJob = () => active

/**
 * Starts `run` as the running job. It never rejects: failures come back as a
 * 'failed' outcome, so every page that waits on it can show them.
 */
export function startMediaJob(
  job: Omit<MediaJob, 'done'>,
  run: () => Promise<MediaJobOutcome>
): MediaJob {
  const done = run().catch(
    (err: unknown): MediaJobOutcome => ({
      postId: job.postId,
      status: 'failed',
      error: err instanceof Error ? err.message : 'The image could not be made.'
    })
  )
  const entry: MediaJob = { ...job, done }
  active = entry
  void done.then(outcome => {
    if (outcome.status === 'created') markDataChanged()
    if (active === entry) active = null
    if (pagesOpen === 0) announce(outcome)
  })
  return entry
}

/** Counts an open posts page; the returned function uncounts it. */
export function trackPostsPage(): () => void {
  pagesOpen++
  return () => {
    pagesOpen--
  }
}

/** How a job that finished while no posts page was open went. */
function announce(outcome: MediaJobOutcome) {
  if (outcome.status === 'created') {
    showToast({
      type: 'success',
      title: 'Image ready',
      message: 'The new image is on your post in Posts.'
    })
  } else if (outcome.status === 'failed') {
    showToast({ type: 'error', title: 'Image not generated', message: outcome.error })
  }
}
