import { db } from '@/db'
import { imageForVariant } from '@/lib/publishing/buffer/image-variant'
import { anyBufferConfig } from '@/lib/publishing/config'
import { loadPostImage, loadPostSlideImage } from '@/lib/publishing/engine'
import { PostImageError } from '@/lib/publishing/errors'
import {
  isMediaVariant,
  MEDIA_VARIANT_PARAM,
  parseMediaSubject,
  verifyMediaToken
} from '@/lib/publishing/media-token'
import { isUuid } from '@/lib/ids'

/**
 * A post's image for a publishing provider that fetches it itself (Buffer,
 * for X, Facebook and Instagram). No session: Buffer's servers call it. Only
 * a token this server signed for that one post, within its day, opens it
 * (media-token.ts), and it serves nothing but that post's current image, or
 * the one carousel slide it was signed for, encoded as the network takes it
 * when the link names one (?for=instagram).
 */

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' }
  })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const config = anyBufferConfig()
  const subject = config
    ? verifyMediaToken(config.encryptionKey, (await params).token)
    : null
  if (!subject) return notFound()
  // A post's image, or one slide of its carousel (a token signed for that slide).
  const { draftId, slideId } = parseMediaSubject(subject)
  if (!isUuid(draftId) || (slideId && !isUuid(slideId))) return notFound()

  try {
    const original = slideId
      ? await loadPostSlideImage(db, draftId, slideId)
      : await loadPostImage(db, draftId)
    if (!original) return notFound()
    const variant = new URL(request.url).searchParams.get(MEDIA_VARIANT_PARAM)
    const image = isMediaVariant(variant)
      ? await imageForVariant(variant, original)
      : original
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        'Content-Type': image.mediaType,
        'Content-Length': String(image.bytes.length),
        'Cache-Control': 'private, max-age=3600',
        'X-Robots-Tag': 'noindex',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch (err) {
    if (err instanceof PostImageError) return notFound()
    console.error(`Could not serve the image of post ${draftId}:`, err)
    return new Response('Unavailable', { status: 503 })
  }
}
