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

/** A provider that makes the clip elsewhere, started now and asked about later. */
export interface RemoteVideoProvider {
  kind: 'remote'
  /** Stored on each video: which provider to ask about it later. */
  name: VideoModelInfo['provider']
  model: VideoModelInfo
  start(request: VideoRequest): Promise<StartedVideo>
  check(operation: unknown): Promise<VideoJobStatus>
}

export interface RenderedVideo {
  bytes: Buffer
  mediaType: string
  seconds: number
  warnings: string[]
}

/**
 * A provider that makes the video on this server, in one call that takes a
 * minute or two (the recorder, ./recorder.ts). It runs after a response, or
 * in the job pass, never inside a request someone waits on.
 */
export interface LocalVideoProvider {
  kind: 'local'
  name: VideoModelInfo['provider']
  model: VideoModelInfo
  /** `prompt` is what was stored when the video was started. */
  render(job: { prompt: string; accountId: string }): Promise<RenderedVideo>
}

export type VideoProvider = RemoteVideoProvider | LocalVideoProvider
