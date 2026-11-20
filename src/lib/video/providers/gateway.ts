import 'server-only'

import {
  experimental_getVideoStatus as getVideoStatus,
  experimental_startVideo as startVideo,
  type JSONValue
} from 'ai'
import { gatewayClient } from '~/lib/ai'
import { readGatewayCost } from '~/lib/ai/usage'
import type { VideoModelInfo } from '../models'
import type { VideoJobStatus, VideoProvider, VideoRequest } from './types'

/**
 * Video through the Vercel AI Gateway, with the key every other model call
 * uses (AI_GATEWAY_API_KEY). Any Gateway video model works once it is listed
 * in ../models.ts: Veo, Kling, Seedance, Wan and others.
 */

/** Largest clip accepted from the provider: an 8-second 1080p clip is a few MB. */
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000
/**
 * A start or status call that hangs is given up after these, so it cannot
 * stall drafting or the job pass every other video waits on. A start answers
 * in seconds; the long timeout keeps a slow one from being cut off (and paid
 * for without a record).
 */
const START_TIMEOUT_MS = 90_000
const CHECK_TIMEOUT_MS = 30_000

type Warning = {
  type: string
  feature?: string
  details?: string
  message?: string
}

const describeWarnings = (warnings: readonly Warning[] | null | undefined) =>
  (warnings ?? []).map(
    w =>
      [w.feature, w.details ?? w.message].filter(Boolean).join(': ') || w.type
  )

/** The clip's bytes from a link, refused when it is not a video or too large. */
async function download(
  url: string
): Promise<{ bytes: Buffer; mediaType: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  })
  if (!response.ok) {
    throw new Error(
      `The video could not be downloaded (HTTP ${response.status}).`
    )
  }
  if (Number(response.headers.get('content-length')) > MAX_VIDEO_BYTES) {
    throw new Error('The video is too large to keep.')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_VIDEO_BYTES)
    throw new Error('The video is too large to keep.')
  const mediaType =
    response.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4'
  return { bytes, mediaType }
}

export function gatewayVideoProvider(model: VideoModelInfo): VideoProvider {
  const client = gatewayClient
  if (!client) {
    throw new Error('Video generation needs AI_GATEWAY_API_KEY.')
  }
  const videoModel = client.videoModel(model.id)

  return {
    name: 'gateway',
    model,

    async start(request: VideoRequest) {
      const result = await startVideo({
        model: videoModel,
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        resolution: model.resolutionParam[request.resolution],
        duration: request.seconds,
        fps: request.fps,
        generateAudio: request.audio,
        n: 1,
        // A retried start may start (and bill) a second clip when the first
        // one did start; a failed start is reported and the reviewer retries.
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(START_TIMEOUT_MS)
      })
      return {
        operation: result.operation,
        warnings: describeWarnings(result.warnings as Warning[])
      }
    },

    async check(operation: unknown): Promise<VideoJobStatus> {
      const result = await getVideoStatus(videoModel, {
        operation: operation as JSONValue,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(CHECK_TIMEOUT_MS)
      })
      if (result.status === 'pending') return { status: 'pending' }
      if (result.status === 'error') {
        return {
          status: 'failed',
          error: result.error || 'The video could not be made.'
        }
      }
      const first = result.videos[0]
      if (!first)
        return { status: 'failed', error: 'The video model returned no video.' }
      const video =
        first.type === 'url'
          ? await download(first.url)
          : {
              bytes:
                first.type === 'base64'
                  ? Buffer.from(first.data, 'base64')
                  : Buffer.from(first.data),
              mediaType: first.mediaType || 'video/mp4'
            }
      if (video.bytes.length === 0) {
        return {
          status: 'failed',
          error: 'The video model returned an empty video.'
        }
      }
      return {
        status: 'completed',
        video,
        costUsd: readGatewayCost(result.providerMetadata),
        warnings: describeWarnings(result.warnings as Warning[] | undefined)
      }
    }
  }
}
