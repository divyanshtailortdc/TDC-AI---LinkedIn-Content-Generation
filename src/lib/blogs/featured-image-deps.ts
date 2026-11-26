import 'server-only'

import sharp from 'sharp'
import { reviewImage } from '~/lib/ai/skills/image-review'
import { storeBlogImage } from '~/lib/media/image-store'
import { renderImage } from '~/lib/media/render-image'
import { WEBP_QUALITY, type FeaturedImageDeps } from './featured-image'

/**
 * The featured image's real model calls and storage: the image models
 * (best first), the vision check every generated picture gets (no lettering
 * allowed), WebP via sharp, and the bucket (or a data URL without one).
 */
export const FEATURED_IMAGE_DEPS: FeaturedImageDeps = {
  render: request => renderImage(request),
  review: async input => {
    const result = await reviewImage({
      image: input.image,
      mediaType: input.mediaType,
      postText: input.title,
      concept: input.concept,
      headline: '',
      style: input.style,
      abortSignal: input.abortSignal
    })
    if (!result.verdict) return { issues: [], usage: result.usage }
    return {
      issues: result.verdict.passed ? [] : result.verdict.issues,
      usage: result.usage
    }
  },
  toWebp: async buffer => ({
    buffer: await sharp(buffer).webp({ quality: WEBP_QUALITY }).toBuffer(),
    mediaType: 'image/webp'
  }),
  store: storeBlogImage,
  now: () => new Date()
}
