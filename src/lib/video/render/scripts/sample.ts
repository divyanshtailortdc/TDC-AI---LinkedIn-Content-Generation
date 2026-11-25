/**
 * Records one video the way the app records a Reel or Short, with no
 * database and no sign-in: a sample script (or your own) in the default
 * brand (or your colours). For trying the recorder and its look locally.
 *
 *   pnpm video:sample                         sample script, default brand
 *   pnpm video:sample -- --script post.json   your script: { hook, body, cta, payload }
 *   pnpm video:sample -- --brand brand.json   { primaryColor, accentColor, backgroundColor, footerText }
 *   pnpm video:sample -- --out reel.mp4       where to write it (default: the temp folder)
 *   pnpm video:sample -- --keep               keep the frames' folder, with each segment's clip
 *   pnpm video:sample -- --look bold          a look: cards, bold, minimal or photo, or a JSON file
 *   pnpm video:sample -- --look photo --photo a.jpg --photo b.jpg   photos for the photo look
 *   pnpm video:sample -- --format meme --photo a.jpg   a format: slides, kinetic, meme, poster or editorial
 *   pnpm video:sample -- --highlight marker            key words: none, marker or color
 *
 * Then check it: pnpm video:check <file>
 */
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import type { PostText } from '../../../formats/text'
import { loadCanvasFonts } from '../../../media/canvas/fonts'
import { findBrowser, findFfmpeg } from '../binaries'
import {
  cleanVideoLook,
  DEFAULT_VIDEO_LOOK,
  PACE_FACTOR,
  VIDEO_FORMATS,
  VIDEO_HIGHLIGHTS,
  VIDEO_TEMPLATES,
  type VideoLook
} from '../look'
import { type BrandForVideo, videoThemeFor } from '../page'
import { plannedSeconds, planVideo, withPace } from '../plan'
import { recordVideo } from '../record'

const SAMPLE: PostText = {
  hook: 'Most month-end closes slip for one reason.',
  body: [
    "It's the bank feed nobody owns.",
    'Give it one owner and a ten-minute check each morning.',
    'Teams that do it close two days sooner.'
  ].join('\n\n'),
  cta: 'Ask your team who owns the bank feed today.',
  hashtags: ['finance'],
  payload: {
    caption: 'Who owns your bank feed?',
    shots: [
      { show: 'The hook', onScreenText: 'Why closes slip' },
      { show: 'The cause', onScreenText: 'The bank feed nobody owns' },
      { show: 'The fix', onScreenText: 'One owner. Ten minutes.' },
      { show: 'The result', onScreenText: 'Close 2 days sooner' },
      { show: 'The ask', onScreenText: 'Who owns yours?' }
    ]
  }
}

const DEFAULT_BRAND: BrandForVideo = {
  primaryColor: null,
  accentColor: null,
  backgroundColor: null,
  footerText: 'example.com'
}

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

/** Every value given for a repeatable option. */
const options = (name: string) =>
  process.argv.flatMap((arg, i) =>
    arg === `--${name}` && process.argv[i + 1] ? [process.argv[i + 1]!] : []
  )

/** A template name, or a JSON file in the shape the video-look skill returns. */
async function readLook(
  value: string | undefined,
  photoCount: number
): Promise<VideoLook> {
  if (!value) return DEFAULT_VIDEO_LOOK
  if ((VIDEO_TEMPLATES as readonly string[]).includes(value)) {
    const photos = Array.from({ length: photoCount }, (_, i) => i + 1)
    return cleanVideoLook(
      { ...DEFAULT_VIDEO_LOOK, template: value, photos },
      photoCount
    )
  }
  return cleanVideoLook(JSON.parse(await readFile(value, 'utf8')), photoCount)
}

async function readJson<T>(file: string | undefined, fallback: T): Promise<T> {
  return file
    ? { ...fallback, ...JSON.parse(await readFile(file, 'utf8')) }
    : fallback
}

async function main() {
  const post = await readJson(option('script'), SAMPLE)
  const brand = await readJson(option('brand'), DEFAULT_BRAND)
  const out = path.resolve(
    option('out') ?? path.join(tmpdir(), 'post-video-sample.mp4')
  )

  const photos = await Promise.all(
    options('photo').map(async file => {
      const data = await readFile(file)
      const meta = await sharp(data).metadata()
      return {
        dataUrl: `data:image/${meta.format === 'png' ? 'png' : 'jpeg'};base64,${data.toString('base64')}`,
        width: meta.width ?? null,
        height: meta.height ?? null
      }
    })
  )
  const chosen = await readLook(option('look'), photos.length)
  // A format or highlight named on its own goes over the look
  const format = option('format')
  const highlight = option('highlight')
  if (format && !(VIDEO_FORMATS as readonly string[]).includes(format))
    throw new Error(`--format is one of ${VIDEO_FORMATS.join(', ')}.`)
  if (highlight && !(VIDEO_HIGHLIGHTS as readonly string[]).includes(highlight))
    throw new Error(`--highlight is one of ${VIDEO_HIGHLIGHTS.join(', ')}.`)
  const look = cleanVideoLook(
    {
      ...chosen,
      ...(format ? { format } : {}),
      ...(highlight ? { highlight } : {}),
      // Every photo given, when the look named none
      photos: (chosen.photos.length > 0
        ? chosen.photos
        : photos.map((_, i) => i)
      ).map(i => i + 1)
    },
    photos.length
  )
  const plan = withPace(planVideo({ post }), PACE_FACTOR[look.pace])
  console.log(
    `Recording ${plan.scenes.length} slides and ${plan.outro ? 'two cards' : 'one card'}, about ${plannedSeconds(plan)} s.`
  )
  const fonts = await loadCanvasFonts({
    headingFont: 'Inter',
    bodyFont: 'Inter'
  })
  const theme = videoThemeFor(brand, {
    heading: fonts.heading,
    body: fonts.body,
    headingWeight: fonts.headingWeight,
    fonts: fonts.fonts.map(f => ({
      family: f.name,
      weight: f.weight,
      data: f.data
    })),
    look,
    photos: look.photos.flatMap(i => (photos[i] ? [photos[i]] : []))
  })
  console.log(
    `Look: ${theme.format} in ${look.template}, ${look.textCase}, ${look.captions}, ${look.pace}, highlight ${look.highlight}`
  )

  const workDir = await mkdtemp(path.join(tmpdir(), 'post-video-sample-'))
  const started = Date.now()
  try {
    const browser = await findBrowser()
    const ffmpeg = await findFfmpeg()
    console.log(`Browser: ${browser.executable}\nffmpeg: ${ffmpeg}`)
    const video = await recordVideo(plan, theme, {
      browser,
      ffmpeg,
      workDir,
      keepFrames: process.argv.includes('--keep'),
      log: line => console.log(line)
    })
    await copyFile(video.file, out)
    console.log(
      `\n${out}\n${video.seconds.toFixed(1)} s, ${video.width}×${video.height}, recorded in ${((Date.now() - started) / 1000).toFixed(0)} s`
    )
  } finally {
    if (process.argv.includes('--keep')) console.log(`Kept ${workDir}`)
    else await rm(workDir, { recursive: true, force: true })
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
