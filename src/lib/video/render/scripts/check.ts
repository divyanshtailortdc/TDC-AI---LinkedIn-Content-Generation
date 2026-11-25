/**
 * Checks a finished video: finds one-frame flashes, choppy motion and harsh
 * brightness jumps, and writes a contact sheet to look at. Exits 1 when it
 * finds a flash or choppy motion. From the product-video skill's toolkit
 * (.claude/skills/product-video, assets/toolkit/check.ts), with its own
 * frame measurements (see below) and no ffprobe.
 *
 *   pnpm video:check <video.mp4>
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findFfmpeg } from '../binaries'

const file = process.argv[2] ?? ''
if (!file || !existsSync(file)) {
  console.error('usage: pnpm video:check <video.mp4>')
  process.exit(1)
}
let ffmpeg = ''

const run = (args: string[], cwd?: string, allowFailure = false) => {
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8', cwd })
  if (r.error) throw new Error(`ffmpeg could not run: ${r.error.message}`)
  if (r.status !== 0 && !allowFailure)
    throw new Error(`ffmpeg failed: ${r.stderr.trim()}`)
  return r
}

// Each frame's mean brightness and its mean change from the frame before,
// measured here from the decoded picture. The toolkit read them from ffmpeg's
// signalstats, which on these videos (long still holds, then motion)
// reported changes of 8 levels between frames that differ by none: a false
// "choppy" verdict every time.
let duration = 0
let frameBytes = 0
const luma: number[] = []
const change: number[] = []

async function measure() {
  ffmpeg = await findFfmpeg()
  const probe = run(['-hide_banner', '-i', path.resolve(file)], undefined, true)
  const size = /Video: .*?, (\d+)x(\d+)/.exec(probe.stderr)
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(probe.stderr)
  if (!m || !size) throw new Error('ffmpeg could not read the video.')
  duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
  frameBytes = Number(size[1]) * Number(size[2])
  const decoder = spawn(ffmpeg, [
    '-v',
    'error',
    '-i',
    path.resolve(file),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-'
  ])
  const frame = Buffer.alloc(frameBytes)
  let prev: Buffer | null = null
  let filled = 0
  // Every fourth pixel is plenty for a mean, and four times faster
  const STRIDE = 4
  const take = () => {
    let sum = 0
    let diff = 0
    let count = 0
    for (let i = 0; i < frameBytes; i += STRIDE) {
      const v = frame[i]!
      sum += v
      if (prev) diff += Math.abs(v - prev[i]!)
      count++
    }
    luma.push(sum / count)
    change.push(prev ? diff / count : 0)
    prev = Buffer.from(frame)
  }
  for await (const chunk of decoder.stdout as AsyncIterable<Buffer>) {
    let offset = 0
    while (offset < chunk.length) {
      const n = Math.min(frameBytes - filled, chunk.length - offset)
      chunk.copy(frame, filled, offset, offset + n)
      filled += n
      offset += n
      if (filled === frameBytes) {
        take()
        filled = 0
      }
    }
  }
  const code = await new Promise(resolve => decoder.once('close', resolve))
  if (code !== 0) throw new Error('ffmpeg could not decode the video.')
}
function report() {
  const fps = luma.length / duration
  const at = (i: number) => `${(i / fps).toFixed(2)}s`

  // A flash: one frame far brighter or darker than both neighbours
  const FLASH = 25
  const flashes: string[] = []
  for (let i = 1; i < luma.length - 1; i++) {
    const [before, now, after] = [luma[i - 1]!, luma[i]!, luma[i + 1]!]
    const up = now - before > FLASH && now - after > FLASH
    const down = before - now > FLASH && after - now > FLASH
    if (up || down) flashes.push(at(i))
  }
  const steps = luma
    .slice(1)
    .map((v, i) => ({ change: Math.abs(v - luma[i]!), time: at(i + 1) }))
    .sort((a, b) => b.change - a.change)
  const harsh = steps.filter(s => s.change > FLASH)

  // Choppy motion: repeated frames between moving ones. Every file reports a
  // steady frame rate, because the export fills dropped frames with repeats.
  const STILL = 0.15 // Brightness change per frame below this is compression noise
  const SHORT_REPEAT = 3 // Longer holds are deliberate pauses
  const CHOPPY_REPEATS = 4 // One or two in a second are stops and starts
  const repeats = new Map<number, number>()
  for (let i = 1, held = 0; i < change.length; i++) {
    if (change[i]! <= STILL) {
      held++
      continue
    }
    if (held >= 1 && held <= SHORT_REPEAT && change[i - held - 1]! > STILL) {
      const second = Math.floor(i / fps)
      repeats.set(second, (repeats.get(second) ?? 0) + 1)
    }
    held = 0
  }
  const choppy = [...repeats]
    .filter(([, count]) => count >= CHOPPY_REPEATS)
    .map(([second]) => `${second}s`)

  const name = `product-video-check-${path.parse(file).name.replace(/[^\w-]+/g, '-')}`
  const sheet = path.join(os.tmpdir(), `${name}-sheet.jpg`)
  // Up to 25 frames, at most one a second, in a grid sized to fit them
  const count = Math.min(25, Math.max(1, Math.floor(duration)))
  const cols = Math.min(5, count)
  run([
    '-v',
    'error',
    '-y',
    '-i',
    file,
    '-vf',
    `fps=${count}/${duration.toFixed(3)},scale=270:-1,tile=${cols}x${Math.ceil(count / cols)}:padding=4`,
    '-frames:v',
    '1',
    sheet
  ])

  console.log(
    JSON.stringify(
      {
        file,
        seconds: Number(duration.toFixed(1)),
        frames: luma.length,
        flashes,
        choppySeconds: choppy,
        harshJumps: harsh.map(s => `${s.time} (${s.change.toFixed(0)})`),
        largestChange: `${steps[0]?.change.toFixed(1)} at ${steps[0]?.time}`,
        contactSheet: sheet,
        verdict: flashes.length
          ? 'Fix before publishing: one-frame flashes found.'
          : choppy.length
            ? 'Record the video again: motion stutters at these times.'
            : harsh.length
              ? 'No flashes or choppy motion. Look at the harsh jumps: hard cuts are fine, stuttering fades are not.'
              : 'No flashes, choppy motion or harsh jumps.'
      },
      null,
      2
    )
  )
  process.exit(flashes.length || choppy.length ? 1 : 0)
}

measure().then(report, (error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
