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
  deleteSlide,
  moveSlide,
  rewriteSlideForPost,
  setSlidePicture,
  updateSlide
} from '~/lib/carousel/service'
import { CONTENT_LAYOUTS, SLIDE_TEXT } from '~/lib/carousel/types'
import { ICON_NAMES } from '~/lib/media/canvas/icon-names'

/**
 * One slide of a post's carousel.
 *
 * PATCH   the reviewer's own edit: headline, body, picture prompt, layout,
 *         icon, figure or emphasis. Drawn again around its picture; no AI.
 * POST    { action: 'rewrite', instruction? }  written again by AI.
 *         { action: 'picture', prompt? }  a new picture from its prompt.
 *         { action: 'remove_picture' }
 *         { action: 'move', direction: 'up' | 'down' }
 * DELETE  removes it (content slides only).
 */

const patchSchema = z.object({
  headline: z
    .string()
    .max(SLIDE_TEXT.headline.hard * 2)
    .optional(),
  body: z
    .string()
    .max(SLIDE_TEXT.body.hard * 2)
    .optional(),
  imagePrompt: z
    .string()
    .max(SLIDE_TEXT.imagePrompt.hard * 2)
    .optional(),
  design: z
    .object({
      // A cover or call-to-action slide keeps its own layout whatever is sent.
      layout: z.enum([...CONTENT_LAYOUTS, 'cover', 'cta']).optional(),
      icon: z.enum(ICON_NAMES).nullish(),
      stat: z.string().max(40).nullish(),
      emphasis: z.array(z.string().max(60)).max(5).optional()
    })
    .optional()
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('rewrite'),
    instruction: z.string().max(1000).nullish()
  }),
  z.object({
    action: z.literal('picture'),
    prompt: z
      .string()
      .max(SLIDE_TEXT.imagePrompt.hard * 2)
      .nullish()
  }),
  z.object({ action: z.literal('remove_picture') }),
  z.object({ action: z.literal('move'), direction: z.enum(['up', 'down']) })
])

type Params = { params: Promise<{ id: string; slideId: string }> }

export async function PATCH(request: Request, { params }: Params) {
  if (!(await getSessionUser())) return signedOut()
  const { id, slideId } = await params
  const who = await identityFor([id, slideId])
  if ('response' in who) return who.response
  const parsed = patchSchema.safeParse(await jsonBody(request))
  if (!parsed.success)
    return fail(400, parsed.error.issues[0]?.message || 'Invalid slide.')
  try {
    const slide = await updateSlide(who.accountId, id, slideId, {
      ...parsed.data,
      design: parsed.data.design && {
        ...parsed.data.design,
        icon: parsed.data.design.icon ?? undefined,
        stat: parsed.data.design.stat ?? undefined
      }
    })
    return Response.json({ success: true, slide })
  } catch (err) {
    return errorResponse(err, request, 'Could not save the slide')
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!(await getSessionUser())) return signedOut()
  const { id, slideId } = await params
  const who = await identityFor([id, slideId])
  if ('response' in who) return who.response
  const parsed = actionSchema.safeParse(await jsonBody(request))
  if (!parsed.success)
    return fail(400, parsed.error.issues[0]?.message || 'Invalid request.')
  const body = parsed.data
  try {
    switch (body.action) {
      case 'rewrite':
        return Response.json({
          success: true,
          slide: await rewriteSlideForPost(who.accountId, id, slideId, {
            instruction: body.instruction?.trim() || null,
            abortSignal: request.signal
          })
        })
      case 'picture':
        return Response.json({
          success: true,
          slide: await setSlidePicture(who.accountId, id, slideId, {
            prompt: body.prompt,
            abortSignal: request.signal
          })
        })
      case 'remove_picture':
        return Response.json({
          success: true,
          slide: await setSlidePicture(who.accountId, id, slideId, {
            remove: true
          })
        })
      case 'move':
        return Response.json({
          success: true,
          slides: await moveSlide(who.accountId, id, slideId, body.direction)
        })
    }
  } catch (err) {
    return errorResponse(err, request, 'Could not update the slide')
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await getSessionUser())) return signedOut()
  const { id, slideId } = await params
  const who = await identityFor([id, slideId])
  if ('response' in who) return who.response
  try {
    return Response.json({
      success: true,
      slides: await deleteSlide(who.accountId, id, slideId)
    })
  } catch (err) {
    return errorResponse(err, request, 'Could not delete the slide')
  }
}
