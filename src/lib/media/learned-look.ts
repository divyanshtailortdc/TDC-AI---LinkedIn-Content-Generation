import {
  designLook,
  type LookCorner,
  type LookDesign
} from '~/lib/ai/skills/look-design'
import {
  lookIssues,
  lookRetryLines,
  reviewLook
} from '~/lib/ai/skills/look-review'
import type { PriorVisual } from '~/lib/ai/skills/media-brief/schema'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import {
  LIKE_MY_POSTS,
  logoBox,
  logoClearSpaceInstruction,
  type LogoPlacement
} from '~/lib/brand/theme'
import { PLATFORMS, type PlatformId } from '~/lib/platforms'
import {
  numberRecentLooks,
  type RecentLook
} from '~/lib/visual-examples/recent'
import type { BrandRendering } from './brand-assets'
import {
  compositeLogo,
  downscaleForReview,
  imageSize,
  type ImageBytes
} from './brand-logo'
import type { MediaBriefContext } from './brief-context'
import { shapeWords } from './reference-prompt'
import {
  ImageGenerationAbortedError,
  randomSeed,
  renderImage,
  type RenderedImage
} from './render-image'

/**
 * An image made like the identity's own posts ("Like my posts"). The art
 * director looks at the account's example images (src/lib/visual-examples),
 * picks the few this post should follow and writes the scene and the exact
 * words; the image model draws the whole image, words included, with those
 * examples attached; a vision check reads it back. The brand's real logo is
 * laid on by code where the examples keep theirs.
 *
 * Unlike the designed image (./index.ts), no template is drawn around a
 * picture: a live comparison (2026-11-23) showed the current image models
 * reproduce an account's photos, quote cards and infographics closely and
 * spell given text correctly, which no template can match.
 */

/** An example post with its bytes, as loadLookExamples gives them. */
export type LookExample = {
  /** Its visual_examples row, so the looks made from it can be told apart later. */
  id?: string
  platform: PlatformId
  source: 'search' | 'buffer' | 'upload'
  data: Buffer
  mediaType: string
  width: number | null
  height: number | null
}

const CORNER_PLACEMENT: Record<Exclude<LookCorner, 'none'>, LogoPlacement> = {
  'top-left': 'top_left',
  'top-right': 'top_right',
  'bottom-left': 'bottom_left',
  'bottom-right': 'bottom_right'
}

/** "4:5" for a 1080x1350 example; undefined when its size is unknown. */
export function exampleAspect(width: number | null, height: number | null) {
  if (!width || !height) return undefined
  const ratio = width / height
  const named: Array<[string, number]> = [
    ['1:1', 1],
    ['4:5', 0.8],
    ['2:3', 2 / 3],
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
    ['1.91:1', 1.91],
    ['3:2', 1.5],
    ['4:3', 4 / 3],
    ['3:4', 0.75]
  ]
  const [name, value] = named.reduce((best, n) =>
    Math.abs(Math.log(n[1] / ratio)) < Math.abs(Math.log(best[1] / ratio))
      ? n
      : best
  )
  return Math.abs(Math.log(value / ratio)) < 0.05 ? name : undefined
}

/**
 * Where an image sits in a carousel, and what it is made to match: the
 * image attached before the examples (`anchor`), which is the carousel's
 * cover, another of its slides, or this slide as it is now when only its
 * words or scene change.
 */
export type SeriesPlace = {
  /** 1-based. */
  position: number
  total: number
  anchor: 'cover' | 'slide' | 'self' | null
}

