import { requireIdentityId } from '@/lib/identity'
import { getSessionUser } from '@/lib/session'
import { isUuid } from '~/lib/ids'
import { loadUploadedVideo } from '~/lib/media-upload/uploaded-video'

/**
 * The video the user uploaded for a post (Create from media), with signed
 * links to play and download it: the post page loads it only when shown.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const fail = (status: number, error: string) =>
    Response.json({ success: false, error }, { status })
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')
  const { id } = await params
  if (!isUuid(id)) return fail(400, 'Invalid post identifier.')
  let accountId: string
  try {
    accountId = await requireIdentityId()
  } catch {
    return fail(403, 'Set up your identity first.')
  }
  try {
    const video = await loadUploadedVideo(accountId, id)
    if (!video) return fail(404, 'This post has no uploaded video.')
    return Response.json(
      { success: true, video },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (err) {
    console.error('Could not load an uploaded video:', err)
    return fail(500, 'The video could not be loaded.')
  }
}
