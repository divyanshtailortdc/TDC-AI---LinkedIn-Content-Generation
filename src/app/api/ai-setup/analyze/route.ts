import { db } from '@/db'
import {
  analyzeIdentitySetup,
  IdentitySetupError
} from '@/lib/ai/pipeline/profile-setup-run'
import { AnalyzeIdentityInputSchema } from '@/lib/ai/skills/profile-setup/schema'
import { findOwnedAccount } from '@/lib/ownership'
import { getSessionUser } from '@/lib/session'

/**
 * Analyze with AI: read-only, nothing is written to the database.
 *
 * A route handler rather than a server action because the analysis takes about
 * a minute and must be stoppable. Server actions run one at a time per browser
 * tab, so a running analysis would hold up Save and every other action, and
 * Cancel could not stop it. Here `request.signal` fires when the browser aborts
 * its fetch, and the model call is cancelled.
 */

const MAX_BODY_BYTES = 256 * 1024

function fail(status: number, error: string, retryable: boolean) {
  return Response.json({ success: false, error, retryable }, { status })
}

export async function POST(request: Request) {
  // Signed-in only: an analysis is a paid model call.
  const user = await getSessionUser()
  if (!user) return fail(401, 'Please sign in again.', false)

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return fail(400, 'Could not read the request.', false)
  }
  if (raw.length > MAX_BODY_BYTES) {
    return fail(413, 'Request is too large.', false)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return fail(400, 'Request body must be valid JSON.', false)
  }

  const parsed = AnalyzeIdentityInputSchema.safeParse(json)
  if (!parsed.success) {
    return fail(400, parsed.error.issues.map(i => i.message).join(' '), false)
  }
  if (parsed.data.accountId) {
    // Someone else's identity is a 404, like one that does not exist.
    const account = await findOwnedAccount(db, user.id, parsed.data.accountId)
    if (!account) return fail(404, 'Identity not found', false)
  }

  try {
    const data = await analyzeIdentitySetup(parsed.data, request.signal)
    return Response.json({ success: true, data })
  } catch (error) {
    // 499: client closed the request. Nobody reads this.
    if (request.signal.aborted)
      return fail(499, 'Analysis was cancelled.', true)
    if (error instanceof IdentitySetupError) {
      return fail(422, error.message, error.retryable)
    }
    console.error('Account Setup analysis failed:', error)
    return fail(
      500,
      'Something went wrong while analyzing. Please try again.',
      true
    )
  }
}
