import { requireIdentityId } from '@/lib/identity'
import { PostLockedError } from '@/lib/publishing/post-lock'
import { getSessionUser } from '@/lib/session'
import { z } from 'zod'
import { AiSpendLimitError, withAiSpend } from '~/lib/ai/spend'
import { isUuid } from '~/lib/ids'
import { getPostVideoState, startPostVideo } from '~/lib/video/post-video'
import { VIDEO_GENERATION_ENABLED } from '~/lib/video/formats'
import { MAX_VIDEO_DIRECTION_CHARS } from '~/lib/video/prompt'

/**
 * A Reel's or Short's AI video (src/lib/video/post-video.ts).
 *
 * GET: where it stands, with a running generation moved on first: the post
 * page polls it every few seconds while a video is being made, and the poll
 * that finds the clip done stores it.
 *
 * POST: starts a video, with the cost the page showed. Returns at once; the
 * clip is made over the next minutes and picked up by GET.
 *
 * Route handlers rather than server actions: the browser runs actions one at
 * a time, so a poll would wait behind every edit on the page.
 */

const bodySchema = z.object(
  {
    // The estimate the reviewer confirmed, in US dollars.
    confirmedEstimateUsd: z
      .number({ error: 'Confirm the estimated cost first.' })
      .nonnegative(),
    direction: z
      .string()
      .max(
        MAX_VIDEO_DIRECTION_CHARS,
        `Keep the direction under ${MAX_VIDEO_DIRECTION_CHARS} characters.`
      )
      .optional()
  },
  { error: 'Request body must be a JSON object.' }
)

function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ success: false, error, ...extra }, { status })
}

const noStore = { 'Cache-Control': 'private, no-store' }

/** The post's id and the identity, or the response refusing the request. */
async function authorize(
  params: Promise<{ id: string }>
): Promise<{ id: string; accountId: string } | Response> {
  const { id } = await params
  if (!isUuid(id)) return fail(400, 'Invalid post identifier.')
  try {
    return { id, accountId: await requireIdentityId() }
  } catch {
    return fail(403, 'Set up your identity first.')
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Checked here so a missing session is a 401, not a redirect to sign-in.
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')
  const auth = await authorize(params)
  if (auth instanceof Response) return auth
  try {
    const state = await withAiSpend(
      { source: 'posts', accountId: auth.accountId, draftId: auth.id },
      () => getPostVideoState(auth.accountId, auth.id)
    )
    if (!state) return fail(404, 'Video post not found.')
    return Response.json({ success: true, state }, { headers: noStore })
  } catch (err: any) {
    console.error('Error loading a post video:', err)
    return fail(500, err?.message || 'Failed to load the video.')
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Checked here so a missing session is a 401, not a redirect to sign-in.
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')
  if (!VIDEO_GENERATION_ENABLED) return fail(404, 'Video generation is switched off.')
  const auth = await authorize(params)
  if (auth instanceof Response) return auth

  let json: unknown
  try {
    json = await request.json()
  } catch {
    return fail(400, 'Request body must be valid JSON.')
  }
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return fail(400, parsed.error.issues[0]?.message || 'Invalid request.')
  }

  try {
    const outcome = await withAiSpend(
      { source: 'posts', accountId: auth.accountId, draftId: auth.id },
      () =>
        startPostVideo({
          accountId: auth.accountId,
          draftId: auth.id,
          confirmedEstimateUsd: parsed.data.confirmedEstimateUsd,
          direction: parsed.data.direction
        })
    )
    switch (outcome.status) {
      case 'started':
        return Response.json({ success: true })
      case 'not_found':
        return fail(404, 'Video post not found.')
      case 'already_running':
        return fail(409, 'A video is already being made for this post.', {
          alreadyRunning: true
        })
      case 'estimate_changed':
        return fail(
          409,
          `The estimated cost changed to $${outcome.estimateUsd.toFixed(2)}. Check it and confirm again.`,
          { estimateUsd: outcome.estimateUsd }
        )
      case 'unavailable':
        return fail(503, outcome.error)
      case 'failed':
        return fail(502, outcome.error)
    }
  } catch (err: any) {
    if (err instanceof PostLockedError) return fail(409, err.message)
    if (err instanceof AiSpendLimitError) return fail(429, err.message)
    console.error('Error starting a post video:', err)
    return fail(502, err?.message || 'Failed to start the video.')
  }
}
