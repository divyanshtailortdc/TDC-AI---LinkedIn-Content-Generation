import 'server-only'

import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import sharp from 'sharp'
import { findFfmpeg } from '~/lib/video/render/binaries'

/**
 * What the AI is shown of an uploaded file, and what is known about it.
 * An image is shown as it is (made smaller, as the vision model would anyway).
 * The models the app uses read images, not video, so a video is shown as a
 * handful of frames with its length; its sound is not heard, and the prompt
 * says so.
 *
 * The frames are taken where the video holds still (see pickFrameTimes): a
 * product or explainer video says what it is about on caption cards and
 * shows its results on screens it pauses on, and frames taken at even times
 * landed between them. A 65-second launch video's first even frame (at 4 s)
 * fell in the fade after "Carrier sites send customers away." and "Your
 * page keeps them.", so the model never saw the problem or the promise.
 */

/** Longest edge of a picture sent to the model: larger is downscaled by it. */
const MODEL_EDGE = 1568
/**
 * Longest edge of a video frame sent to the model. The model reads images
 * by area (about one token per 28x28 pixels), so a 16:9 frame at 1568 was
 * about 1,760 tokens and sixteen of them most of the request; at 1280 one
 * is about 1,180, and caption cards and on-screen labels still read. The
 * request is about a quarter smaller, and answered sooner.
 */
const FRAME_EDGE = 1280
/** Frames read at once: each is a short ffmpeg run of its own. */
const FRAME_CONCURRENCY = Math.min(8, Math.max(4, availableParallelism()))
/** Frames shown of a video: at least this many, when it is long enough. */
export const VIDEO_FRAMES = 8
/**
 * At most this many: a longer video gets about one per SECONDS_PER_FRAME.
 * A product video gives each feature a few seconds of its own; at 12 frames
 * for 65 seconds, one of the Track360 launch video's nine caption cards
 * ("Your own address, your own page.") fell between frames. Each frame is
 * about 1,200 input tokens (FRAME_EDGE).
 */
export const VIDEO_FRAMES_MAX = 16
const SECONDS_PER_FRAME = 4
/** One ffmpeg run, at most: reading a frame takes well under a second. */
const FFMPEG_TIMEOUT_MS = 60_000

/**
 * Reading where a video moves: tiny grey pictures, a few a second. The whole
 * video is decoded (about 1.3 s for a 65-second 1080p video on 12 cores), so
 * a long one on a slow machine is given up on and framed evenly instead.
 */
