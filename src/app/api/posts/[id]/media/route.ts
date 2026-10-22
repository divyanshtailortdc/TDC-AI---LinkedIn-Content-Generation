import { VISUAL_TYPES } from '~/lib/ai/skills/media-brief/schema'
import { ImageGenerationAbortedError, readImageDimensions } from '~/lib/media'
import {
  MAX_REFERENCE_IMAGES,
  REFERENCE_IMAGE_MAX_BYTES,
  parseReferenceDataUrl,
  validateImagePrompt,
  validateReferenceDimensions
} from '~/lib/media/image-input'
import { createPostMedia } from '~/lib/media/post-media'
import { createPromptMediaForDraft } from '~/lib/media/prompt-media'
import { requireIdentityId } from '@/lib/identity'
import { getSessionUser } from '@/lib/session'
import { isUuid } from '~/lib/ids'
import { z } from 'zod'

/**
 * Image generation for a post draft from the reviewer's own input:
 *
 * - fromPost (prompt optional, as direction): a new image designed from the
 *   post's own text, in the image type the reviewer picked, if any;
 * - a reference image (prompt optional): a new image designed from the post,
 *   built on the reference's structure, in the brand's colours;
 * - referenceMediaId ("Use current image") and a prompt: that image edited;
 * - a prompt alone: an image of exactly that, in the brand's colours.
 *
 * Every one gets the brand logo. A route handler rather than a server action
 * because generation must be stoppable: when the browser aborts its fetch,
 * `request.signal` fires and the provider calls are cancelled before anything
 * is saved. Server actions expose no such signal.
 */