/** The lines that make an image one slide of a set. Pure, for tests. */
export function seriesLines(series: SeriesPlace, platformName: string): string {
  const which =
    series.position === 1
      ? `the cover, slide 1 of ${series.total},`
      : `slide ${series.position} of ${series.total}`
  const lead = `This image is ${which} of one ${platformName} carousel.`
  const rest = `Do not number the slide, and draw no arrows or swipe hints${
    series.position === series.total
      ? ': it is the last slide, so nothing on it points to another'
      : ''
  }.`
  switch (series.anchor) {
    case 'cover':
    case 'slide':
      return `${lead} The first attached image is ${
        series.anchor === 'cover' ? 'its cover' : 'another of its slides'
      }: keep exactly its background, colours, typefaces, type sizes, margins and wordmark, so the slides read as one set; only the words and what the slide shows change. ${rest}`
    case 'self':
      return `${lead} The first attached image is this slide as it is now: make it again with the same design (background, colours, typefaces, type sizes, layout, margins and wordmark), changing only the words and what it shows to what is described here. ${rest}`
    default:
      return `${lead} The other slides will be made to match it, so give it a clear design that a whole set can follow. ${rest}`
  }
}

/**
 * The image model's prompt: the art director's design, the exact words in a
 * block of their own, and the rules every image keeps. Pure, for tests.
 */
