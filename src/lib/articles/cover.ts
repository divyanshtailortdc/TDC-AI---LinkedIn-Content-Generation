import 'server-only'

import type { Article, Idea } from '@/db/schema'
import { DEFAULT_BRAND_THEME } from '@/lib/brand/theme'
import { loadGenerationContext, loadIdeaContext } from '~/lib/ai/context'
import { EMPTY_USAGE, type CallUsage } from '~/lib/ai/usage'
import { createMediaPlan, planHasImage } from '~/lib/media'
import { loadBrandRendering } from '~/lib/media/brand-assets'
import { decodeImageDataUrl } from '~/lib/media/brand-logo'
import { buildMediaBriefContext } from '~/lib/media/brief-context'
import { storeImage, storeMediaImages } from '~/lib/media/image-store'
import { articleToPlainText } from './blocks'

/**
 * An article's cover image: uploaded by the reviewer, linked, or generated
 * from the article by the same image pipeline posts use (brand colours and
 * logo), as a 16:9 banner. Images live in the same store as post images,
 * under the article's own id.
 */

/** Upload limit, after base64 decoding. */
export const COVER_MAX_BYTES = 5 * 1024 * 1024
const COVER_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
])

/** Checks an uploaded data URL; the error is for the reviewer. */
export function parseCoverUpload(
  dataUrl: string
): { buffer: Buffer; mediaType: string } | { error: string } {
  const image = decodeImageDataUrl(dataUrl)
  if (!image) return { error: 'That file is not an image this app can read.' }
  if (!COVER_TYPES.has(image.mediaType)) {
    return { error: 'Use a PNG, JPEG, WebP or GIF image.' }
  }
  if (image.buffer.length === 0) return { error: 'That image is empty.' }
  if (image.buffer.length > COVER_MAX_BYTES) {
    return { error: 'That image is larger than 5 MB.' }
  }
  return image
}

/** Stores an uploaded cover; returns what `cover_image_url` holds. */
export async function storeCoverUpload(
  articleId: string,
  image: { buffer: Buffer; mediaType: string }
): Promise<string> {
  const stored = await storeImage(image, articleId)
  if (!stored) throw new Error('The image could not be saved.')
  return stored
}

/**
 * Generates a cover from the article and its suggested concept. Returns the
 * stored image, or the reason there is none; `usage` is what it cost either
 * way.
 */
export async function generateCover(
  article: Pick<
    Article,
    | 'id'
    | 'accountId'
    | 'platform'
    | 'title'
    | 'subtitle'
    | 'content'
    | 'coverSuggestion'
  >,
  idea: Idea | null
): Promise<
  | { imageUrl: string; altText: string | null; usage: CallUsage }
  | { error: string; usage: CallUsage }
> {
  const ctx = idea
    ? await loadIdeaContext(idea, { platform: article.platform })
    : await loadGenerationContext(article.accountId, {
        goalIds: [],
        platform: article.platform
      })
  const text = articleToPlainText({
    title: article.title,
    subtitle: article.subtitle,
    content: article.content ?? []
  }).slice(0, 4000)

  const plan = await createMediaPlan({
    mode: 'ai_generated',
    postText: text,
    context: buildMediaBriefContext(ctx, idea),
    brand: await loadBrandRendering(
      article.accountId,
      ctx.brand ?? DEFAULT_BRAND_THEME
    ),
    aspectRatio: '16:9',
    direction: article.coverSuggestion?.concept || undefined
  })
  const usage = plan.usage ?? EMPTY_USAGE
  if (!planHasImage(plan)) {
    return { error: plan.error || 'No image was produced.', usage }
  }
  const { imageUrl } = await storeMediaImages(article.id, plan)
  if (!imageUrl) return { error: 'The image could not be saved.', usage }
  return {
    imageUrl,
    altText: plan.altText || article.coverSuggestion?.altText || null,
    usage
  }
}
