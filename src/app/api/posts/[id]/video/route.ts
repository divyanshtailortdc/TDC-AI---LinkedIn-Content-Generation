import { requireIdentityId } from '@/lib/identity'
import { PostLockedError } from '@/lib/publishing/post-lock'
import { getSessionUser } from '@/lib/session'
import { isUuid } from '~/lib/ids'
import { getPostVideoState, startPostVideo } from '~/lib/video/post-video'
import { VIDEO_GENERATION_ENABLED } from '~/lib/video/formats'
import { publicErrorMessage } from '@/lib/public-error'

/**
 * A Reel's or Short's video (src/lib/video/post-video.ts).
 *
 * GET: where it stands: the post page polls it every few seconds while a
 * video is being made. A video not yet under way is recorded after the
 * answer.
 *
 * POST: starts a video (Record video). Returns at once; it is recorded
 * after the response, in about a minute, and picked up by GET.
 *
 * Route handlers rather than server actions: the browser runs actions one at
 * a time, so a poll would wait behind every edit on the page.
 */

/**
 * A recording runs after the response, in this function: give it Vercel's
 * most (src/lib/function-limit.ts). next.config.ts deploys the browser and
 * ffmpeg with this route.
 */
export const maxDuration = 300

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
    const state = await getPostVideoState(auth.accountId, auth.id)
    if (!state) return fail(404, 'Video post not found.')
    return Response.json({ success: true, state }, { headers: noStore })
  } catch (err: any) {
    console.error('Error loading a post video:', err)
    return fail(500, publicErrorMessage(err, 'Failed to load the video.'))
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Checked here so a missing session is a 401, not a redirect to sign-in.
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')
  if (!VIDEO_GENERATION_ENABLED) return fail(404, 'Video generation is switched off.')
  const auth = await authorize(params)
  if (auth instanceof Response) return auth

  try {
    const outcome = await startPostVideo({
      accountId: auth.accountId,
      draftId: auth.id,
      trigger: 'reviewer'
    })
    switch (outcome.status) {
      case 'started':
        return Response.json({ success: true })
      case 'not_found':
        return fail(404, 'Video post not found.')
      case 'already_running':
        return fail(409, 'A video is already being made for this post.', {
          alreadyRunning: true
        })
      case 'unavailable':
        return fail(503, outcome.error)
      case 'failed':
        return fail(502, outcome.error)
    }
  } catch (err: any) {
    if (err instanceof PostLockedError) return fail(409, err.message)
    console.error('Error starting a post video:', err)
    return fail(502, publicErrorMessage(err, 'Failed to start the video.'))
  }
}