export function buildLookPrompt(options: {
  design: LookDesign
  platformName: string
  target: { width: number; height: number }
  /** How many examples are attached. */
  exampleCount: number
  /** The clear-space line when the real logo goes on afterwards. */
  logoClearSpace?: string
  /** A carousel slide: where it sits and what is attached before the examples. */
  series?: SeriesPlace
}): string {
  const { design } = options
  const anchored = Boolean(options.series?.anchor)
  const after = anchored ? ', attached after it' : ''
  const attached =
    options.exampleCount === 0
      ? 'the first attached image, made for this account'
      : options.exampleCount === 1
        ? `the ${anchored ? 'second' : 'attached'} image, a post from this account`
        : `the ${options.exampleCount} ${anchored ? 'other' : 'attached'} images, posts from this account${after}`
  const text = design.text.length
    ? `Use exactly these words, spelled exactly as written, and no other text${
        options.logoClearSpace ? '' : ' apart from what is listed'
      }:\n${design.text.map(t => `${t.part}: "${t.text}"`).join('\n')}`
    : 'No text anywhere in the image: no letters, words or numbers, and nothing readable on screens, papers, signs, labels or packaging.'
  return [
    options.series ? seriesLines(options.series, options.platformName) : '',
    `Create a new ${options.platformName} post image in the style of ${attached}, so that it looks made by the same ${design.kind === 'photo' ? 'photographer' : 'designer'}: ${design.styleNotes.trim()}`,
    `Do not copy their words, numbers, people, products or logos: this image shows something new.`,
    `What it shows: ${design.scene.trim()}`,
    text,
    design.kind === 'photo'
      ? 'It must look like a real photograph: natural light, real materials and textures, believable people with natural skin and correctly formed hands, the small imperfections of real life. Not illustrated, rendered or glossy.'
      : 'Crisp, clean and correctly formed: straight lines where they should be, icons and shapes drawn properly, text sharp and evenly set.',
    options.logoClearSpace
      ? `Draw no logo, wordmark, brand name or watermark: the brand's own logo is added afterwards. ${options.logoClearSpace}`
      : 'Draw no logo, brand name or watermark other than any wordmark listed above.',
    `The output is ${shapeWords(options.target)} image.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

export type LookPlan = {
  image: ImageBytes
  /** Before the logo went on; only when it did. */
  baseImage?: ImageBytes
  design: LookDesign
  prompt: string
  rendered: RenderedImage
  logo: { placement: LogoPlacement; plate: 'none' | 'light' | 'dark' } | null
  issues: string[]
  review: {
    checked: boolean
    passed: boolean
    summary?: string
    images: number
  }
  usage: CallUsage
  /** The examples followed, by their place in the list given. */
  followed: number[]
  /** The same examples by id, where they have one. */
  followedIds: string[]
}

/** An example as the models get it: full size for the image model, small for the ones that look. */
export type ShownExample = LookExample & { small: Buffer }

/** Each example with a small copy, for the models that look at it. */
export const withSmallCopies = (examples: LookExample[]): Promise<ShownExample[]> =>
  Promise.all(
    examples.map(async e => ({
      ...e,
      small: await downscaleForReview(e.data).catch(() => e.data)
    }))
  )

/** A designed image made: everything in a LookPlan but the design call's share. */
export type LookRender = Omit<
  LookPlan,
  'design' | 'followed' | 'followedIds' | 'usage'
>

/**
 * Draws a design: the image model with the chosen examples attached (after
 * `anchor`, when the image must match another), a vision check, one more
 * try with what the check found, the better of the two kept, and the
 * brand's real logo laid on where the examples keep theirs. Returns the
 * reason instead when no model drew anything. Throws
 * ImageGenerationAbortedError when stopped.
 */
export async function renderLook(req: {
  design: LookDesign
  /** The examples the design follows, in its order. */
  followed: ShownExample[]
  /** Attached before the examples: the image this one must match. */
  anchor?: Buffer | null
  series?: SeriesPlace
  platformName: string
  target: { width: number; height: number }
  brand: BrandRendering
  /** What the image goes with, for the check: the post, or a carousel's caption and slides. */
  postText: string
  accountName: string
  seed?: number
  abortSignal?: AbortSignal
}): Promise<
  { render: LookRender; usage: CallUsage } | { error: string; usage: CallUsage }
> {
  let usage: CallUsage = EMPTY_USAGE
  const add = (u: CallUsage) => {
    usage = addUsage(usage, u)
  }
  const { design } = req
  const logoFile = Boolean(req.brand.theme.showLogo && req.brand.logo)
  const series =
    req.series && !req.anchor ? { ...req.series, anchor: null } : req.series
  const references = [
    ...(req.anchor ? [req.anchor] : []),
    ...req.followed.map(e => e.data)
  ]

  // Where the real logo goes: the examples' corner, when they keep one.
  const placement =
    logoFile && design.logoCorner !== 'none'
      ? CORNER_PLACEMENT[design.logoCorner]
      : null
  let logoClearSpace: string | undefined
  if (placement && req.brand.logo) {
    const size = await imageSize(req.brand.logo)
    if (size) {
      logoClearSpace = logoClearSpaceInstruction(
        req.target,
        logoBox(req.target, size, placement),
        placement
      )
    }
  }
  const basePrompt = buildLookPrompt({
    design,
    platformName: req.platformName,
    target: req.target,
    exampleCount: req.followed.length,
    logoClearSpace,
    series
  })

  type Try = {
    rendered: RenderedImage
    prompt: string
    issues: string[] | null
    summary?: string
  }
  const tries: Try[] = []
  let prompt = basePrompt
  for (let pass = 0; pass < 2; pass++) {
    let rendered: RenderedImage
    try {
      rendered = await renderImage({
        prompt,
        references,
        target: req.target,
        // A design's words reach its edges: never cut them to fit the shape.
        pad: design.kind === 'graphic',
        seed: pass === 0 ? (req.seed ?? randomSeed()) : randomSeed(),
        abortSignal: req.abortSignal,
        onUsage: add
      })
    } catch (err) {
      if (err instanceof ImageGenerationAbortedError) throw err
      // A retry that fails leaves the first image standing.
      if (tries.length > 0) break
      return {
        error:
          err instanceof Error ? err.message : 'No image model drew the image.',
        usage
      }
    }
    const checked = await reviewLook({
      image: await downscaleForReview(rendered.buffer),
      mediaType: 'image/jpeg',
      examples: req.followed.map(e => ({
        data: e.small,
        mediaType: 'image/jpeg'
      })),
      postText: req.postText,
      concept: design.concept,
      text: design.text,
      accountName: req.accountName,
      abortSignal: req.abortSignal
    })
    add(checked.usage)
    const issues = checked.review ? lookIssues(checked.review) : null
    tries.push({ rendered, prompt, issues, summary: checked.review?.summary })
    if (!checked.review || issues!.length === 0) break
    const fixes = lookRetryLines(checked.review)
    prompt = fixes ? `${basePrompt}\n\n${fixes}` : basePrompt
  }

  // A clean image beats one with problems; an unchecked one sits between.
  const rank = (t: Try) => (t.issues === null ? 50 : t.issues.length * 100)
  const best = [...tries].sort((a, b) => rank(a) - rank(b))[0]!

  let image: ImageBytes = {
    buffer: best.rendered.buffer,
    mediaType: best.rendered.mediaType
  }
  let baseImage: ImageBytes | undefined
  let logo: LookPlan['logo'] = null
  const notes: string[] = []
  if (placement && req.brand.logo) {
    try {
      const composed = await compositeLogo(best.rendered.buffer, {
        logo: req.brand.logo,
        placement
      })
      baseImage = image
      image = { buffer: composed.buffer, mediaType: composed.mediaType }
      logo = { placement, plate: composed.plate }
    } catch (err) {
      console.warn('Could not add the brand logo:', err)
      notes.push('The brand logo could not be added to this image.')
    }
  }

  return {
    render: {
      image,
      ...(baseImage ? { baseImage } : {}),
      prompt: best.prompt,
      rendered: best.rendered,
      logo,
      issues: [...(best.issues ?? []), ...notes],
      review: {
        checked: best.issues !== null,
        passed: best.issues !== null && best.issues.length === 0,
        summary: best.summary,
        images: tries.length
      }
    },
    usage
  }
}

/**
 * Makes the image. Returns the reason instead when it cannot (the design
 * failed, or no model drew anything), so the caller can fall back to the
 * designed image. Throws ImageGenerationAbortedError when stopped.
 */
export async function createLookImage(req: {
  postText: string
  platform: PlatformId
  target: { width: number; height: number }
  context: MediaBriefContext
  examples: LookExample[]
  brand: BrandRendering
  direction?: string
  previousVersions?: PriorVisual[]
  rejectionReason?: string
  /** The account's latest looks on this platform, so this one differs. */
  recentLooks?: RecentLook[]
  seed?: number
  abortSignal?: AbortSignal
}): Promise<{ plan: LookPlan } | { error: string; usage: CallUsage }> {
  const platformName = PLATFORMS[req.platform].name
  const logoFile = Boolean(req.brand.theme.showLogo && req.brand.logo)

  // Small copies for the models that look; the image model gets the stored ones.
  const shown = await withSmallCopies(req.examples)

  const designed = await designLook(
    {
      postText: req.postText,
      platform: { name: platformName, shape: shapeWords(req.target) },
      context: req.context,
      examples: shown.map(e => ({
        data: e.small,
        mediaType: 'image/jpeg',
        platformName: PLATFORMS[e.platform].name,
        samePlatform: e.platform === req.platform,
        uploaded: e.source === 'upload',
        aspect: exampleAspect(e.width, e.height)
      })),
      logoFile,
      direction: req.direction,
      previousVersions: req.previousVersions,
      rejectionReason: req.rejectionReason,
      recentLooks: numberRecentLooks(req.recentLooks ?? [], req.examples)
    },
    { abortSignal: req.abortSignal }
  )
  if (req.abortSignal?.aborted) throw new ImageGenerationAbortedError()
  if (!designed.design) return { error: designed.error, usage: designed.usage }
  const design = designed.design
  const followed = design.examples.map(n => n - 1)

  const made = await renderLook({
    design,
    followed: followed.map(i => shown[i]!),
    platformName,
    target: req.target,
    brand: req.brand,
    postText: req.postText,
    accountName: req.context.accountName || '',
    seed: req.seed,
    abortSignal: req.abortSignal
  })
  const usage = addUsage(designed.usage, made.usage)
  if ('error' in made) return { error: made.error, usage }
  const followedIds = followed
    .map(i => shown[i]?.id)
    .filter((id): id is string => Boolean(id))
  return { plan: { ...made.render, design, usage, followed, followedIds } }
}

/** The style choice that makes images this way. */
export const LOOK_STYLE = LIKE_MY_POSTS
