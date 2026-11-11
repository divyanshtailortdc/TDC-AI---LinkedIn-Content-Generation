import { db } from '@/db'
import { bufferConfig } from '@/lib/publishing/config'
import { loadPostImage } from '@/lib/publishing/engine'
import { PostImageError } from '@/lib/publishing/errors'
import { verifyMediaToken } from '@/lib/publishing/media-token'

/**
 * A post's image for a publishing provider that fetches it itself (Buffer,
 * for X). No session: Buffer's servers call it. Only a token this server
 * signed for that one post, within its day, opens it (media-token.ts), and
 * it serves nothing but that post's current image.
 */

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' }
  })

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const config = bufferConfig()
  const draftId = config
    ? verifyMediaToken(config.encryptionKey, (await params).token)
    : null
  if (!draftId) return notFound()

  try {
    const image = await loadPostImage(db, draftId)
    if (!image) return notFound()
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
