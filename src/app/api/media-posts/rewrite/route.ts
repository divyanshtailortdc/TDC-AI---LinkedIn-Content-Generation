import { requireIdentityId } from '@/lib/identity'
import { PLATFORM_IDS, type PlatformId } from '@/lib/platforms'
import { publicErrorMessage } from '@/lib/public-error'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { SkillError } from '~/lib/ai/run-skill'
import { REWRITE_INSTRUCTION_MAX } from '~/lib/ai/skills/media-post/rewrite'
import { MEDIA_POST_PARTS } from '~/lib/media-upload/drafts'
import {
  RegenerateMediaError,
  rewriteUnsavedMediaPost
} from '~/lib/media-upload/regenerate'
import { UPLOAD_NOTES_MAX_CHARS } from '~/lib/media-upload/rules'
import { parseMediaAnalysis } from '~/lib/media-upload/stored-analysis'

/**
 * Create from media, before anything is saved: writes one post's hook, body
 * or whole text again from what the AI saw in the media (the analysis the
 * page got with its posts), and returns the post with only that part new.
 * Nothing is stored, and the media is not read again.
 *
 * A route handler so it can be stopped, as the posts' first writing is.
 */

export const maxDuration = 300

const text = (max: number) => z.string().max(max).default('')

const bodySchema = z.object({
  kind: z.enum(['image', 'video']),
  part: z.enum(MEDIA_POST_PARTS),
  analysis: z.unknown(),
  notes: z
    .string()
    .max(
      UPLOAD_NOTES_MAX_CHARS,
      `Keep the notes under ${UPLOAD_NOTES_MAX_CHARS} characters.`
    )
    .default(''),
  instruction: z
    .string()
    .max(
      REWRITE_INSTRUCTION_MAX,
      `Keep the instruction under ${REWRITE_INSTRUCTION_MAX} characters.`
    )
    .optional(),
  // The post as it stands on the page, the same limits as saving it.
  draft: z.object({
    platform: z.enum(PLATFORM_IDS as unknown as [PlatformId, ...PlatformId[]]),
    hook: text(5000),
    body: text(20_000),
    cta: text(2000),
    hashtags: z.array(z.string().max(100)).max(30).default([]),
    firstComment: text(5000),
    title: text(200),
    altText: text(1000)
  })
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
  const analysis = parseMediaAnalysis(parsed.data.analysis)
  if (!analysis) {
    return fail(
      400,
      'What the AI saw in your media is missing. Choose Write again first.'
    )
  }

  try {
    const draft = await rewriteUnsavedMediaPost(
      accountId,
      {
        kind: parsed.data.kind,
        analysis,
        notes: parsed.data.notes,
        draft: parsed.data.draft,
        part: parsed.data.part,
        instruction: parsed.data.instruction ?? null
      },
      request.signal
    )
    return Response.json({ success: true, draft })
  } catch (err) {
    if (request.signal.aborted) return fail(499, 'Stopped.')
    if (err instanceof RegenerateMediaError) return fail(400, err.message)
    if (err instanceof SkillError) {
      if (err.reason === 'spend_limit') return fail(429, err.message)
      if (err.reason === 'not_configured')
        return fail(503, 'AI is not set up on this server.')
      if (err.reason === 'timeout') {
        return fail(504, 'The AI took too long to answer. Try again.')
      }
    }
    console.error('Could not rewrite a post from uploaded media:', err)
    return fail(
      502,
      publicErrorMessage(err, 'The new text could not be written. Try again.')
    )
  }
}
