import { linkedInPublishConfig } from '@/lib/linkedin/config'
import {
  buildAuthorizationUrl,
  createOAuthState,
  STATE_TTL_MS
} from '@/lib/linkedin/oauth'
import {
  settingsRedirect,
  STATE_COOKIE,
  STATE_COOKIE_PATH
} from '@/lib/linkedin/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { LINKEDIN_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'

/**
 * Starts connecting LinkedIn for publishing: sends the signed-in user to
 * LinkedIn's consent screen with a fresh state, kept in a signed, httpOnly
 * cookie for the callback to check. Separate from sign-in: it never touches
 * the session or Better Auth's accounts.
 */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(LINKEDIN_SETTINGS_PATH), request.url)
    )
  }

  const config = linkedInPublishConfig()
  if (!config) return settingsRedirect('not_configured')

  const { state, cookie } = createOAuthState(config.encryptionKey, user.id)
  const response = NextResponse.redirect(
    buildAuthorizationUrl(config, state),
    302
  )
  response.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: config.redirectUri.startsWith('https://'),
    // Lax: sent on LinkedIn's top-level redirect back to the callback.
    sameSite: 'lax',
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000
  })
  return response
}
