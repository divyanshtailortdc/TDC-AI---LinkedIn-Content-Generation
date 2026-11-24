import { FORMATS } from '@/lib/formats/registry'
import type { FormatId, PlatformId } from '@/lib/formats/types'

/**
 * The short vertical videos the app makes: one per platform, each a script
 * drafted from an idea and recorded from it with the product-video skill's
 * method (src/lib/video/render): title cards and slides in the brand, filmed
 * in a headless browser. Kept apart from images (src/lib/media): nothing in
 * the image pipeline reads these.
 *
 * Pure data: imported by the browser, server code and tests.
 */

/**
 * Short video, on since 2026-11-24 (recorded, no longer AI clips). Set to
 * false to hide it again: Create posts loses the Short video choice, ideas
 * draft no video scripts and start no videos, existing Reels and Shorts are
 * hidden from Posts and Schedule (inKnownFormat), and the API refuses to
 * start one. All the code stays.
 */
export const VIDEO_GENERATION_ENABLED = true

export const VIDEO_FORMATS = [
  'instagram.reel',
  'youtube.short',
  'facebook.reel'
] as const satisfies readonly FormatId[]
export type VideoFormatId = (typeof VIDEO_FORMATS)[number]

export function isVideoFormat(value: unknown): value is VideoFormatId {
  return (VIDEO_FORMATS as readonly unknown[]).includes(value)
}

/** What every platform takes for a short vertical video, as it is made. */
export interface VideoSpec {
  formatId: VideoFormatId
  platform: PlatformId
  /** As pickers name it: "Instagram Reels". */
  label: string
  aspectRatio: '9:16'
  width: number
  height: number
  /** About how long a video runs; the script sets the exact length. */
  seconds: number
  fps: number
  container: 'mp4'
  /** The longest video the platform takes, for the panel's note. */
  platformMaxSeconds: number
}

const CLIP = {
  aspectRatio: '9:16',
  width: 1080,
  height: 1920,
  seconds: 15,
  fps: 30,
  container: 'mp4'
} as const

/**
 * 1080×1920 MP4 at 9:16 is what all three recommend. A video runs about 15
 * seconds and never a minute (src/lib/video/render/plan.ts), far inside
 * every platform's limit (Facebook Reels 90 s; Instagram Reels and YouTube
 * Shorts 3 min).
 */
export const VIDEO_SPECS: Record<VideoFormatId, VideoSpec> = {
  'instagram.reel': {
    ...CLIP,
    formatId: 'instagram.reel',
    platform: 'instagram',
    label: 'Instagram Reels',
    platformMaxSeconds: 180
  },
  'youtube.short': {
    ...CLIP,
    formatId: 'youtube.short',
    platform: 'youtube',
    label: 'YouTube Shorts',
    platformMaxSeconds: 180
  },
  'facebook.reel': {
    ...CLIP,
    formatId: 'facebook.reel',
    platform: 'facebook',
    label: 'Facebook Reels',
    platformMaxSeconds: 90
  }
}

export const videoSpecOf = (formatId: VideoFormatId): VideoSpec =>
  VIDEO_SPECS[formatId]

/** "9:16 · 1080×1920 · ~15 s · MP4". */
export function describeVideoSpec(spec: VideoSpec): string {
  return `${spec.aspectRatio} · ${spec.width}×${spec.height} · ~${spec.seconds} s · ${spec.container.toUpperCase()}`
}

/** The format's own label, for places that name the post: "Instagram Reel". */
export const videoFormatLabel = (formatId: VideoFormatId) =>
  FORMATS[formatId].label

/**
 * The video formats an idea was asked for in "Create posts" → Short video,
 * kept in its suggestedMedia next to the image choice. Only these are drafted
 * as videos: an older idea that targets a Reel from before is not.
 */
export function videoFormatsChosen(idea: {
  suggestedMedia?: unknown
}): VideoFormatId[] {
  // Switched off: an idea that asked for videos drafts its other formats.
  if (!VIDEO_GENERATION_ENABLED) return []
  const chosen = (idea.suggestedMedia as { videoFormats?: unknown } | null)
    ?.videoFormats
  return Array.isArray(chosen)
    ? VIDEO_FORMATS.filter(f => chosen.includes(f))
    : []
}

/** "$0.96". Below a cent shows as "<$0.01". */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return '<$0.01'
  return `$${value.toFixed(2)}`
}
