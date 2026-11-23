import { db } from '@/db'
import { preferencesTable } from '@/db/schema'
import {
  analyzeIdentitySetup,
  IdentitySetupError
} from '@/lib/ai/pipeline/profile-setup-run'
import { AnalyzeIdentityInputSchema } from '@/lib/ai/skills/profile-setup/schema'
import { withAiSpend } from '@/lib/ai/spend'
import {
  FORMAT_IDS,
  isCreatablePlatform,
  platformsOf,
  type FormatId
} from '@/lib/formats'
import { findOwnedAccount } from '@/lib/ownership'
import { readTextCapped } from '@/lib/safe-url'
import { getSessionUser } from '@/lib/session'
import { eq } from 'drizzle-orm'

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

  // Read no further than the limit: a huge or endless body never fills memory.
  let raw: string
  try {
    const read = await readTextCapped(request, MAX_BODY_BYTES)
    if (read.truncated) return fail(413, 'Request is too large.', false)
    raw = read.text
  } catch {
    return fail(400, 'Could not read the request.', false)
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
  // Re-analyzing an identity: the platforms it posts on, so no suggestion
  // replaces its links with one on a platform it does not use.
  let platforms: ReturnType<typeof platformsOf> | undefined
  if (parsed.data.accountId) {
    // Someone else's identity is a 404, like one that does not exist.
    const account = await findOwnedAccount(db, user.id, parsed.data.accountId)
    if (!account) return fail(404, 'Identity not found', false)
    const [prefs] = await db
      .select({ enabledFormats: preferencesTable.enabledFormats })
      .from(preferencesTable)
      .where(eq(preferencesTable.accountId, account.id))
      .limit(1)
    const enabled = Array.isArray(prefs?.enabledFormats)
      ? (prefs.enabledFormats as unknown[])
      : []
    platforms = platformsOf(
      FORMAT_IDS.filter(f => enabled.includes(f)) as FormatId[]
    )
  }

  // Re-analyzing asks about the platforms the identity posts on, as the
  // create page does: how each should sound, and the identity's account on
  // each. Without them, switching an identity to another company kept the
  // old company's tone notes, and only ever found a LinkedIn link.
  const input =
    platforms?.length && !parsed.data.guidance?.platforms
      ? {
          ...parsed.data,
          guidance: {
            ...parsed.data.guidance,
            platforms: platforms.filter(isCreatablePlatform)
          }
        }
      : parsed.data

  try {
    // Charged to the user: a new identity has no row yet to charge.
    const data = await withAiSpend(
      {
        source: 'identity',
        userId: user.id,
        accountId: parsed.data.accountId ?? null
      },
      () => analyzeIdentitySetup(input, request.signal, { platforms })
    )
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