const MOTION_WIDTH = 64
const MOTION_HEIGHT = 36
const MOTION_TIMEOUT_MS = 20_000
/** Below this mean change per pixel (0-255) between samples, the picture holds still. */
const STILL_MOTION = 1.5
/** A still stretch this long or longer is a moment to read. */
const MIN_HOLD_SECONDS = 0.5
/** The opening, where a video says what it is about: at least this long... */
const OPENING_SECONDS = 8
/** ...or this share of the video, and at most this many of its holds. */
const OPENING_SHARE = 0.1
const OPENING_FRAMES = 3

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
  signal?: AbortSignal,
  timeoutMs = FFMPEG_TIMEOUT_MS
): Promise<{
  stdout: Buffer
  stderr: string
  code: number | null
  /** Set when ffmpeg was killed: stopped here, timed out or crashed. */
  killedBy: NodeJS.Signals | null
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const out: Buffer[] = []
    let err = ''
    const stop = () => child.kill('SIGKILL')
    const timer = setTimeout(stop, timeoutMs)
    signal?.addEventListener('abort', stop, { once: true })
    child.stdout.on('data', chunk => out.push(chunk))
    child.stderr.on('data', chunk => {
      // Only the start (the stream description) is read; keep it bounded.
      if (err.length < 64_000) err += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code, killedBy) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve({ stdout: Buffer.concat(out), stderr: err, code, killedBy })
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

/** How many frames a video this long is shown: 8, up to 16 for a long one. */
export function frameCountFor(durationSeconds: number | null): number {
  if (!durationSeconds || durationSeconds <= 0) return 1
  return Math.min(
    VIDEO_FRAMES_MAX,
    Math.max(VIDEO_FRAMES, Math.ceil(durationSeconds / SECONDS_PER_FRAME))
  )
}

/**
 * How much each sample differs from the one before: the mean change per
 * pixel, 0 to 255, over grey pictures of `pixels` bytes each, back to back.
 * motion[i] is the change from sample i to sample i + 1.
 */
export function motionBetween(gray: Uint8Array, pixels: number): number[] {
  const count = Math.floor(gray.length / pixels)
  const motion: number[] = []
  for (let i = 1; i < count; i++) {
    let sum = 0
    const a = (i - 1) * pixels
    const b = i * pixels
    for (let p = 0; p < pixels; p++) sum += Math.abs(gray[b + p]! - gray[a + p]!)
    motion.push(sum / pixels)
  }
  return motion
}

/** A stretch of a video, in seconds, where the picture holds still. */
export interface Hold {
  start: number
  end: number
}

/**
 * Where the video holds still, from its motion sampled `fps` times a second
 * (motionBetween): the stretches a caption card, a title or a screen's result
 * stays up long enough to read.
 */
export function findHolds(motion: readonly number[], fps: number): Hold[] {
  const samples = motion.length + 1
  const still = (i: number) =>
    (i === 0 || motion[i - 1]! < STILL_MOTION) &&
    (i === samples - 1 || motion[i]! < STILL_MOTION)
  const holds: Hold[] = []
  let first = -1
  for (let i = 0; i <= samples; i++) {
    if (i < samples && still(i)) {
      if (first < 0) first = i
      continue
    }
    if (first >= 0 && (i - first) / fps >= MIN_HOLD_SECONDS) {
      holds.push({ start: first / fps, end: (i - 1) / fps })
    }
    first = -1
  }
  return holds
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** A moment a frame may be taken at: a hold's middle, or a point in motion. */
interface Moment {
  time: number
  /** How long the picture holds still there; 0 in motion. */
  length: number
  /** The opening holds and the end card, which are never dropped. */
  kept: boolean
}

/**
 * Where to take `count` frames, given where the video holds still.
 *
 * Every hold is a moment to read: a caption card, a title, a screen's
 * result. A product video gives each feature one or two, some only half a
 * second long, so every hold is a candidate, and a stretch of motion longer
 * than an even framing's spacing (a demonstration in motion) gets points
 * across it too. The opening holds (where the video says what it is about)
 * and the last one (the end card, often the promise or the ask) are always
 * kept. With more moments than frames, the most crowded is dropped first
 * (the one whose neighbours are closest together, the shorter of equals),
 * so every part of the video keeps a frame and a short card between two long
 * screens is not lost to them. With fewer, the widest gaps are split.
 *
 * Taking the longest hold in each equal part instead missed a 65-second
 * launch video's "Your own address, your own page." card (a quarter-second
 * hold 2.5 s after a longer one). A video that never holds still is framed
 * evenly.
 */
export function pickFrameTimes(
  durationSeconds: number,
  holds: readonly Hold[],
  count: number
): number[] {
  const n = Math.max(1, Math.min(count, Math.ceil(durationSeconds)))
  if (holds.length === 0) return frameTimes(durationSeconds, n)
  const at = (hold: Hold) => round2((hold.start + hold.end) / 2)

  const openingEnd = Math.max(OPENING_SECONDS, durationSeconds * OPENING_SHARE)
  const opening = holds
    .filter(hold => hold.start < openingEnd)
    .slice(0, Math.min(OPENING_FRAMES, Math.max(1, Math.floor(n / 4))))
  const last = holds[holds.length - 1]!
  const closing =
    n - opening.length >= 1 && !opening.includes(last) ? last : null

  const held: Moment[] = holds.map(hold => ({
    time: at(hold),
    length: hold.end - hold.start,
    kept: opening.includes(hold) || hold === closing
  }))

  // Motion between holds: points as far apart as an even framing's frames.
  // The video's start and end count as half a spacing beyond its edges, as
  // an even framing's first and last frames sit half a spacing in.
  const spacing = durationSeconds / n
  const bounds = [
    -spacing / 2,
    ...held.map(m => m.time),
    durationSeconds + spacing / 2
  ]
  const moments: Moment[] = [...held]
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1]!
    const b = bounds[i]!
    const points = Math.round((b - a) / spacing) - 1
    for (let k = 1; k <= points; k++) {
      const time = round2(a + ((b - a) * k) / (points + 1))
      if (time > 0 && time < durationSeconds) {
        moments.push({ time, length: 0, kept: false })
      }
    }
  }
  moments.sort((x, y) => x.time - y.time)

  const before = (i: number) => (i > 0 ? moments[i - 1]!.time : 0)
  const after = (i: number) =>
    i < moments.length - 1 ? moments[i + 1]!.time : durationSeconds
  while (moments.length > n) {
    let drop = -1
    for (let i = 0; i < moments.length; i++) {
      if (moments[i]!.kept) continue
      if (drop < 0) {
        drop = i
        continue
      }
      const span = after(i) - before(i)
      const best = after(drop) - before(drop)
      if (
        span < best - 1e-9 ||
        (Math.abs(span - best) <= 1e-9 &&
          moments[i]!.length < moments[drop]!.length)
      ) {
        drop = i
      }
    }
    if (drop < 0) break
    moments.splice(drop, 1)
  }

  while (moments.length < n) {
    // The widest gap, the video's edges included, split in the middle.
    let widest = 0
    let gap = -1
    for (let i = 0; i <= moments.length; i++) {
      const a = i > 0 ? moments[i - 1]!.time : 0
      const b = i < moments.length ? moments[i]!.time : durationSeconds
      if (b - a > gap) {
        gap = b - a
        widest = i
      }
    }
    const a = widest > 0 ? moments[widest - 1]!.time : 0
    const b = widest < moments.length ? moments[widest]!.time : durationSeconds
    const time = round2((a + b) / 2)
    if (moments.some(m => m.time === time)) break
    moments.splice(widest, 0, { time, length: 0, kept: false })
  }
  return moments.map(m => m.time)
}

/**
 * Where the video holds still, read from tiny grey frames of all of it. Null
 * when it could not be read in time: the caller frames it evenly instead.
 */
async function readHolds(
  ffmpeg: string,
  file: string,
  durationSeconds: number,
  signal?: AbortSignal
): Promise<Hold[] | null> {
  // Two a second is enough to find a caption that stays up for a second.
  const fps = durationSeconds > 300 ? 2 : 4
  const run = await runFfmpeg(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      file,
      '-an',
      '-vf',
      `fps=${fps},scale=${MOTION_WIDTH}:${MOTION_HEIGHT},format=gray`,
      '-f',
      'rawvideo',
      'pipe:1'
    ],
    signal,
    MOTION_TIMEOUT_MS
  )
  signal?.throwIfAborted()
  if (run.killedBy || run.stdout.length === 0) return null
  const motion = motionBetween(
    new Uint8Array(run.stdout),
    MOTION_WIDTH * MOTION_HEIGHT
  )
  return findHolds(motion, fps)
}

