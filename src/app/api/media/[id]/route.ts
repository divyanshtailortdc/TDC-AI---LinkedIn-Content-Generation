import { requireIdentityId } from '@/lib/identity'
import { getSessionUser } from '@/lib/session'
import { isUuid } from '~/lib/ids'
import { loadMediaImageUrl } from '~/lib/media/media-image'

/**
 * A post image's link, for the review queue's open post. A GET rather than a
 * Server Action: the browser runs actions one at a time, so an image load
 * used to wait behind an approve or an edit; requests here run alongside.
 */

function fail(status: number, error: string) {
  return Response.json({ success: false, error }, { status })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Checked here so a missing session is a 401, not a redirect to sign-in.
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')

  const { id } = await params
  if (!isUuid(id)) return fail(400, 'Invalid image identifier.')

  let accountId: string
  try {
    accountId = await requireIdentityId()
  } catch {
    return fail(403, 'Set up your identity first.')
  }

  try {
    const imageUrl = await loadMediaImageUrl(accountId, id)
    if (!imageUrl) return fail(404, 'Image not found')
    // A signed link expires, and the page keeps the one it got; nothing to
    // cache here.
    return Response.json(
      { success: true, imageUrl },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (err: any) {
    console.error('Error loading post media image:', err)
    return fail(500, err?.message || 'Failed to load image')
  }
}
