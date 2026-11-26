import type { FormatId } from '@/lib/formats/types'
import type { PlatformId } from '@/lib/platforms'

/**
 * Create from media: the user uploads (or shares a link to) one image or one
 * video, the AI writes a post for each platform picked from what the media
 * shows, and each post goes out with the original file attached.
 *
 * The rules both sides check: the browser to say what is wrong before
 * uploading, the server again because the browser can be bypassed. Pure data,
 * safe for the browser and tests.
 */

export type UploadKind = 'image' | 'video'

export const UPLOAD_TYPES: Record<
  UploadKind,
  ReadonlyArray<{ mediaType: string; extension: string }>
> = {
  // What every network the app publishes to takes, and the image pipeline
  // (variants, the vision model) reads.
  image: [
    { mediaType: 'image/jpeg', extension: 'jpg' },
    { mediaType: 'image/png', extension: 'png' },
    { mediaType: 'image/webp', extension: 'webp' }
  ],
  // MP4 and QuickTime: what Instagram, YouTube, LinkedIn and X all accept.
  video: [
    { mediaType: 'video/mp4', extension: 'mp4' },
    { mediaType: 'video/quicktime', extension: 'mov' }
  ]
}

const MB = 1024 * 1024

/**
 * Largest file accepted. An image within LinkedIn's and Facebook's 10 MB
 * (X takes 5 MB: such a post says so when it is published). A video within
 * what every network takes through Buffer, and small enough for the server
 * to read frames from it in a few seconds.
 */
export const UPLOAD_MAX_BYTES: Record<UploadKind, number> = {
  image: 10 * MB,
  video: 250 * MB
}

/** Shortest edge of an image worth posting. */
export const UPLOAD_IMAGE_MIN_EDGE = 200

/** The longest a user's notes about the media may be. */
export const UPLOAD_NOTES_MAX_CHARS = 1500

/** The kind and file extension for a declared type, or null for one not taken. */
export function uploadTypeOf(
  mediaType: string
): { kind: UploadKind; extension: string; mediaType: string } | null {
  const type = mediaType.trim().toLowerCase()
  for (const kind of ['image', 'video'] as const) {
    const found = UPLOAD_TYPES[kind].find(t => t.mediaType === type)
    if (found) return { kind, ...found }
  }
  return null
}

/** The kind and type a stored upload has, from its file extension. */
export function uploadTypeByExtension(
  extension: string
): { kind: UploadKind; extension: string; mediaType: string } | null {
  for (const kind of ['image', 'video'] as const) {
    const found = UPLOAD_TYPES[kind].find(t => t.extension === extension)
    if (found) return { kind, ...found }
  }
  return null
}

const megabytes = (bytes: number) => `${Math.round((bytes / MB) * 10) / 10} MB`

/** What is wrong with a file before it is uploaded, or null when it can go. */
export function validateUploadFile(file: {
  type: string
  size: number
}): string | null {
  const type = uploadTypeOf(file.type)
  if (!type) {
    return `Use a JPEG, PNG or WebP image, or an MP4 or MOV video${
      file.type ? ` (this file is ${file.type})` : ''
    }.`
  }
  if (file.size <= 0) return 'That file is empty.'
  const max = UPLOAD_MAX_BYTES[type.kind]
  if (file.size > max) {
    return `${type.kind === 'image' ? 'Images' : 'Videos'} must be under ${megabytes(max)} (this one is ${megabytes(file.size)}).`
  }
  return null
}

/**
 * The format a post from uploaded media is made in, per platform: the
 * platform's single post (an image post, or the post with its video), and
 * for YouTube, which has only Shorts, a Short. A platform missing takes no
 * media of that kind from here.
 */
export const UPLOAD_FORMATS: Record<
  UploadKind,
  Partial<Record<PlatformId, FormatId>>
> = {
  image: {
    linkedin: 'linkedin.post',
    x: 'x.post',
    threads: 'threads.post',
    facebook: 'facebook.post',
    instagram: 'instagram.caption'
  },
  video: {
    linkedin: 'linkedin.post',
    x: 'x.post',
    threads: 'threads.post',
    facebook: 'facebook.post',
    instagram: 'instagram.caption',
    youtube: 'youtube.short'
  }
}

export const uploadFormatOf = (
  kind: UploadKind,
  platform: PlatformId
): FormatId | null => UPLOAD_FORMATS[kind][platform] ?? null

/** The platforms media of this kind can be posted to from here, in registry order. */
export const uploadPlatforms = (kind: UploadKind): PlatformId[] =>
  Object.keys(UPLOAD_FORMATS[kind]) as PlatformId[]

/**
 * What each network takes of a video, for a warning before it is posted
 * (the network has the last word). Seconds and the shape it shows best.
 */
export const VIDEO_LIMITS: Partial<
  Record<
    PlatformId,
    { maxSeconds: number; minSeconds?: number; vertical?: boolean }
  >
> = {
  linkedin: { maxSeconds: 600, minSeconds: 3 },
  x: { maxSeconds: 140 },
  threads: { maxSeconds: 300 },
  facebook: { maxSeconds: 90, minSeconds: 3 },
  instagram: { maxSeconds: 900, minSeconds: 3 },
  // A Short: up to three minutes, vertical or square.
  youtube: { maxSeconds: 180, vertical: true }
}

/** Why a video may not suit a platform, or null. */
export function videoWarning(
  platform: PlatformId,
  video: {
    durationSeconds: number | null
    width: number | null
    height: number | null
  }
): string | null {
  const limits = VIDEO_LIMITS[platform]
  if (!limits) return null
  const seconds = video.durationSeconds
  if (seconds !== null && seconds > limits.maxSeconds) {
    const max =
      limits.maxSeconds >= 60
        ? `${Math.round((limits.maxSeconds / 60) * 10) / 10} minutes`
        : `${limits.maxSeconds} seconds`
    return `Longer than the ${max} this platform takes for this kind of post.`
  }
  if (seconds !== null && limits.minSeconds && seconds < limits.minSeconds) {
    return `Shorter than the ${limits.minSeconds} seconds this platform needs.`
  }
  if (
    limits.vertical &&
    video.width &&
    video.height &&
    video.width > video.height
  ) {
    return 'Shorts must be vertical or square; this video is landscape.'
  }
  return null
}

/** "9:16" for 1080x1920: the shape, as post_videos keeps it (at most 10 characters). */
export function aspectRatioOf(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height) || 1
  const exact = `${width / d}:${height / d}`
  return exact.length <= 10 ? exact : (width / height).toFixed(3).slice(0, 10)
}

/** What a post made from uploaded media keeps in its payload, under `upload`. */
export interface UploadedMediaInfo {
  kind: UploadKind
  /** The file's own name, when it had one. */
  fileName: string | null
  /** What the AI saw in it, in a sentence or two. */
  summary: string
}

/** The upload a post was made from, from its payload; null for any other post. */
export function uploadedMediaOf(
  payload: Record<string, unknown> | null | undefined
): UploadedMediaInfo | null {
  const upload = payload?.upload as Partial<UploadedMediaInfo> | undefined
  if (!upload || (upload.kind !== 'image' && upload.kind !== 'video'))
    return null
  return {
    kind: upload.kind,
    fileName: typeof upload.fileName === 'string' ? upload.fileName : null,
    summary: typeof upload.summary === 'string' ? upload.summary : ''
  }
}