/** A video's length, size and sound, from a file on disk. Throws for a file that is no video. */
export async function probeVideo(
  file: string,
  signal?: AbortSignal
): Promise<Omit<VideoFacts, 'frames'>> {
  const ffmpeg = await findFfmpeg()
  // No output: ffmpeg describes the input, then stops with an error.
  const described = await runFfmpeg(ffmpeg, ['-hide_banner', '-i', file], signal)
  signal?.throwIfAborted()
  if (described.killedBy) {
    // A crash or the time limit, not the user's file: not theirs to fix.
    throw new Error(
      `ffmpeg stopped (${described.killedBy}) while reading the video.`
    )
  }
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
 * Reads a video from a file on disk: its length, size and frames. Throws
 * when the file is no video ffmpeg can read.
 *
 * Never a link: the bundled ffmpeg is a static Linux build, which cannot look
 * up host names (it crashes, or fails, on any http(s) input with a host name).
 * The caller downloads the file first (see service.ts).
 */
export async function inspectVideo(
  file: string,
  signal?: AbortSignal
): Promise<VideoFacts> {
  const ffmpeg = await findFfmpeg()
  const info = await probeVideo(file, signal)

  const count = frameCountFor(info.durationSeconds)
  let holds: Hold[] | null = null
  if (info.durationSeconds) {
    try {
      holds = await readHolds(ffmpeg, file, info.durationSeconds, signal)
    } catch (err) {
      signal?.throwIfAborted()
      // Even frames still show the video; this only picks better ones.
      console.warn('Reading where the video holds still failed:', err)
    }
  }
  const times =
    holds && info.durationSeconds
      ? pickFrameTimes(info.durationSeconds, holds, count)
      : frameTimes(info.durationSeconds, count)
  // A few at a time, the next started as soon as one ends, kept in order.
  const read: Array<VideoFacts['frames'][number] | null> = []
  let next = 0
  const readFrames = async () => {
    while (next < times.length) {
      const index = next++
      const atSeconds = times[index]!
      const run = await runFfmpeg(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(atSeconds),
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          `scale='min(${FRAME_EDGE},iw)':'min(${FRAME_EDGE},ih)':force_original_aspect_ratio=decrease`,
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
      read[index] =
        run.stdout.length > 0
          ? {
              atSeconds,
              picture: {
                data: new Uint8Array(run.stdout),
                mediaType: 'image/jpeg'
              }
            }
          : null
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(FRAME_CONCURRENCY, times.length) }, () =>
      readFrames()
    )
  )
  signal?.throwIfAborted()
  const frames = read.filter(
    (frame): frame is VideoFacts['frames'][number] => Boolean(frame)
  )
  if (frames.length === 0) {
    throw new UnreadableMediaError(
      'No frames could be read from the video. Upload an MP4 or MOV file.'
    )
  }
  return { ...info, frames }
}
