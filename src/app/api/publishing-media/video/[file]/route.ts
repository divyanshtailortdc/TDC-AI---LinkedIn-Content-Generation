import { isUuid } from '@/lib/ids'
import { anyBufferConfig } from '@/lib/publishing/config'
import {
  parseVideoSubject,
  verifyMediaToken
} from '@/lib/publishing/media-token'
import { openStoredFile } from '~/lib/media/image-store'
import { readyVideoFile } from '~/lib/video/post-video'

/**
 * A Reel's or Short's video for a publishing provider that fetches it itself
 * (Buffer). No session: Buffer's servers call it. Only a token this server
 * signed for that one video, within its day, opens it (media-token.ts).
 *
 * Served by the app rather than linked straight to the bucket: a bucket's
 * signed link is signed for GET alone and refuses HEAD, which Buffer sends
 * first, so Buffer said the video "could not be read". HEAD is answered here
 * from the database; GET streams the file from the bucket, ranges included.
 */

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' }
  })

const COMMON_HEADERS = {
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'private, max-age=3600',
  'X-Robots-Tag': 'noindex',
  'X-Content-Type-Options': 'nosniff'
}

/** The token in "<token>.mp4"; empty (a 404) for a malformed one. */
const tokenOf = async (params: Promise<{ file: string }>) => {
  const file = (await params).file
  try {
    return decodeURIComponent(file).replace(/\.mp4$/, '')
  } catch {
    return ''
  }
}

/** The video a verified token's subject names, or null for anything else. */
function videoIdOf(subject: string | null): string | null {
  const videoId = subject ? parseVideoSubject(subject) : null
  return videoId && isUuid(videoId) ? videoId : null
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const config = anyBufferConfig()
  const subject = config
    ? verifyMediaToken(config.encryptionKey, await tokenOf(params))
    : null
  const videoId = videoIdOf(subject)
  if (!videoId) return notFound()
  console.info(
    `Video ${videoId}: HEAD from ${request.headers.get('user-agent') ?? 'unknown'}`
  )
  try {
    const video = await readyVideoFile(videoId)
    if (!video) return notFound()
    return new Response(null, {
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': video.mediaType,
        ...(video.byteSize !== null && {
          'Content-Length': String(video.byteSize)
        })
      }
    })
  } catch (err) {
    console.error(`Could not describe video ${videoId}:`, err)
    return new Response(null, { status: 503 })
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const config = anyBufferConfig()
  const subject = config
    ? verifyMediaToken(config.encryptionKey, await tokenOf(params))
    : null
  const videoId = videoIdOf(subject)
  if (!videoId) return notFound()
  const range = request.headers.get('range')
  console.info(
    `Video ${videoId}: GET${range ? ` ${range}` : ''} from ${request.headers.get('user-agent') ?? 'unknown'}`
  )
  try {
    const video = await readyVideoFile(videoId)
    if (!video) return notFound()
    const file = await openStoredFile(video.videoUrl, range)
    return new Response(file.body, {
      status: file.contentRange ? 206 : 200,
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': video.mediaType,
        ...(file.contentLength !== null && {
          'Content-Length': String(file.contentLength)
        }),
        ...(file.contentRange && { 'Content-Range': file.contentRange })
      }
    })
  } catch (err) {
    console.error(`Could not serve video ${videoId}:`, err)
    return new Response('Unavailable', { status: 503 })
  }
}
