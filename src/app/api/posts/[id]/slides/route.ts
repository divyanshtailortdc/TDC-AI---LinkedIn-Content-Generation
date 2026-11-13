import { z } from 'zod'
import {
  errorResponse,
  fail,
  getSessionUser,
  identityFor,
  jsonBody,
  signedOut
} from '~/lib/carousel/http'
import {
  addSlide,
  createCarouselForPost,
  loadCarousel,
  redrawCarousel
} from '~/lib/carousel/service'

/**
 * A post's carousel slides.
 *
 * GET   the slides, in order, with a link to each drawn image.
 * POST  { action: 'generate', instruction?, replace? }  writes and draws the
 *       whole carousel, turning the post into one; takes up to a minute or
 *       two and stops when the browser aborts the request. A post that has
 *       slides keeps them unless `replace` (Write again) is set.
 *       { action: 'add', after }  adds a blank content slide after `after`.
 *       { action: 'redraw' }  draws every slide again in the current brand.
 */

const MAX_INSTRUCTION_CHARS = 1000

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate'),
    instruction: z.string().max(MAX_INSTRUCTION_CHARS).nullish(),
    // Write slides the post already has again; without it they are kept.
    replace: z.boolean().optional()
  }),
  z.object({
    action: z.literal('add'),
    after: z.number().int().min(1).max(50)
  }),
  z.object({ action: z.literal('redraw') })
])

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  if (!(await getSessionUser())) return signedOut()
  const { id } = await params
  const who = await identityFor([id])
  if ('response' in who) return who.response
  try {
    const slides = await loadCarousel(who.accountId, id)
    return Response.json(
      { success: true, slides },
      // Signed links expire; the page keeps the ones it got.
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (err) {
    return errorResponse(err, request, 'Could not load the slides')
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!(await getSessionUser())) return signedOut()
  const { id } = await params
  const who = await identityFor([id])
  if ('response' in who) return who.response
  const parsed = bodySchema.safeParse(await jsonBody(request))
  if (!parsed.success)
    return fail(400, parsed.error.issues[0]?.message || 'Invalid request.')
  const body = parsed.data
  try {
    if (body.action === 'generate') {
      const result = await createCarouselForPost(who.accountId, id, {
        instruction: body.instruction?.trim() || null,
        abortSignal: request.signal,
        replace: body.replace === true
      })
      return Response.json({ success: true, ...result })
    }
    const slides =
      body.action === 'add'
        ? await addSlide(who.accountId, id, body.after)
        : await redrawCarousel(who.accountId, id)
    return Response.json({ success: true, slides })
  } catch (err) {
    return errorResponse(err, request, 'Could not update the carousel')
  }
}
