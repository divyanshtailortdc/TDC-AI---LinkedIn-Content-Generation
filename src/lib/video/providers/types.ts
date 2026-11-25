import type { PlatformId } from '@/lib/platforms'

export interface RenderedVideo {
  bytes: Buffer
  mediaType: string
  seconds: number
  warnings: string[]
  /** Stored on the video's row: the look it was made in. */
  metadata?: Record<string, unknown>
}

/**
 * Makes a video on this server, in one call that takes a minute or two
 * (./recorder.ts). It runs after a response, or in the job pass, never
 * inside a request someone waits on.
 */
export interface VideoRecorder {
  /**
   * `prompt` is what was stored when the video was started; `platform` is
   * where it goes, whose posts' look it follows.
   */
  render(job: {
    prompt: string
    accountId: string
    platform: PlatformId
  }): Promise<RenderedVideo>
}
