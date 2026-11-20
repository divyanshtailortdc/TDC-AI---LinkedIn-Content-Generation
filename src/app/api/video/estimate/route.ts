import { getSessionUser } from '@/lib/session'
import { currentVideoEstimate } from '~/lib/video/post-video'

/**
 * What one AI video costs now, for Create posts → Short video, which starts
 * a video for each Reel and Short it drafts. The model is the server's
 * (VIDEO_MODEL), so the browser asks rather than guessing.
 */
export async function GET() {
  // Checked here so a missing session is a 401, not a redirect to sign-in.
  if (!(await getSessionUser())) {
    return Response.json(
      { success: false, error: 'Please sign in again.' },
      { status: 401 }
    )
  }
  return Response.json(
    { success: true, ...currentVideoEstimate() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
