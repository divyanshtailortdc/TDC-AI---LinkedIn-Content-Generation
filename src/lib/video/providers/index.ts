import 'server-only'

import { env } from '~/env'
import { hasAIGateway } from '~/lib/ai'
import { DEFAULT_VIDEO_MODEL_ID, VIDEO_MODELS, videoModelInfo } from '../models'
import { gatewayVideoProvider } from './gateway'
import { recorderVideoProvider } from './recorder'
import type { VideoProvider } from './types'

export type {
  LocalVideoProvider,
  RemoteVideoProvider,
  VideoJobStatus,
  VideoProvider,
  VideoRequest
} from './types'

/**
 * The provider videos are made with now (VIDEO_MODEL), or why there is none.
 * Adding a provider: implement VideoProvider in this folder, give its models
 * that `provider` name in ../models.ts, and return it below.
 */
export function currentVideoProvider():
  { provider: VideoProvider } | { provider: null; reason: string } {
  const model = videoModelInfo(env.VIDEO_MODEL)
  if (!model) {
    return {
      provider: null,
      reason: `VIDEO_MODEL "${env.VIDEO_MODEL}" has no price on record; add it to src/lib/video/models.ts or unset it to use ${DEFAULT_VIDEO_MODEL_ID}.`
    }
  }
  return providerFor(model.provider, model.id)
}

/** The provider that made a stored video, to ask how it stands. */
export function providerFor(
  provider: string,
  modelId: string
): { provider: VideoProvider } | { provider: null; reason: string } {
  const model = VIDEO_MODELS[modelId]
  if (!model || model.provider !== provider) {
    return {
      provider: null,
      reason: `Video model ${modelId} is no longer configured.`
    }
  }
  // Recorded on this server: needs no key, only a browser and ffmpeg.
  if (provider === 'recorder') {
    return { provider: recorderVideoProvider(model) }
  }
  if (provider === 'gateway') {
    if (!hasAIGateway) {
      return {
        provider: null,
        reason: 'Video generation needs AI_GATEWAY_API_KEY.'
      }
    }
    return { provider: gatewayVideoProvider(model) }
  }
  return { provider: null, reason: `Unknown video provider ${provider}.` }
}
