import { finishPendingVideos } from '~/lib/video/post-video'

declare global {
  var __videoPass: Promise<unknown> | undefined
}

/**
 * One pass over the videos not yet recorded (src/lib/video): each is
 * recorded and stored on its post. Drafting starts a Reel's or a Short's
 * video on its own, so it must land even when nobody opens the post. Called
 * every minute by the scheduler, and by /api/cron/jobs where timers do not
 * run. A pass still going is joined, not doubled; each video is claimed
 * before it is recorded anyway.
 */
export function runVideoFinishing(): Promise<unknown> {
  globalThis.__videoPass ??= finishPendingVideos()
    .catch(err => console.error('Video pass failed:', err))
    .finally(() => {
      globalThis.__videoPass = undefined
    })
  return globalThis.__videoPass
}
