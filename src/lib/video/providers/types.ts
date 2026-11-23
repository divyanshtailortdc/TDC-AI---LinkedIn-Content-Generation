import type { VideoModelInfo, VideoResolution } from '../models'

/**
 * What every video provider does: start a clip and say how it stands. Video
 * takes minutes, longer than a serverless request may run, so a provider
 * never waits for one: `start` returns a reference that is stored, and
 * `check` is asked about it on later requests, from any instance.
 */

export interface VideoRequest {
  prompt: string
  aspectRatio: '9:16'
  resolution: VideoResolution
  seconds: number
  fps: number
  audio: boolean
}

export interface StartedVideo {
  /** The provider's opaque, JSON-safe reference to the job. */
  operation: unknown
  /** Settings the provider ignored or changed, as it reported them. */
  warnings: string[]
}

export type VideoJobStatus =
  | { status: 'pending' }
  | {
      status: 'completed'
      video: { bytes: Buffer; mediaType: string }
      /** What the provider billed, when it said; null to fall back on the estimate. */
      costUsd: number | null
      warnings: string[]
    }
  | { status: 'failed'; error: string }

export interface VideoProvider {
  /** Stored on each video: which provider to ask about it later. */
  name: VideoModelInfo['provider']
  model: VideoModelInfo
  start(request: VideoRequest): Promise<StartedVideo>
  check(operation: unknown): Promise<VideoJobStatus>
}
