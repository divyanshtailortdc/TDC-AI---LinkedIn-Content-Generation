import { getIdentity } from '@/lib/identity'
import { configFor } from '@/lib/publishing/config'
import { pkceVerifier, createOAuthState, STATE_TTL_MS } from '@/lib/publishing/oauth-state'
import { canPublishTo } from '@/lib/publishing/platform'
import { providerFor } from '@/lib/publishing/provider'
import {
  settingsRedirect,
  STATE_COOKIE,
  STATE_COOKIE_PATH
} from '@/lib/publishing/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse } from 'next/server'

/**
 * Starts connecting a platform for publishing: sends the signed-in user to
 * the consent screen (LinkedIn's, or Buffer's for X, Facebook and Instagram)
 * with a fresh state, kept
 * in a signed, httpOnly cookie for the callback to check, and a PKCE
 * challenge whose verifier only this server can derive from the state.
 * Separate from sign-in: it never touches the session or Better Auth's
 * accounts. Only a platform whose provider connects through OAuth here has
 * one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string }> }
) {
  const user = await getSessionUser()
  const { platform } = await params
  if (!canPublishTo(platform) || !providerFor(platform).oauth) {
    return new NextResponse('Not found', { status: 404 })
  }
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(INTEGRATIONS_SETTINGS_PATH), request.url)
    )
  }

  const provider = providerFor(platform)
  const config = configFor(platform)
  if (!config || provider.connectWith(config) !== 'oauth') {
    return settingsRedirect('not_configured', platform)
  }

  // Connections are per identity: this one is for the identity active now,
  // whatever is active when the provider sends the user back.
  const identity = await getIdentity()
  if (!identity) return settingsRedirect('no_identity', platform)
  const { state, cookie } = createOAuthState(
    config.encryptionKey,
    user.id,
    Date.now(),
    platform,
    identity.id
  )
  const response = NextResponse.redirect(
    provider.oauth!.authorizationUrl(
      config,
      state,
      pkceVerifier(config.encryptionKey, state)
    ),
    302
  )
  response.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: provider.oauth!.redirectUri(config).startsWith('https://'),
    // Lax: sent on the provider's top-level redirect back to the callback.
    sameSite: 'lax',
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000
  })
  return response
}
