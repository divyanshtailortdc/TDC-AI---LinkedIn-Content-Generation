import {
  errorResponse,
  fail,
  getSessionUser,
  identityFor,
  signedOut
} from '~/lib/carousel/http'
import { loadSlideImages } from '~/lib/carousel/service'
import { slidesToPdf, slidesToZip } from '~/lib/media/carousel/export'

/**
 * Every slide of a post's carousel as one file, to post by hand or keep:
 * ?as=zip (the default), the slide images in order; ?as=pdf, one page per
 * slide, as LinkedIn takes a document carousel.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await getSessionUser())) return signedOut()
  const { id } = await params
  const who = await identityFor([id])
  if ('response' in who) return who.response
  const as =
    new URL(request.url).searchParams.get('as') === 'pdf' ? 'pdf' : 'zip'
  try {
    const images = await loadSlideImages(who.accountId, id)
    if (images.length === 0)
      return fail(404, 'This post has no drawn slides yet.')
    const name = `carousel-${id.slice(0, 8)}`
    const file =
      as === 'pdf'
        ? await slidesToPdf(
            images.map(i => ({ bytes: i.buffer, mediaType: i.mediaType }))
          )
        : await slidesToZip(
            images.map(i => ({ bytes: i.buffer, mediaType: i.mediaType })),
            'slide'
          )
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': as === 'pdf' ? 'application/pdf' : 'application/zip',
        'Content-Length': String(file.length),
        'Content-Disposition': `attachment; filename="${name}.${as}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    })
  } catch (err) {
    return errorResponse(err, request, 'Could not prepare the download')
  }
}
