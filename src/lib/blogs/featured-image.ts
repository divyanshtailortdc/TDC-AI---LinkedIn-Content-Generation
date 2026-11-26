import type { ResolvedBrandTheme } from '@/lib/brand/theme'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import { randomSeed, type RenderedImage } from '~/lib/media/render-image'
import { buildPicturePrompt } from '~/lib/media/style-prompt'
import type { BlogImage, FeaturedImage } from './types'

/**
 * A blog's featured image: one editorial picture for the top of the page,
 * made from the plan's concept in the brand's colours, with no text in it.
 * A vision check looks for stray lettering and logos and the picture is made
 * once more when it finds any. Failing never fails the blog: the result is a
 * failed image with the reason, and the editor offers Make again.
 *
 * The model calls and storage are passed in (FeaturedImageDeps), so the
 * flow is tested without either; ./featured-image-deps.ts gives the real ones.
 */

/** 16:9, wide enough for a page header and for social previews. */
export const FEATURED_IMAGE_SIZE = { width: 1600, height: 900 } as const

/** 3:2 for a picture inside a section: full column width, not a banner. */
export const SUPPORTING_IMAGE_SIZE = { width: 1200, height: 800 } as const

/** WebP at this quality keeps a header photo near 150-300 KB. */
export const WEBP_QUALITY = 82

export type FeaturedImageRequest = {
  blogId: string
  /** The piece's title: what the picture is for, for the check. */
  title: string
  concept: string
  alt: string
  style: 'photo' | 'illustration'
  theme: ResolvedBrandTheme
  /** What the author asked for when making it again. */
  direction?: string
  /**
   * The look every picture of the piece shares (the plan's imageDirection),
   * so the header and the section pictures read as one set.
   */
  look?: string
  abortSignal?: AbortSignal
}

/** A picture for one section: the same as the header's request, at its own size. */
export type SupportingImageRequest = FeaturedImageRequest & {
  /** The section's heading: what the picture is for, for the check. */
  section: string
  caption: string
}

export type FeaturedImageDeps = {
  render: (request: {
    prompt: string
    target: { width: number; height: number }
    seed: number
    crop: boolean
    abortSignal?: AbortSignal
    onUsage: (usage: CallUsage) => void
  }) => Promise<RenderedImage>
  /** Problems a vision check sees (lettering, logos, artefacts); empty when fine. */
  review: (input: {
    image: Buffer
    mediaType: string
    title: string
    concept: string
    style: 'photorealistic' | 'illustration'
    abortSignal?: AbortSignal
  }) => Promise<{ issues: string[]; usage: CallUsage } | null>
  toWebp: (buffer: Buffer) => Promise<{ buffer: Buffer; mediaType: string }>
  store: (image: { buffer: Buffer; mediaType: string }, blogId: string) => Promise<string>
  now: () => Date
}

const pictureStyle = (style: FeaturedImageRequest['style']) =>
  style === 'illustration' ? 'illustration' : 'photorealistic'

const STYLE_DIRECTION =
  'Calm, considered and specific to the subject, like the photography of a respected business publication; not a generic stock scene, no people posing at laptops or shaking hands.'

/** The image model's prompt: the concept, the style in the brand's colours, no text. */
export function featuredImagePrompt(
  input: Pick<FeaturedImageRequest, 'concept' | 'style' | 'theme' | 'direction' | 'look'>,
  role: 'featured' | 'supporting' = 'featured'
): string {
  const direction = input.direction?.trim()
  const look = input.look?.trim()
  return buildPicturePrompt({
    style: pictureStyle(input.style),
    scene: [
      role === 'featured'
        ? `An editorial header image for an article: ${input.concept.trim()}`
        : `An editorial picture inside an article, showing: ${input.concept.trim()}`,
      direction ? `The author asks: ${direction}` : ''
    ]
      .filter(Boolean)
      .join('\n'),
    styleDirection: [STYLE_DIRECTION, look ? `Every picture in this article shares this look: ${look}` : '']
      .filter(Boolean)
      .join(' '),
    theme: input.theme,
    frame: role === 'featured' ? FEATURED_IMAGE_SIZE : SUPPORTING_IMAGE_SIZE
  })
}

/** A picture made, checked and stored; `flagged` when the check still saw problems after the retry. */
type MadePicture = {
  src: string
  mediaType: string
  model: string | null
  prompt: string
  flagged: boolean
}

