import 'server-only'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadBrandTheme } from '~/lib/ai/context'
import { loadBrandLogo } from '~/lib/media/brand-assets'
import { logoTone, toDataUrl } from '~/lib/media/brand-logo'
import { loadCanvasFonts } from '~/lib/media/canvas/fonts'
import { videoLookFor } from '../look-source'
import { findBrowser, findFfmpeg } from '../render/binaries'
import { brandedLook, PACE_FACTOR } from '../render/look'
import { videoThemeFor } from '../render/page'
import { parsePlan, withPace } from '../render/plan'
import { recordVideo } from '../render/record'
import type { RenderedVideo, VideoRecorder } from './types'

/**
 * Videos recorded on this server with the product-video skill's method
 * (src/lib/video/render): the post's script played as slides in a headless
 * browser, recorded, and encoded with ffmpeg. They are built in the format
 * of the identity's own recent posts (../look-source.ts) and follow the
 * Brand Theme where it is set, and the look of those posts where it is not.
 * No AI model and no per-video charge. The plan is the video's stored prompt
 * (render/plan.ts); the brand is read when it is recorded.
 */

// One recording at a time in a process: each runs a browser and ffmpeg, and
// a serverless instance has the memory for one.
let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task)
  queue = next.catch(() => {})
  return next
}

export const recorder: VideoRecorder = {
  async render({ prompt, accountId, platform }): Promise<RenderedVideo> {
    const plan = parsePlan(prompt)
    // First, so a function deployed without them says so before any work.
    const ffmpeg = await findFfmpeg()
    const browser = await findBrowser()
    const brand = await loadBrandTheme(accountId)
    // The look of their own posts, with the Brand Theme's image style over it
    const choice = await videoLookFor({ accountId, platform, brand })
    const look = brandedLook(choice.look, brand.visualStyle)
    const fonts = await loadCanvasFonts(brand)
    const logoBytes =
      brand.showLogo && brand.hasLogo ? await loadBrandLogo(accountId) : null
    const theme = videoThemeFor(brand, {
      heading: fonts.heading,
      body: fonts.body,
      headingWeight: fonts.headingWeight,
      fonts: fonts.fonts.map(f => ({
        family: f.name,
        weight: f.weight,
        data: f.data
      })),
      // Browsers read the image's own format whatever the type says.
      logo: logoBytes ? toDataUrl(logoBytes, 'image/png') : null,
      logoTone: logoBytes ? await logoTone(logoBytes).catch(() => null) : null,
      look,
      photos: choice.photos
    })
    const paced = withPace(plan, PACE_FACTOR[look.pace])

    return oneAtATime(async () => {
      const workDir = await mkdtemp(path.join(tmpdir(), 'post-video-'))
      try {
        const video = await recordVideo(paced, theme, {
          browser,
          ffmpeg,
          workDir,
          log: line => console.log(`[video] ${line}`)
        })
        return {
          bytes: await readFile(video.file),
          mediaType: 'video/mp4',
          seconds: video.seconds,
          warnings: [
            ...fonts.issues,
            ...(choice.warning ? [choice.warning] : [])
          ],
          metadata: {
            // As the skill chose it, so a later video with the same stamp reuses it
            look: choice.look,
            lookStamp: choice.stamp,
            lookFrom: choice.from,
            template: look.template,
            format: theme.format
          }
        }
      } finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
    })
  }
}