// One base64-encoded reference at the size cap, plus room for the prompt and JSON.
const MAX_BODY_BYTES = Math.ceil((REFERENCE_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024

const bodySchema = z.object(
  {
    prompt: z.string({ error: 'Describe the image you want.' }).default(''),
    referenceImages: z
      .array(z.string({ error: 'Reference images must be image data.' }), {
        error: 'Reference images must be a list.'
      })
      .max(MAX_REFERENCE_IMAGES, `Attach at most ${MAX_REFERENCE_IMAGES} reference image.`)
      .optional(),
    // "Use current image": the server loads it, before its logo went on.
    referenceMediaId: z
      .string()
      .refine(isUuid, 'Invalid image reference.')
      .optional(),
    // "Generate from post text": designed from the post, the prompt as direction.
    fromPost: z.boolean().optional(),
    visualType: z.enum(VISUAL_TYPES, { error: 'Unknown image type.' }).optional()
  },
  { error: 'Request body must be a JSON object.' }
)

function fail(status: number, error: string) {
  return Response.json({ success: false, error }, { status })
}

/**
 * Decodes an uploaded reference image, or says what is wrong with it. Only
 * image data is accepted: this server reads the bytes, and fetching a URL the
 * browser sent would let anyone make it request any address.
 */
function decodeReference(reference: string): { bytes: Buffer } | { error: string } {
  const parsed = parseReferenceDataUrl(reference)
  if (!parsed) return { error: 'Reference image must be a PNG, JPEG or WebP.' }

  const bytes = Buffer.from(parsed.base64, 'base64')
  if (bytes.length === 0) return { error: 'Reference image is empty.' }
  if (bytes.length > REFERENCE_IMAGE_MAX_BYTES) {
    return { error: 'Reference image must be under 3 MB.' }
  }

  // The declared type proves nothing; the bytes must decode as a real image.
  const dimensions = readImageDimensions(bytes)
  if (!dimensions) {
    return { error: 'Reference image could not be read — the file may be corrupt.' }
  }
  const sizeError = validateReferenceDimensions(dimensions.width, dimensions.height)
  return sizeError ? { error: sizeError } : { bytes }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Checked here so a missing session is a 401, not a redirect to sign-in.
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')

  const { id } = await params
  if (!isUuid(id)) {
    return fail(400, 'Invalid post identifier.')
  }

  // The identity the request is made as, like every post action: the
  // signed-in user's identity. createPromptMediaForDraft only finds the
  // draft when it belongs to that identity, so no one can have images
  // generated, and billed, for another user's post.
  let accountId: string
  try {
    accountId = await requireIdentityId()
  } catch {
    return fail(403, 'Set up your identity first.')
  }

  const tooLarge = 'Request is too large. Use a reference image under 3 MB.'
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return fail(413, tooLarge)
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return fail(400, 'Could not read the request.')
  }
  if (raw.length > MAX_BODY_BYTES) return fail(413, tooLarge)

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return fail(400, 'Request body must be valid JSON.')
  }

  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message || 'Invalid request.')
  }

  const prompt = parsed.data.prompt.trim()
  const referenceMediaId = parsed.data.referenceMediaId
  const fromPost = Boolean(parsed.data.fromPost) && !referenceMediaId
  const upload =
    !referenceMediaId && !fromPost ? parsed.data.referenceImages?.[0] : undefined

  // A design from the post, with or without a reference, needs no words; an
  // edit or a plain prompt does.
  if (prompt || (!upload && !fromPost)) {
    const promptError = validateImagePrompt(prompt)
    if (promptError) return fail(400, promptError)
  }

  // A route handler rather than the server action it once was: an action
  // holds up every other action on the page for the minute this takes, and
  // cannot be stopped.
  if (fromPost) {
    try {
      const outcome = await createPostMedia({
        draftId: id,
        accountId,
        mode: 'ai_generated',
        customPrompt: prompt || undefined,
        visualType: parsed.data.visualType,
        abortSignal: request.signal
      })
      if (outcome.status === 'draft_not_found') return fail(404, 'Post draft not found.')
      if (outcome.status === 'aborted') return fail(499, 'Image generation was stopped.')
      if (outcome.status === 'failed') return fail(502, outcome.error)
      return Response.json({ success: true, media: outcome.media })
    } catch (err: any) {
      if (request.signal.aborted) return fail(499, 'Image generation was stopped.')
      console.error('Error generating post media from the post text:', err)
      return fail(502, err?.message || 'Failed to generate image.')
    }
  }

  if (upload) {
    const reference = decodeReference(upload)
    if ('error' in reference) return fail(400, reference.error)
    try {
      const outcome = await createPostMedia({
        draftId: id,
        accountId,
        mode: 'ai_generated',
        customPrompt: prompt || undefined,
        referenceImage: reference.bytes,
        abortSignal: request.signal
      })
      if (outcome.status === 'draft_not_found') return fail(404, 'Post draft not found.')
      if (outcome.status === 'aborted') return fail(499, 'Image generation was stopped.')
      if (outcome.status === 'failed') return fail(502, outcome.error)
      return Response.json({ success: true, media: outcome.media })
    } catch (err: any) {
      if (request.signal.aborted) return fail(499, 'Image generation was stopped.')
      console.error('Error generating post media from a reference image:', err)
      return fail(502, err?.message || 'Failed to generate image.')
    }
  }

  try {
    const outcome = await createPromptMediaForDraft({
      draftId: id,
      accountId,
      prompt,
      referenceMediaId,
      abortSignal: request.signal
    })

    if (outcome.status === 'draft_not_found') return fail(404, 'Post draft not found.')
    if (outcome.status === 'reference_not_found') {
      return fail(404, 'The image to edit is no longer on this post.')
    }
    // 499: client closed the request. Nobody reads this, but nothing was saved.
    if (outcome.status === 'aborted') return fail(499, 'Image generation was stopped.')

    return Response.json({ success: true, media: outcome.media })
  } catch (err: any) {
    if (err instanceof ImageGenerationAbortedError || request.signal.aborted) {
      return fail(499, 'Image generation was stopped.')
    }
    console.error('Error generating post media from prompt:', err)
    return fail(502, err?.message || 'Failed to generate image.')
  }
}
