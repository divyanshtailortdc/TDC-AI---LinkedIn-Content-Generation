import { getIdentity } from '@/lib/identity'
import { buildAuthorizationUrl } from '@/lib/publishing/buffer/oauth'
import { bufferConnectConfig } from '@/lib/publishing/config'
import {
  createOAuthState,
  pkceVerifier,
  STATE_TTL_MS
} from '@/lib/publishing/oauth-state'
import {
  BUFFER_FLOW,
  settingsRedirect,
  STATE_COOKIE,
  STATE_COOKIE_PATH
} from '@/lib/publishing/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'

/**
 * Starts connecting the signed-in user's Buffer account (docs/BUFFER_OAUTH.md):
 * sends them to Buffer's consent screen with a fresh state, kept in a
 * signed, httpOnly cookie for the callback to check, and a PKCE (S256)
 * challenge whose verifier only this server can derive from the state.
 * Separate from sign-in: it never touches the session or Better Auth's
 * accounts.
 */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(INTEGRATIONS_SETTINGS_PATH), request.url)
    )
  }
  const config = bufferConnectConfig()
  if (!config) return settingsRedirect('not_configured', BUFFER_FLOW)

  // The Buffer connection is the user's; the identity active now is the one
  // whose networks are set up with its channels.
  const identity = await getIdentity()
  const { state, cookie } = createOAuthState(
    config.encryptionKey,
    user.id,
    Date.now(),
    BUFFER_FLOW,
    identity?.id
  )
  const response = NextResponse.redirect(
    buildAuthorizationUrl(
      config.oauth,
      state,
      pkceVerifier(config.encryptionKey, state)
    ),
    302
  )
  response.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: config.oauth.redirectUri.startsWith('https://'),
    // Lax: sent on Buffer's top-level redirect back to the callback.
    sameSite: 'lax',
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000
  })
  return response
}
