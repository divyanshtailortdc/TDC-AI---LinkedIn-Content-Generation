import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Browser, type BrowserBinary } from './browser'
import {
  logoPlates,
  STAGE_PIXEL_RATIO,
  STAGE_VIEWPORT,
  stageDocument,
  type VideoTheme
} from './page'
import type { PlannedCard, PlannedScene, VideoPlan } from './plan'
import { type Card, Stage } from './stage'

// Records a planned video and exports one MP4, adapted from the product-video
// skill's toolkit (.claude/skills/product-video, assets/toolkit/make.ts).
// Kept from the toolkit, each against a bug its references/pitfalls.md
// describes: every segment is its own clip; fades are drawn by ffmpeg where
// the curtain opened and closed; frames last until the next one, on a 1 ms
// clock; colour is converted to limited-range BT.709. Changes: frames are
// stepped, not screencast (see ./stage.ts), so a take is never choppy and
// none is retaken; ffmpeg runs without blocking the server; segments are
// encoded once, at the final quality, and joined without re-encoding; no
// ffprobe; a silent soundtrack, so every platform takes the file.

export interface RecordOptions {
  browser: BrowserBinary
  ffmpeg: string
  /** An empty folder for frames and clips; the caller removes it. */
  workDir: string
  /** Leave each segment's frames and concat list in workDir, to debug. */
  keepFrames?: boolean
  log?: (line: string) => void
}

export interface RecordedVideo {
  /** The MP4, inside workDir. */
  file: string
  seconds: number
  width: number
  height: number
  segments: Array<{ key: string; seconds: number; frames: number }>
}

export const OUTPUT = { width: 1080, height: 1920 } as const
const FADE_MS = 600
const FFMPEG_TIMEOUT_MS = 180_000

// Screenshots are full-range JPEGs; convert them to the limited-range
// BT.709 colour every web video uses, or some GPU decoders reject the file.
const COLOR_TAGS =
  '-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv'.split(
    ' '
  )
const clipFilter = `fps=30,scale=${OUTPUT.width}:${OUTPUT.height}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p`
// Every segment is encoded alike, so they join without re-encoding. `-r 30`
// too: the concat filter that draws a fade drops the frame rate, and a clip
// encoded at ffmpeg's 25 fps default leaves a gap where the clips join.
const VIDEO_FLAGS = [
  ...'-r 30 -c:v libx264 -profile:v high -crf 20 -preset medium -tune stillimage -pix_fmt yuv420p -g 60'.split(
    ' '
  ),
  ...COLOR_TAGS
]

type Segment =
  | { key: 'intro' | 'outro'; kind: 'card'; card: PlannedCard }
  | { key: string; kind: 'scene'; scene: PlannedScene; index: number }

function segmentsOf(plan: VideoPlan): Segment[] {
  return [
    { key: 'intro', kind: 'card', card: plan.intro },
    ...plan.scenes.map((scene, index): Segment => ({
      key: scene.key,
      kind: 'scene',
      scene,
      index
    })),
    ...(plan.outro
      ? [{ key: 'outro', kind: 'card', card: plan.outro } as const]
      : [])
  ]
}

/** Runs a program to the end; never throws for its exit code. */
function run(
  cmd: string,
  args: string[],
  timeoutMs = FFMPEG_TIMEOUT_MS
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-20_000)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.once('error', err => {
      clearTimeout(timer)
      reject(new Error(`${path.basename(cmd)} could not run: ${err.message}`))
    })
    child.once('close', code => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
  })
}

function encoder(ffmpegPath: string) {
  const ffmpeg = async (args: string[]) => {
    const r = await run(ffmpegPath, ['-v', 'error', '-y', ...args])
    if (r.code !== 0)
      throw new Error(
        `ffmpeg failed: ${r.stderr.trim().split('\n').slice(-4).join(' ')}`
      )
  }
  /** A file's length in seconds, from ffmpeg's own report (no ffprobe). */
  const duration = async (file: string) => {
    const r = await run(ffmpegPath, ['-hide_banner', '-i', file], 30_000)
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr)
    if (!m) throw new Error(`ffmpeg could not read ${path.basename(file)}.`)
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  }
  return { ffmpeg, duration }
}

