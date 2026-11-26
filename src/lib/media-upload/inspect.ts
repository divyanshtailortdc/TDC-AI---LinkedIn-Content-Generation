import 'server-only'

import { spawn } from 'node:child_process'
import sharp from 'sharp'
import { findFfmpeg } from '~/lib/video/render/binaries'

/**
 * What the AI is shown of an uploaded file, and what is known about it.
 * An image is shown as it is (made smaller, as the vision model would anyway).
 * The models the app uses read images, not video, so a video is shown as a
 * handful of frames taken evenly across it, with its length; its sound is not
 * heard, and the prompt says so.
 */

/** Longest edge of a picture sent to the model: larger is downscaled by it. */
const MODEL_EDGE = 1568
/** Frames shown of a video: enough to follow what happens, cheap to read. */
export const VIDEO_FRAMES = 8
/** One ffmpeg run, at most: reading a frame from a link takes a second or two. */
const FFMPEG_TIMEOUT_MS = 60_000

export interface ModelImage {
  data: Uint8Array
  mediaType: string
}

export interface ImageFacts {
  width: number
  height: number
  picture: ModelImage
}

/** The image's size, and the picture the model is shown. Null when it is no image. */
export async function inspectImage(bytes: Buffer): Promise<ImageFacts | null> {
  try {
    const image = sharp(bytes, { failOn: 'error' }).rotate()
    const meta = await image.metadata()
    if (!meta.width || !meta.height) return null
    // EXIF orientation 5-8 is a quarter turn: the shown size is swapped.
    const turned = (meta.orientation ?? 1) >= 5
    const picture = await image
      .resize({
        width: MODEL_EDGE,
        height: MODEL_EDGE,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 85 })
      .toBuffer()
    return {
      width: turned ? meta.height : meta.width,
      height: turned ? meta.width : meta.height,
      picture: { data: new Uint8Array(picture), mediaType: 'image/jpeg' }
    }
  } catch {
    return null
  }
}

export interface VideoFacts {
  durationSeconds: number | null
  width: number | null
  height: number | null
  hasAudio: boolean
  /** Each frame and where in the video it was taken. */
  frames: Array<{ atSeconds: number; picture: ModelImage }>
}

/** Runs ffmpeg; its stdout as bytes and stderr as text, whatever its exit code. */
function runFfmpeg(
  ffmpeg: string,
  args: string[],
  signal?: AbortSignal
): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    const stop = () => child.kill('SIGKILL')
    const timer = setTimeout(stop, FFMPEG_TIMEOUT_MS)
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', chunk => out.push(chunk))
    child.stderr.on('data', chunk => {
      // Only the start (the stream description) is read; keep it bounded.
      if (err.length < 64_000) err += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve({ stdout: Buffer.concat(out), stderr: err, code })
    })
  })
}

/**
 * Length, size and sound from ffmpeg's description of its input. A rotated
 * phone video (rotation ±90) is shown upright, so its size is swapped.
 * Exported for tests.
 */
export function parseFfmpegInfo(stderr: string): {
  durationSeconds: number | null
  width: number | null
  height: number | null
  hasAudio: boolean
} {
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  const durationSeconds = duration
    ? Number(duration[1]) * 3600 +
      Number(duration[2]) * 60 +
      Number(duration[3])
    : null
  // "Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1080x1920 [SAR 1:1 DAR 9:16], ..."
  const videoLine =
    stderr.split('\n').find(line => /Stream #.*: Video:/.test(line)) ?? ''
  const size = /,\s*(\d{2,5})x(\d{2,5})[\s,]/.exec(videoLine)
  let width = size ? Number(size[1]) : null
  let height = size ? Number(size[2]) : null
  const rotation =
    /rotation of (-?\d+(?:\.\d+)?) degrees|rotate\s*:\s*(-?\d+)/.exec(stderr)
  const degrees = rotation
    ? Math.abs(Number(rotation[1] ?? rotation[2])) % 180
    : 0
  if (degrees === 90 && width && height) [width, height] = [height, width]
  return {
    durationSeconds:
      durationSeconds !== null &&
      Number.isFinite(durationSeconds) &&
      durationSeconds > 0
        ? Math.round(durationSeconds * 10) / 10
        : null,
    width,
    height,
    hasAudio: /Stream #.*: Audio:/.test(stderr)
  }
}

/** Where to take `count` frames from a video this long: the middle of each equal part. */
export function frameTimes(
  durationSeconds: number | null,
  count = VIDEO_FRAMES
): number[] {
  if (!durationSeconds || durationSeconds <= 0) return [0]
  const n = Math.max(1, Math.min(count, Math.ceil(durationSeconds)))
  return Array.from(
    { length: n },
    (_, i) => Math.round(((durationSeconds * (i + 0.5)) / n) * 100) / 100
  )
}

/** A video's length, size and sound, from a link. Throws for a file that is no video. */
export async function probeVideo(
  url: string,
  signal?: AbortSignal
): Promise<Omit<VideoFacts, 'frames'>> {
  const ffmpeg = await findFfmpeg()
  // No output: ffmpeg describes the input, then stops with an error.
  const described = await runFfmpeg(ffmpeg, ['-hide_banner', '-i', url], signal)
  if (!/Stream #.*: Video:/.test(described.stderr)) {
    throw new UnreadableMediaError(
      'The video could not be read. Upload an MP4 or MOV file.'
    )
  }
  return parseFfmpegInfo(described.stderr)
}

/** The uploaded file is not media this can read: the user's to fix. */
export class UnreadableMediaError extends Error {}

/**
 * Reads a video from a link (a signed link to the bucket): its length, size
 * and frames. ffmpeg seeks with range requests, so only the parts it needs
 * are downloaded. Throws when the file is no video ffmpeg can read.
 */
export async function inspectVideo(
  url: string,
  signal?: AbortSignal
): Promise<VideoFacts> {
  const ffmpeg = await findFfmpeg()
  const info = await probeVideo(url, signal)

  const times = frameTimes(info.durationSeconds)
  const frames: VideoFacts['frames'] = []
  // A few at a time: each is a short ffmpeg run of its own.
  for (let i = 0; i < times.length; i += 4) {
    const batch = await Promise.all(
      times.slice(i, i + 4).map(async atSeconds => {
        const run = await runFfmpeg(
          ffmpeg,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-ss',
            String(atSeconds),
            '-i',
            url,
            '-frames:v',
            '1',
            '-vf',
            `scale='min(${MODEL_EDGE},iw)':'min(${MODEL_EDGE},ih)':force_original_aspect_ratio=decrease`,
            '-f',
            'image2pipe',
            '-vcodec',
            'mjpeg',
            '-q:v',
            '4',
            'pipe:1'
          ],
          signal
        )
        return run.stdout.length > 0
          ? {
              atSeconds,
              picture: {
                data: new Uint8Array(run.stdout),
                mediaType: 'image/jpeg'
              }
            }
          : null
      })
    )
    for (const frame of batch) if (frame) frames.push(frame)
  }
  if (frames.length === 0) {
    throw new UnreadableMediaError(
      'No frames could be read from the video. Upload an MP4 or MOV file.'
    )
  }
  return { ...info, frames }
}
