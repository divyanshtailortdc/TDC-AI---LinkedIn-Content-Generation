import 'server-only'

import { isBlockingLookIssue } from '~/lib/ai/skills/look-review'
import type { CallUsage } from '~/lib/ai/usage'
import { makeLookSlides } from '~/lib/carousel/look'
import { lookDesign, type SlideContent } from '~/lib/carousel/types'
import { storeDraftFile } from '~/lib/media/image-store'
import { loadMediaInputs } from '~/lib/media/post-media'
import { ImageGenerationAbortedError } from '~/lib/media/render-image'
import type { PlatformId } from '~/lib/platforms'
import { loadLookExamples } from '~/lib/visual-examples/store'
import { pickSceneSegments, type VideoPlan } from './render/plan'
import { OUTPUT } from './render/record'

/**
 * Pictures made for a video's scenes, like the identity's own posts: the
 * hook and up to two of its lines each get an image of their own, drawn by
 * the image model in the look of the account's example posts with the
 * scene's words set into it, as a carousel made like their posts is
 * (src/lib/carousel/look.ts). The rest of the video is the brand's own
 * type. At most MAX_SCENE_PICTURES images a video, about $0.06 each and
 * half a minute or so, charged to the post (the caller's spend scope).
 *
 * Made once per video and stored in the bucket; the recording reads them
 * from there (../video/post-video.ts keeps their places in the row's
 * metadata).
 */

/** Where words go in a frame Reels and Shorts cover with their buttons. */
export const SCENE_NOTE =
  'Keep every word inside the middle of the frame, clear of the top seventh and the bottom quarter, where the app shows its own buttons over the video; the picture itself still fills the whole frame.'

/**
 * What the art director is told about the set: video scenes, words where
 * Reels and Shorts leave them readable, and each scene its own moment.
 */
export const SCENES_DIRECTION =
  "These are the still scenes of one vertical 9:16 short video (a Reel or Short), shown full screen one after another. Set every scene's words in the middle of the frame, between about a sixth and two thirds of the way down, never at the very top or bottom, where the app shows its own buttons and caption over the video; otherwise keep the examples' type and colours. Any logo goes in the top-left corner, clear of those buttons. Make each scene a different moment, framed differently (close, wide, from another angle), so the video never repeats a picture."

export interface SceneImage {
  /** The segment it belongs to: 'intro' or a scene's key. */
  key: string
  /** Its place in the bucket. */
  url: string
}

export interface SceneImagesResult {
  scenes: SceneImage[]
  /** What the checks still found on the pictures that were made. */
  issues: string[]
  /** Why no picture was made; null when some were. */
  error: string | null
  usage: CallUsage | null
}

const extensionOf = (mediaType: string) =>
  mediaType === 'image/png'
    ? 'png'
    : mediaType === 'image/webp'
      ? 'webp'
      : 'jpg'

/**
 * Makes and stores the pictures of a video's chosen scenes. Never throws
 * but for ImageGenerationAbortedError: a video without them is recorded in
 * the brand's type, as before.
 */
export async function makeSceneImages(req: {
  plan: VideoPlan
  draft: { id: string; accountId: string; ideaId: string | null }
  platform: PlatformId
  /** The caption posted beside the video, for the checks. */
  caption: string
  abortSignal?: AbortSignal
}): Promise<SceneImagesResult> {
  const picks = pickSceneSegments(req.plan)
  const none = (error: string, usage: CallUsage | null = null) => ({
    scenes: [],
    issues: [],
    error,
    usage
  })
  if (picks.length === 0) return none('The script has no scene to picture.')
  try {
    const examples = await loadLookExamples(req.draft.accountId, req.platform)
    if (examples.length === 0) {
      return none(
        'There are no example posts to make scene pictures like. Add your profile links or example images on Profile.'
      )
    }
    const inputs = await loadMediaInputs({
      accountId: req.draft.accountId,
      ideaId: req.draft.ideaId,
      platform: req.platform
    })
    const slides: SlideContent[] = picks.map(p => ({
      role: p.role,
      headline: p.headline,
      body: p.caption ?? '',
      imagePrompt:
        p.visual ??
        'A scene that shows what these words say, in the style of the examples.',
      design: lookDesign(p.role),
      altText: p.headline
    }))
    const made = await makeLookSlides({
      slides,
      examples,
      platform: req.platform,
      brand: inputs.brand,
      caption: req.caption,
      context: inputs.context,
      accountName: inputs.context.accountName ?? '',
      target: OUTPUT,
      sceneNote: SCENE_NOTE,
      direction: SCENES_DIRECTION,
      medium: 'video',
      // Reels and Shorts put their buttons over the lower corners
      logoCorner: 'top-left',
      abortSignal: req.abortSignal
    })
    if ('error' in made) return none(made.error, made.usage)
    const scenes: SceneImage[] = []
    const issues: string[] = []
    for (const [i, slide] of made.slides.entries()) {
      const pick = picks[i]!
      if (slide.error) issues.push(slide.error)
      if (!slide.image) continue
      // A picture whose words came out wrong is left out, even after its
      // second try: that scene is set in type instead
      const wrong = slide.issues.filter(isBlockingLookIssue)
      if (wrong.length > 0) {
        issues.push(
          `A scene picture was left out (${wrong.join('; ').replace(/\.$/, '')}).`
        )
        continue
      }
      issues.push(...slide.issues)
      scenes.push({
        key: pick.key,
        url: await storeDraftFile(req.draft.id, {
          buffer: slide.image.buffer,
          mediaType: slide.image.mediaType,
          extension: extensionOf(slide.image.mediaType)
        })
      })
    }
    return {
      scenes,
      issues,
      error:
        scenes.length > 0 ? null : 'No image model drew the scene pictures.',
      usage: made.usage
    }
  } catch (err) {
    if (err instanceof ImageGenerationAbortedError) throw err
    console.warn('Scene pictures could not be made:', err)
    return none(
      err instanceof Error && err.message
        ? err.message
        : 'The scene pictures could not be made.'
    )
  }
}
