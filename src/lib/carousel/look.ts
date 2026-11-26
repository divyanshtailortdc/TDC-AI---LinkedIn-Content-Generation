import 'server-only'

import type { LookCorner, LookDesign } from '~/lib/ai/skills/look-design'
import { designLookSeries } from '~/lib/ai/skills/look-series'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import type { BrandRendering } from '~/lib/media/brand-assets'
import type { ImageBytes } from '~/lib/media/brand-logo'
import type { MediaBriefContext } from '~/lib/media/brief-context'
import { SLIDE_SIZE } from '~/lib/media/carousel/render'
import {
  exampleAspect,
  renderLook,
  withSmallCopies,
  type LookExample,
  type SeriesPlace,
  type ShownExample
} from '~/lib/media/learned-look'
import { shapeWords } from '~/lib/media/reference-prompt'
import { ImageGenerationAbortedError } from '~/lib/media/render-image'
import { PLATFORMS, type PlatformId } from '~/lib/platforms'
import {
  numberRecentLooks,
  type RecentLook
} from '~/lib/visual-examples/recent'
import type { SlideLook } from './rows'
import type { SlideContent } from './types'

/**
 * A carousel made like the identity's own posts (the Like my posts style):
 * every slide is one image from the image model, in the look of the
 * account's example posts, with the slide's words set into it exactly. One
 * design call sets the look for the whole set; the cover is made first and
 * attached to every other slide so they read as one set; each slide is read
 * back and made once more when its words come out wrong, as a single image
 * is (src/lib/media/learned-look.ts).
 *
 * A live probe (2026-11-24, Zomato on Instagram) showed slides made this way
 * match the account's feed and each other, where the drawn slides
 * (./draw.ts) looked like a business deck in the default colours.
 */

/**
 * Slides made at once after the cover: each is an image call of half a
 * minute or so, and a carousel has at most 9 when first made, so most are
 * made in one round (a live 7-slide carousel took 220 s three at a time).
 */
const SLIDES_AT_ONCE = 6

/** The words a slide carries, as the image model is given them. Pure. */
export function slideTextParts(
  slide: Pick<SlideContent, 'headline' | 'body'>,
  wordmark: string | null
): LookDesign['text'] {
  const parts: LookDesign['text'] = []
  if (slide.headline.trim()) {
    parts.push({ part: 'main line', text: slide.headline.trim() })
  }
  const lines = slide.body
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (lines.length === 1) {
    parts.push({ part: 'smaller line', text: lines[0]! })
  } else {
    lines.forEach((line, i) => parts.push({ part: `line ${i + 1}`, text: line }))
  }
  if (wordmark?.trim()) parts.push({ part: 'wordmark', text: wordmark.trim() })
  return parts
}

/** The design one slide is made from: the set's look, its own scene and words. Pure. */
export function slideLookDesign(
  look: SlideLook,
  slide: Pick<SlideContent, 'headline' | 'body' | 'imagePrompt' | 'altText'>,
  options: { accountName: string; logoFile: boolean }
): LookDesign {
  return {
    examples: look.examples,
    kind: look.kind,
    styleNotes: look.styleNotes,
    concept: look.concept.trim() || slide.headline,
    scene:
      look.scene.trim() ||
      slide.imagePrompt.trim() ||
      'Only the words, set on the background the examples use.',
    text: slideTextParts(
      slide,
      !options.logoFile && look.wordmark ? options.accountName : null
    ),
    logoCorner: look.logoCorner,
    altText: slide.altText
  }
}

/**
 * What a slide goes with, for its check: the caption and every slide's
 * words, so a fact another slide states is not taken for an invented one.
 * Pure.
 */
export function carouselReviewText(
  caption: string,
  slides: Array<Pick<SlideContent, 'headline' | 'body'>>
): string {
  const words = slides
    .map((s, i) => `${i + 1}. ${[s.headline, s.body.replace(/\n/g, ' / ')].filter(Boolean).join(' — ')}`)
    .join('\n')
  return `${caption.trim()}\n\nTHE CAROUSEL'S SLIDES\n${words}`
}

