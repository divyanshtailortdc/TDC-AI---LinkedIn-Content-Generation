import { getIdentity } from '@/lib/identity'
import { loadOnboardingView } from '@/lib/onboarding/view'
import { getSessionUser } from '@/lib/session'

/**
 * The signed-in user's onboarding progress, for the guide bar and the
 * dashboard checklist (src/components/onboarding) to re-read as the user
 * works through the steps: after each navigation, when the tab is focused,
 * and every few seconds while a run, a draft or a publish is under way.
 * Counts and states only; never a token or a document's text.
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) {
    return Response.json(
      { error: 'Sign in to see your progress.' },
      { status: 401 }
    )
  }
  const view = await loadOnboardingView(user.id, await getIdentity())
  return Response.json(view, { headers: { 'Cache-Control': 'no-store' } })
}