/**
 * Renders one picture, has the vision check look for lettering, logos and
 * artefacts, makes it once more when it finds any (checking the second one
 * too), then stores it as WebP. Throws when no picture could be made.
 */
async function makePicture(
  input: FeaturedImageRequest & { checkTitle: string },
  prompt: string,
  frame: { width: number; height: number },
  deps: FeaturedImageDeps,
  onUsage: (usage: CallUsage) => void
): Promise<MadePicture> {
  const attempt = async (text: string) =>
    deps.render({
      prompt: text,
      target: frame,
      seed: randomSeed(),
      crop: true,
      abortSignal: input.abortSignal,
      onUsage
    })
  const check = async (image: RenderedImage) => {
    const review = await deps
      .review({
        image: image.buffer,
        mediaType: image.mediaType,
        title: input.checkTitle,
        concept: input.concept,
        style: pictureStyle(input.style),
        abortSignal: input.abortSignal
      })
      .catch(() => null)
    if (review) onUsage(review.usage)
    return review?.issues ?? []
  }

  let used = prompt
  let image = await attempt(used)
  let issues = await check(image)
  let flagged = false
  if (issues.length > 0 && !input.abortSignal?.aborted) {
    used = `${prompt}\n\nThe last attempt had these problems; avoid them: ${issues.join(' ')}`
    image = await attempt(used)
    issues = input.abortSignal?.aborted ? [] : await check(image)
    flagged = issues.length > 0
  }
  const webp = await deps.toWebp(image.buffer)
  const src = await deps.store(webp, input.blogId)
  return { src, mediaType: webp.mediaType, model: image.modelId, prompt: used, flagged }
}

const failureMessage = (error: unknown, aborted: boolean | undefined) =>
  (aborted
    ? 'Making the image took too long. Make it again from the editor.'
    : error instanceof Error && error.message
      ? error.message
      : 'The image could not be made.'
  ).slice(0, 300)

export async function makeFeaturedImage(
  input: FeaturedImageRequest,
  deps: FeaturedImageDeps
): Promise<{ image: FeaturedImage; usage: CallUsage }> {
  let usage: CallUsage = EMPTY_USAGE
  const prompt = featuredImagePrompt(input)
  try {
    const made = await makePicture(
      { ...input, checkTitle: input.title },
      prompt,
      FEATURED_IMAGE_SIZE,
      deps,
      cost => {
        usage = addUsage(usage, cost)
      }
    )
    return {
      image: {
        status: 'ready',
        src: made.src,
        alt: input.alt,
        caption: '',
        width: FEATURED_IMAGE_SIZE.width,
        height: FEATURED_IMAGE_SIZE.height,
        mediaType: made.mediaType,
        model: made.model,
        prompt: made.prompt,
        createdAt: deps.now().toISOString()
      },
      usage
    }
  } catch (error) {
    return {
      image: {
        status: 'failed',
        error: failureMessage(error, input.abortSignal?.aborted),
        alt: input.alt,
        prompt
      },
      usage
    }
  }
}

/**
 * A picture for one section, made like the featured image and stored with
 * the blog. `image` is null when none could be made, with the reason; a
 * section picture never fails the blog.
 */
export async function makeSupportingImage(
  input: SupportingImageRequest,
  deps: FeaturedImageDeps & { newId: () => string }
): Promise<{ image: BlogImage | null; error?: string; usage: CallUsage }> {
  let usage: CallUsage = EMPTY_USAGE
  const prompt = featuredImagePrompt(input, 'supporting')
  try {
    const made = await makePicture(
      { ...input, checkTitle: `${input.title}: ${input.section}` },
      prompt,
      SUPPORTING_IMAGE_SIZE,
      deps,
      cost => {
        usage = addUsage(usage, cost)
      }
    )
    return {
      image: {
        id: deps.newId(),
        src: made.src,
        width: SUPPORTING_IMAGE_SIZE.width,
        height: SUPPORTING_IMAGE_SIZE.height,
        mediaType: made.mediaType,
        model: made.model,
        prompt: made.prompt,
        concept: input.concept,
        createdAt: deps.now().toISOString(),
        ...(made.flagged && { flagged: true })
      },
      usage
    }
  } catch (error) {
    return { image: null, error: failureMessage(error, input.abortSignal?.aborted), usage }
  }
}