/** The examples a slide follows: its stored numbers where they still exist, else the first. */
function followedOf(look: SlideLook, shown: ShownExample[]): ShownExample[] {
  const picked = look.examples
    .filter(n => n >= 1 && n <= shown.length)
    .map(n => shown[n - 1]!)
  return picked.length > 0 ? picked : shown.slice(0, 1)
}

export interface LookSlide {
  /** The made slide; null when no model drew it. */
  image: ImageBytes | null
  look: SlideLook
  /** What its check still found on it. */
  issues: string[]
  /** Why it could not be made. */
  error: string | null
  prompt?: string
}

interface MakeOne {
  slide: SlideContent
  look: SlideLook
  position: number
  total: number
  anchor: { image: Buffer; kind: NonNullable<SeriesPlace['anchor']> } | null
  shown: ShownExample[]
  platform: PlatformId
  brand: BrandRendering
  reviewText: string
  accountName: string
  /** The image's size; a carousel slide's by default. */
  target?: { width: number; height: number }
  /** A carousel's slides (the default), or a short video's scenes. */
  medium?: SeriesPlace['medium']
  abortSignal?: AbortSignal
}

async function makeOne(
  req: MakeOne
): Promise<{ slide: LookSlide; usage: CallUsage }> {
  const logoFile = Boolean(req.brand.theme.showLogo && req.brand.logo)
  const made = await renderLook({
    design: slideLookDesign(req.look, req.slide, {
      accountName: req.accountName,
      logoFile
    }),
    followed: followedOf(req.look, req.shown),
    anchor: req.anchor?.image ?? null,
    series: {
      position: req.position,
      total: req.total,
      anchor: req.anchor?.kind ?? null,
      ...(req.medium ? { medium: req.medium } : {})
    },
    platformName: PLATFORMS[req.platform].name,
    target: req.target ?? SLIDE_SIZE,
    brand: req.brand,
    postText: req.reviewText,
    accountName: req.accountName,
    abortSignal: req.abortSignal
  })
  if ('error' in made) {
    return {
      slide: {
        image: null,
        look: req.look,
        issues: [],
        error: `The slide could not be made (${made.error.replace(/\.$/, '')}).`
      },
      usage: made.usage
    }
  }
  return {
    slide: {
      image: made.render.image,
      look: req.look,
      issues: made.render.issues,
      error: null,
      prompt: made.render.prompt
    },
    usage: made.usage
  }
}

/**
 * Every slide of a carousel made like the account's posts. Returns the
 * reason instead when the set could not be designed, so the caller can draw
 * the slides in the brand. A slide that no model drew comes back without
 * an image, saying why. Throws ImageGenerationAbortedError when stopped.
 */
export async function makeLookSlides(req: {
  slides: SlideContent[]
  examples: LookExample[]
  platform: PlatformId
  brand: BrandRendering
  caption: string
  context: MediaBriefContext
  accountName: string
  direction?: string | null
  /** The account's latest looks on this platform, so this set differs. */
  recentLooks?: RecentLook[]
  /** The images' size; a carousel slide's by default (a video's scenes are 9:16). */
  target?: { width: number; height: number }
  /** Added to every slide's scene, such as where words must stay. */
  sceneNote?: string
  /** A carousel's slides (the default), or a short video's scenes. */
  medium?: SeriesPlace['medium']
  /**
   * Where the logo goes when the examples keep one, whatever corner they
   * keep it in (a video's buttons cover its lower corners).
   */
  logoCorner?: Exclude<LookCorner, 'none'>
  abortSignal?: AbortSignal
}): Promise<
  { slides: LookSlide[]; usage: CallUsage } | { error: string; usage: CallUsage }
