import 'server-only'

import { requireIdentityId } from '@/lib/identity'
import { getSessionUser } from '@/lib/session'
import { isUuid } from '~/lib/ids'
import { CarouselError, type CarouselErrorCode } from './service'

/**
 * What the carousel routes (src/app/api/posts/[id]/slides) share: the
 * signed-in identity, the ids from the path, and errors as JSON. Route
 * handlers rather than server actions, like the image route: making slides
 * takes a while and must be stoppable, which only a request's signal allows.
 */

export function fail(status: number, error: string) {
  return Response.json({ success: false, error }, { status })
}

const STATUS: Record<CarouselErrorCode, number> = {
  not_found: 404,
  not_editable: 409,
  invalid: 400,
  // The client closed the request; nothing was saved.
  aborted: 499,
  failed: 502
}

/** A missing session, as a 401 rather than a redirect to sign-in. */
export const signedOut = () => fail(401, 'Please sign in again.')

export { getSessionUser }

/**
 * The identity the request is made as, or the response refusing it. Each
 * handler checks the session itself first (tests/auth-guards.test.ts).
 */
export async function identityFor(
  ids: Array<string | undefined>
): Promise<{ accountId: string } | { response: Response }> {
  if (ids.some(id => !isUuid(id)))
    return { response: fail(400, 'Invalid identifier.') }
  try {
    return { accountId: await requireIdentityId() }
  } catch {
    return { response: fail(403, 'Set up your identity first.') }
  }
}

/** A request body as JSON, or null when it is not JSON. */
export async function jsonBody(
  request: Request,
  maxBytes = 16 * 1024
): Promise<unknown> {
  const raw = await request.text().catch(() => '')
  if (raw.length > maxBytes) return null
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return null
  }
}

/** A failure as the response it deserves; anything unexpected is logged. */
export function errorResponse(
  err: unknown,
  request: Request,
  what: string
): Response {
  if (err instanceof CarouselError) return fail(STATUS[err.code], err.message)
  if (request.signal.aborted) return fail(499, 'Stopped.')
  console.error(`${what}:`, err)
  return fail(
    500,
    err instanceof Error && err.message ? err.message : `${what}.`
  )
}