export async function recordVideo(
  plan: VideoPlan,
  theme: VideoTheme,
  options: RecordOptions
): Promise<RecordedVideo> {
  const { ffmpeg, duration } = encoder(options.ffmpeg)
  const log = options.log ?? (() => {})
  const workDir = options.workDir
  await mkdir(path.join(workDir, 'encoded'), { recursive: true })
  const cardColor = `0x${theme.card.replace('#', '')}`
  const fade = FADE_MS / 1000

  /**
   * Encodes a recorded clip at the output size and draws its fades: in
   * where the curtain opened, out so the screen is dark where it closed.
   */
  const encodeClip = async (
    dir: string,
    marks: { open?: number; close?: number },
    file: string
  ) => {
    let graph = `[0:v]${clipFilter}[v]`
    if (marks.open !== undefined) {
      const out =
        marks.close !== undefined
          ? `,fade=t=out:st=${Math.max(0, marks.close - marks.open - fade).toFixed(3)}:d=${fade}:color=${cardColor}`
          : ''
      graph = [
        `[0:v]${clipFilter},split=2[a][b]`,
        `[a]trim=end=${marks.open.toFixed(3)},setpts=PTS-STARTPTS[card]`,
        `[b]trim=start=${marks.open.toFixed(3)},setpts=PTS-STARTPTS,fade=t=in:st=0:d=${fade}:color=${cardColor}${out}[screen]`,
        '[card][screen]concat=n=2:v=1:a=0[v]'
      ].join(';')
    }
    await ffmpeg([
      ...['-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt')],
      ...['-filter_complex', graph, '-map', '[v]'],
      ...VIDEO_FLAGS,
      file
    ])
  }

  const page = await Browser.launch({
    binary: options.browser,
    viewport: STAGE_VIEWPORT,
    pixelRatio: STAGE_PIXEL_RATIO,
    profileDir: path.join(workDir, 'profile')
  })
  const recorded: RecordedVideo['segments'] = []
  try {
    const stage = new Stage(page, {
      theme: {
        background: theme.card,
        text: theme.cardText,
        accent: theme.cardAccent,
        headingFont: `"${theme.headingFont}", Inter, sans-serif`,
        headingWeight: theme.headingWeight,
        bodyFont: `"${theme.bodyFont}", Inter, sans-serif`,
        logoPlate: logoPlates(theme).card
      }
    })
    const document = stageDocument(theme)
    await page.setContent(document.html)
    await page.eval(document.script)
    await stage.inject()

    const total = plan.scenes.length
    const cardOf = (card: PlannedCard, key: string): Card => ({
      ...(card.kicker ? { num: card.kicker } : {}),
      title: card.title,
      ...(card.subtitle ? { subtitle: card.subtitle } : {}),
      ...(key === 'outro' && theme.footer ? { footer: theme.footer } : {}),
      ...(theme.logo ? { logo: theme.logo } : {})
    })

    const take = async (segment: Segment, dir: string) => {
      if (segment.kind === 'card') {
        await page.eval(`window.__slide(null, 0, ${total})`)
        // Cleared at once, so a retake's card fades in again instead of
        // starting with the last take's text already showing
        await stage.curtain(false, { title: '' })
        await stage.curtainText(false, 0)
        await stage.record(dir)
        await stage.curtain(false, cardOf(segment.card, segment.key), 300)
        await stage.curtainText(true, segment.card.holdMs)
        // The opening card's text leaves before the first slide
        if (segment.key === 'intro') await stage.curtainText(false, 450)
      } else {
        await page.eval(
          `window.__slide(${JSON.stringify(segment.scene)}, ${segment.index}, ${total})`
        )
        await stage.record(dir)
        // No card: start on the card colour and fade straight in
        await stage.curtain(false, { title: '' }, 250)
        // The export fades in over this wait and out over the one after the
        // caption hides; the words rise in under the fade
        await stage.curtain(true)
        await stage.change('window.__go()')
        await stage.wait(FADE_MS)
        if (segment.scene.caption)
          await stage.caption({ subtitle: segment.scene.caption })
        await stage.wait(segment.scene.holdMs - 2 * FADE_MS)
        await stage.caption(null)
        await stage.wait(FADE_MS)
        await stage.curtain(false, { title: '' }, 150)
      }
      return stage.stop()
    }

    for (const segment of segmentsOf(plan)) {
      const dir = path.join(workDir, 'clips', segment.key)
      const file = path.join(workDir, 'encoded', `${segment.key}.mp4`)
      const result = await take(segment, dir)
      await encodeClip(dir, result.marks, file)
      // The frames are encoded: free the space (/tmp is small on Vercel)
      if (!options.keepFrames) await rm(dir, { recursive: true, force: true })
      log(
        `Recorded ${segment.key}: ${result.seconds.toFixed(1)} s, ${result.frames} frames`
      )
      recorded.push({
        key: segment.key,
        seconds: result.seconds,
        frames: result.frames
      })
    }
  } finally {
    await page.close()
  }

  // Joined without re-encoding: every segment was encoded alike
  const list = path.join(workDir, 'order.txt')
  await writeFile(
    list,
    recorded.map(s => `file 'encoded/${s.key}.mp4'`).join('\n')
  )
  const master = path.join(workDir, 'master.mp4')
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', master])
  const seconds = await duration(master)

  // A silent soundtrack: some platforms refuse a video with no audio stream
  const file = path.join(workDir, 'video.mp4')
  await ffmpeg([
    ...['-i', master],
    ...[
      '-f',
      'lavfi',
      '-t',
      seconds.toFixed(3),
      '-i',
      'anullsrc=r=48000:cl=stereo'
    ],
    ...['-map', '0:v', '-map', '1:a', '-c:v', 'copy'],
    ...['-c:a', 'aac', '-b:a', '128k', '-shortest'],
    ...['-movflags', '+faststart'],
    file
  ])
  return {
    file,
    seconds,
    width: OUTPUT.width,
    height: OUTPUT.height,
    segments: recorded
  }
}