> {
  let usage = EMPTY_USAGE
  const platformName = PLATFORMS[req.platform].name
  const target = req.target ?? SLIDE_SIZE
  const shown = await withSmallCopies(req.examples)

  const designed = await designLookSeries(
    {
      caption: req.caption,
      slides: req.slides.map(s => ({
        role: s.role,
        headline: s.headline,
        body: s.body,
        idea: s.imagePrompt
      })),
      platform: { name: platformName, shape: shapeWords(target) },
      context: req.context,
      examples: shown.map(e => ({
        data: e.small,
        mediaType: 'image/jpeg',
        platformName: PLATFORMS[e.platform].name,
        samePlatform: e.platform === req.platform,
        uploaded: e.source === 'upload',
        aspect: exampleAspect(e.width, e.height)
      })),
      logoFile: Boolean(req.brand.theme.showLogo && req.brand.logo),
      direction: req.direction,
      recentLooks: numberRecentLooks(req.recentLooks ?? [], req.examples)
    },
    { abortSignal: req.abortSignal }
  )
  usage = addUsage(usage, designed.usage)
  if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
  if (!designed.series) return { error: designed.error, usage }
  const series = designed.series
  const exampleIds = series.examples
    .map(n => shown[n - 1]?.id)
    .filter((id): id is string => Boolean(id))

  const looks: SlideLook[] = req.slides.map((slide, i) => ({
    kind: series.kind,
    styleNotes: series.styleNotes,
    examples: series.examples,
    ...(exampleIds.length > 0 ? { exampleIds } : {}),
    logoCorner:
      req.logoCorner && series.logoCorner !== 'none'
        ? req.logoCorner
        : series.logoCorner,
    wordmark: series.wordmark,
    scene: [series.slides[i]?.scene || slide.imagePrompt, req.sceneNote]
      .filter(Boolean)
      .join(' '),
    concept: series.slides[i]?.concept || slide.headline
  }))
  const reviewText = carouselReviewText(req.caption, req.slides)
  const total = req.slides.length
  const one = (i: number, anchor: MakeOne['anchor']) =>
    makeOne({
      slide: req.slides[i]!,
      look: looks[i]!,
      position: i + 1,
      total,
      anchor,
      shown,
      platform: req.platform,
      brand: req.brand,
      reviewText,
      accountName: req.accountName,
      target,
      medium: req.medium,
      abortSignal: req.abortSignal
    })

  const made: LookSlide[] = new Array(total)
  // The cover first: every other slide is made to match it.
  const cover = await one(0, null)
  usage = addUsage(usage, cover.usage)
  made[0] = cover.slide
  if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
  const anchor = cover.slide.image
    ? { image: cover.slide.image.buffer, kind: 'cover' as const }
    : null

  const rest = Array.from({ length: total - 1 }, (_, i) => i + 1)
  for (let start = 0; start < rest.length; start += SLIDES_AT_ONCE) {
    await Promise.all(
      rest.slice(start, start + SLIDES_AT_ONCE).map(async i => {
        const result = await one(i, anchor)
        usage = addUsage(usage, result.usage)
        made[i] = result.slide
      })
    )
    if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
  }
  return { slides: made, usage }
}

/**
 * One slide made again in its carousel's look: with new words or a new
 * scene (anchored on itself, so only those change), or as another take
 * (anchored on the cover or another slide). Throws
 * ImageGenerationAbortedError when stopped.
 */
export async function remakeLookSlide(req: {
  slide: SlideContent
  look: SlideLook
  position: number
  total: number
  anchor: MakeOne['anchor']
  examples: LookExample[]
  platform: PlatformId
  brand: BrandRendering
  caption: string
  /** Every slide's words as they will stand, this one's included. */
  slides: Array<Pick<SlideContent, 'headline' | 'body'>>
  accountName: string
  abortSignal?: AbortSignal
}): Promise<{ slide: LookSlide; usage: CallUsage }> {
  const result = await makeOne({
    slide: req.slide,
    look: req.look,
    position: req.position,
    total: req.total,
    anchor: req.anchor,
    shown: await withSmallCopies(req.examples),
    platform: req.platform,
    brand: req.brand,
    reviewText: carouselReviewText(req.caption, req.slides),
    accountName: req.accountName,
    abortSignal: req.abortSignal
  })
  if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
  return result
}
