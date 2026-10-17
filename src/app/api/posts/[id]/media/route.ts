import { ImageGenerationAbortedError, readImageDimensions } from '~/lib/media'
import {
  MAX_REFERENCE_IMAGES,
  REFERENCE_IMAGE_MAX_BYTES,
  IMAGE_URL_MAX_LENGTH,
  parseReferenceDataUrl,
  validateImagePrompt,
  validateReferenceDimensions
} from '~/lib/media/image-input'
import { createPromptMediaForDraft } from '~/lib/media/prompt-media'
import { requireActiveAccountId } from '@/lib/active-account'
import { isUuid } from '~/lib/ids'
import { z } from 'zod'

/**
 * Prompt-driven image generation for a post draft.
 *
 * A route handler rather than a server action because generation must be
 * stoppable: when the browser aborts its fetch, `request.signal` fires and the
 * provider call is cancelled before anything is saved. Server actions expose no
 * such signal.
 */

// One base64-encoded reference at the size cap, plus room for the prompt and JSON.
const MAX_BODY_BYTES = Math.ceil((REFERENCE_IMAGE_MAX_BYTES * 4) / 3) + 64 * 1024

const bodySchema = z.object(
  {
    prompt: z.string({ error: 'Describe the image you want.' }),
    referenceImages: z
      .array(z.string({ error: 'Reference images must be image data or a URL.' }), {
        error: 'Reference images must be a list.'
      })
      .max(MAX_REFERENCE_IMAGES, `Attach at most ${MAX_REFERENCE_IMAGES} reference image.`)
      .optional()
  },
  { error: 'Request body must be a JSON object.' }
)

function fail(status: number, error: string) {
  return Response.json({ success: false, error }, { status })
}

/** Returns a problem with one reference image, or null when it is usable. */
function validateReference(reference: string): string | null {
  // "Use current image" can send a stock photo's URL. The provider fetches it,
  // not this server, so there is nothing to decode here.
  if (/^https?:\/\//i.test(reference)) {
    return reference.length > IMAGE_URL_MAX_LENGTH ? 'Reference image URL is too long.' : null
  }

  const parsed = parseReferenceDataUrl(reference)
  if (!parsed) return 'Reference image must be a PNG, JPEG or WebP.'

  const bytes = Buffer.from(parsed.base64, 'base64')
  if (bytes.length === 0) return 'Reference image is empty.'
  if (bytes.length > REFERENCE_IMAGE_MAX_BYTES) return 'Reference image must be under 3 MB.'

  // The declared type proves nothing; the bytes must decode as a real image.
  const dimensions = readImageDimensions(bytes)
  if (!dimensions) return 'Reference image could not be read — the file may be corrupt.'
  return validateReferenceDimensions(dimensions.width, dimensions.height)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isUuid(id)) {
    return fail(400, 'Invalid post identifier.')
  }

  // The identity the request is made as, like every post action. Without it any
  // caller who knew a post id could have images generated, and billed, for it.
  let accountId: string
  try {
    accountId = await requireActiveAccountId()
  } catch {
    return fail(401, 'No active identity selected.')
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

  const promptError = validateImagePrompt(parsed.data.prompt)
  if (promptError) return fail(400, promptError)

  const referenceImages = parsed.data.referenceImages?.length
    ? parsed.data.referenceImages
    : undefined
  for (const reference of referenceImages || []) {
    const referenceError = validateReference(reference)
    if (referenceError) return fail(400, referenceError)
  }

  try {
    const outcome = await createPromptMediaForDraft({
      draftId: id,
      accountId,
      prompt: parsed.data.prompt.trim(),
      referenceImages,
      abortSignal: request.signal
    })

    if (outcome.status === 'draft_not_found') return fail(404, 'Post draft not found.')
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
