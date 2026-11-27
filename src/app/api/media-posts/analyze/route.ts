import { requireIdentityId } from '@/lib/identity'
import { PLATFORM_IDS, type PlatformId } from '@/lib/platforms'
import { publicErrorMessage } from '@/lib/public-error'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { SkillError } from '~/lib/ai/run-skill'
import { UPLOAD_NOTES_MAX_CHARS } from '~/lib/media-upload/rules'
import { analyzeUpload, MediaUploadError } from '~/lib/media-upload/service'

/**
 * Create from media, step two: the AI looks at the uploaded image (or the
 * video's frames) and writes a post for each platform picked, to edit
 * before anything is saved. Nothing is stored here.
 *
 * A route handler so it can be stopped: when the browser aborts, the model
 * call and ffmpeg are cancelled. next.config.ts deploys ffmpeg with it.
 */

export const maxDuration = 300

const bodySchema = z.object({
  uploadId: z.string().max(100),
  platforms: z
    .array(z.enum(PLATFORM_IDS as unknown as [PlatformId, ...PlatformId[]]))
    .min(1, 'Pick at least one platform.')
    .max(PLATFORM_IDS.length),
  notes: z
    .string()
    .max(
      UPLOAD_NOTES_MAX_CHARS,
      `Keep the notes under ${UPLOAD_NOTES_MAX_CHARS} characters.`
    )
    .default('')
})

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
    const result = await analyzeUpload(
      accountId,
      { ...parsed.data, platforms: [...new Set(parsed.data.platforms)] },
      request.signal
    )
    return Response.json({ success: true, result })
  } catch (err) {
    if (request.signal.aborted) return fail(499, 'Stopped.')
    if (err instanceof MediaUploadError) return fail(400, err.message)
    if (err instanceof SkillError) {
      if (err.reason === 'spend_limit') return fail(429, err.message)
      if (err.reason === 'not_configured')
        return fail(503, 'AI is not set up on this server.')
      if (err.reason === 'timeout') {
        return fail(504, 'The AI took too long to answer. Try again.')
      }
    }
    console.error('Could not write posts from uploaded media:', err)
    return fail(
      502,
      publicErrorMessage(err, 'The posts could not be written. Try again.')
    )
  }
}
