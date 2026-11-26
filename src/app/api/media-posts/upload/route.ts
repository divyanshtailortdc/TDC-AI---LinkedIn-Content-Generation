import { requireIdentityId } from '@/lib/identity'
import { publicErrorMessage } from '@/lib/public-error'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import {
  MediaUploadError,
  startUpload,
  uploadFromLink
} from '~/lib/media-upload/service'

/**
 * Create from media, step one: where the file goes.
 *
 * - { mediaType, size, fileName }: a signed link the browser PUTs the file
 *   to, straight into the bucket (a video is far over Vercel's 4.5 MB
 *   request limit), and the upload's id;
 * - { link }: media someone shared as a link, fetched and kept by the server.
 *
 * A route handler: fetching a shared video can take a while, and an action
 * would hold up every other action on the page meanwhile.
 */

export const maxDuration = 120

const bodySchema = z.union([
  z.object({
    mediaType: z.string().max(100),
    size: z.number().int().nonnegative(),
    fileName: z.string().max(500).nullish()
  }),
  z.object({ link: z.string().trim().min(1, 'Paste a link.').max(2048) })
])

const fail = (status: number, error: string) =>
  Response.json({ success: false, error }, { status })

export async function POST(request: Request) {
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')
  let accountId: string
  try {
    accountId = await requireIdentityId()
  } catch {
    return fail(403, 'Set up your identity first.')
  }

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return fail(400, 'Request body must be valid JSON.')
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success)
    return fail(400, parsed.error.issues[0]?.message || 'Invalid request.')

  try {
    const upload =
      'link' in parsed.data
        ? await uploadFromLink(accountId, parsed.data.link)
        : await startUpload(accountId, parsed.data)
    return Response.json({ success: true, upload })
  } catch (err) {
    if (err instanceof MediaUploadError) return fail(400, err.message)
    console.error('Could not start a media upload:', err)
    return fail(
      502,
      publicErrorMessage(err, 'The upload could not be started.')
    )
  }
}
