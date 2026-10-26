import { db } from '@/db'
import { brandThemesTable } from '@/db/schema'
import { requireIdentityId } from '@/lib/identity'
import { getSessionUser } from '@/lib/session'
import { eq } from 'drizzle-orm'
import { decodeImageDataUrl } from '~/lib/media/brand-logo'

/**
 * The identity's saved logo, as an image file. The Brand page links here
 * instead of putting the data URL in its props: inline, the logo (up to
 * 1.8 MB) went out twice per page, once in the HTML and once in the RSC
 * payload, and again after every save. The page adds `?v=<updated at>`, so
 * the browser can keep a copy until the theme changes.
 */

function fail(status: number, error: string) {
  return Response.json({ success: false, error }, { status })
}

export async function GET() {
  // Checked here so a missing session is a 401, not a redirect to sign-in.
  if (!(await getSessionUser())) return fail(401, 'Please sign in again.')

  let accountId: string
  try {
    accountId = await requireIdentityId()
  } catch {
    return fail(403, 'Set up your identity first.')
  }

  const [row] = await db
    .select({ logoImage: brandThemesTable.logoImage })
    .from(brandThemesTable)
    .where(eq(brandThemesTable.accountId, accountId))
    .limit(1)
  const logo = row?.logoImage ? decodeImageDataUrl(row.logoImage) : null
  if (!logo) return fail(404, 'No logo uploaded.')

  return new Response(new Uint8Array(logo.buffer), {
    headers: {
      'Content-Type': logo.mediaType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // Logos saved before uploads were re-encoded may still be SVG; opened
      // directly, a script in one must not run on this origin.
      'Content-Security-Policy': 'sandbox'
    }
  })
}
