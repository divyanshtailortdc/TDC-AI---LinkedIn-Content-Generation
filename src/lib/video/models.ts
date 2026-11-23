/**
 * The video models short videos can be made with, and what each costs. A
 * model is picked by VIDEO_MODEL (Veo 3.1 Lite when unset); a model must be
 * listed here, so the cost shown before generating is never a guess.
 *
 * Switching model: add its entry here and set VIDEO_MODEL. A model from
 * another provider also needs that provider in ./providers.
 *
 * Pure data, safe for tests and the browser.
 */

export type VideoResolution = '720p' | '1080p'

export interface VideoModelInfo {
  /** The provider's model id, e.g. the AI Gateway's "google/veo-3.1-fast-generate-001". */
  id: string
  /** Which provider in ./providers calls it. */
  provider: 'gateway'
  label: string
  /** The clip lengths it makes, in seconds. */
  durations: readonly number[]
  /** Whether it makes the voiceover and sound with the picture. */
  audio: boolean
  /**
   * US dollars per second of video, with and without audio. From the
   * provider's published rates; the AI Gateway adds no markup to video.
   */
  pricePerSecond: Record<VideoResolution, { audio: number; silent: number }>
  /**
   * The `resolution` value the model takes for each tier. Veo names a tier
   * by its landscape size whatever the shape: "1920x1080" with aspect ratio
   * 9:16 is a 1080×1920 portrait clip.
   */
  resolutionParam: Record<VideoResolution, `${number}x${number}`>
  /** Where the rates come from, and when they were checked. */
  priceSource: string
}

export const DEFAULT_VIDEO_MODEL_ID = 'google/veo-3.1-lite-generate-001'

export const VIDEO_MODELS: Record<string, VideoModelInfo> = {
  // The default: the cheapest Veo, text-to-video only, up to 1080p.
  'google/veo-3.1-lite-generate-001': {
    id: 'google/veo-3.1-lite-generate-001',
    provider: 'gateway',
    label: 'Veo 3.1 Lite',
    durations: [4, 6, 8],
    audio: true,
    pricePerSecond: {
      '720p': { audio: 0.05, silent: 0.03 },
      '1080p': { audio: 0.08, silent: 0.05 }
    },
    resolutionParam: { '720p': '1280x720', '1080p': '1920x1080' },
    priceSource: 'Google Vertex AI Veo 3.1 Lite rates, checked 2026-11-19'
  },
  'google/veo-3.1-fast-generate-001': {
    id: 'google/veo-3.1-fast-generate-001',
    provider: 'gateway',
    label: 'Veo 3.1 Fast',
    durations: [4, 6, 8],
    audio: true,
    pricePerSecond: {
      '720p': { audio: 0.1, silent: 0.08 },
      '1080p': { audio: 0.12, silent: 0.1 }
    },
    resolutionParam: { '720p': '1280x720', '1080p': '1920x1080' },
    priceSource: 'Google Vertex AI Veo 3.1 Fast rates, checked 2026-11-19'
  }
}

/** The model VIDEO_MODEL names (blank or unset: the default); null when it is not listed. */
export function videoModelInfo(
  id: string | null | undefined
): VideoModelInfo | null {
  const wanted = id?.trim() || DEFAULT_VIDEO_MODEL_ID
  return VIDEO_MODELS[wanted] ?? null
}

/** What one clip costs at these settings, in US dollars, to the cent and a tenth. */
export function estimateVideoCostUsd(
  model: VideoModelInfo,
  settings: { seconds: number; resolution: VideoResolution; audio: boolean }
): number {
  const rate = model.pricePerSecond[settings.resolution]
  const perSecond = settings.audio && model.audio ? rate.audio : rate.silent
  return Math.round(perSecond * settings.seconds * 1000) / 1000
}
