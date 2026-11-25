import type { ResolvedBrandTheme } from '@/lib/brand/theme'
import { addUsage, EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import { randomSeed, type RenderedImage } from '~/lib/media/render-image'
import { buildPicturePrompt } from '~/lib/media/style-prompt'
import type { FeaturedImage } from './types'

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
  abortSignal?: AbortSignal
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

/** The image model's prompt: the concept, the style in the brand's colours, no text. */
export function featuredImagePrompt(
  input: Pick<FeaturedImageRequest, 'concept' | 'style' | 'theme' | 'direction'>
): string {
  const direction = input.direction?.trim()
  return buildPicturePrompt({
    style: pictureStyle(input.style),
    scene: [
      `An editorial header image for an article: ${input.concept.trim()}`,
      direction ? `The author asks: ${direction}` : ''
    ]
      .filter(Boolean)
      .join('\n'),
    styleDirection:
      'Calm, considered and specific to the subject, like the lead image of a respected business publication; not a generic stock scene.',
    theme: input.theme,
    frame: FEATURED_IMAGE_SIZE
  })
}

export async function makeFeaturedImage(
  input: FeaturedImageRequest,
  deps: FeaturedImageDeps
): Promise<{ image: FeaturedImage; usage: CallUsage }> {
  let usage: CallUsage = EMPTY_USAGE
  const prompt = featuredImagePrompt(input)
  const failed = (error: string): FeaturedImage => ({
    status: 'failed',
    error,
    alt: input.alt,
    prompt
  })
  try {
    const attempt = async (text: string) =>
      deps.render({
        prompt: text,
        target: FEATURED_IMAGE_SIZE,
        seed: randomSeed(),
        crop: true,
        abortSignal: input.abortSignal,
        onUsage: cost => {
          usage = addUsage(usage, cost)
        }
      })
    const check = async (image: RenderedImage) => {
      const review = await deps
        .review({
          image: image.buffer,
          mediaType: image.mediaType,
          title: input.title,
          concept: input.concept,
          style: pictureStyle(input.style),
          abortSignal: input.abortSignal
        })
        .catch(() => null)
      if (review) usage = addUsage(usage, review.usage)
      return review?.issues ?? []
    }

    let used = prompt
    let image = await attempt(used)
    const issues = await check(image)
    if (issues.length > 0 && !input.abortSignal?.aborted) {
      used = `${prompt}\n\nThe last attempt had these problems; avoid them: ${issues.join(' ')}`
      image = await attempt(used)
    }
    const webp = await deps.toWebp(image.buffer)
    const src = await deps.store(webp, input.blogId)
    return {
      image: {
        status: 'ready',
        src,
        alt: input.alt,
        caption: '',
        width: FEATURED_IMAGE_SIZE.width,
        height: FEATURED_IMAGE_SIZE.height,
        mediaType: webp.mediaType,
        model: image.modelId,
        prompt: used,
        createdAt: deps.now().toISOString()
      },
      usage
    }
  } catch (error) {
    const message =
      input.abortSignal?.aborted
        ? 'Making the image took too long. Make it again from the editor.'
        : error instanceof Error && error.message
          ? error.message
          : 'The image could not be made.'
    return { image: failed(message.slice(0, 300)), usage }
  }
}
