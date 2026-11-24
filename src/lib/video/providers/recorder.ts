import 'server-only'

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadBrandTheme } from '~/lib/ai/context'
import { loadBrandLogo } from '~/lib/media/brand-assets'
import { logoTone, toDataUrl } from '~/lib/media/brand-logo'
import { loadCanvasFonts } from '~/lib/media/canvas/fonts'
import type { VideoModelInfo } from '../models'
import { findBrowser, findFfmpeg } from '../render/binaries'
import { videoThemeFor } from '../render/page'
import { parsePlan } from '../render/plan'
import { recordVideo } from '../render/record'
import type { LocalVideoProvider, RenderedVideo } from './types'

/**
 * Videos recorded on this server with the product-video skill's method
 * (src/lib/video/render): the post's script played as brand-coloured title
 * cards and slides in a headless browser, recorded, and encoded with ffmpeg.
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

export function recorderVideoProvider(
  model: VideoModelInfo
): LocalVideoProvider {
  return {
    kind: 'local',
    name: 'recorder',
    model,

    async render({ prompt, accountId }): Promise<RenderedVideo> {
      const plan = parsePlan(prompt)
      // First, so a function deployed without them says so before any work.
      const ffmpeg = await findFfmpeg()
      const browser = await findBrowser()
      const brand = await loadBrandTheme(accountId)
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
        logoTone: logoBytes ? await logoTone(logoBytes).catch(() => null) : null
      })

      return oneAtATime(async () => {
        const workDir = await mkdtemp(path.join(tmpdir(), 'post-video-'))
        try {
          const video = await recordVideo(plan, theme, {
            browser,
            ffmpeg,
            workDir,
            log: line => console.log(`[video] ${line}`)
          })
          return {
            bytes: await readFile(video.file),
            mediaType: 'video/mp4',
            seconds: video.seconds,
            warnings: fonts.issues
          }
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => {})
        }
      })
    }
  }
}
