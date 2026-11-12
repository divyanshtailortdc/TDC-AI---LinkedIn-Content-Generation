import { db } from '@/db'
import { getIdentity } from '@/lib/identity'
import { findOwnedAccount } from '@/lib/ownership'
import { configFor } from '@/lib/publishing/config'
import { saveConnection } from '@/lib/publishing/connection'
import { pkceVerifier, verifyOAuthState } from '@/lib/publishing/oauth-state'
import { canPublishTo } from '@/lib/publishing/platform'
import { providerFor } from '@/lib/publishing/provider'
import { settingsRedirect, STATE_COOKIE } from '@/lib/publishing/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where the provider (LinkedIn, or Buffer for X, Facebook and Instagram)
 * sends the user back. The
 * state must match the signed cookie this browser got from /connect, for this
 * same user and platform, within ten minutes; only then is the code exchanged
 * (on the server, with the secret and the PKCE verifier) and the connection
 * saved for the signed-in user. Tokens never reach the browser.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const user = await getSessionUser()
  const { platform } = await context.params
  if (!canPublishTo(platform) || !providerFor(platform).oauth) {
    return new NextResponse('Not found', { status: 404 })
  }
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(INTEGRATIONS_SETTINGS_PATH), request.url)
    )
  }

  const provider = providerFor(platform)
  const oauth = provider.oauth!
  const name = provider.platform.name
  const config = configFor(platform)
  if (!config || provider.connectWith(config) !== 'oauth') {
    return settingsRedirect('not_configured', platform)
  }
  const back = (result: Parameters<typeof settingsRedirect>[0]) =>
    settingsRedirect(result, platform, oauth.redirectUri(config))

  const params = request.nextUrl.searchParams
  const error = params.get('error')
  // A refusal changes nothing, so it needs no state check to be reported.
  if (error) return back(oauth.callbackErrorResult(error))

  const state = params.get('state')
  const check = verifyOAuthState(config.encryptionKey, {
    cookie: request.cookies.get(STATE_COOKIE)?.value,
    state,
    userId: user.id,
    flow: platform
  })
  if (!check.ok) {
    console.warn(
      `${name} connect callback refused for user ${user.id}: state ${check.reason}.`
    )
    return back('state_error')
  }

  const code = params.get('code')
  if (!code) return back('failed')

  // The identity the flow was started for, still the user's; a state signed
  // before identities had their own connections falls back to the active one.
  const account = check.accountId
    ? await findOwnedAccount(db, user.id, check.accountId)
    : await getIdentity()
  if (!account) return back('no_identity')

  try {
    const tokens = await oauth.exchangeCode(
      config,
      code,
      pkceVerifier(config.encryptionKey, state!)
    )
    if (provider.publishScope && !tokens.scopes.includes(provider.publishScope))
      return back('missing_permission')
    const member = await oauth.account(config, tokens.accessToken)
    // Buffer: no channel of this platform in the Buffer account to publish to.
    if (!member) return back('no_account')
    await saveConnection(
      db,
      config,
      { userId: user.id, accountId: account.id },
      tokens,
      member,
      { platform }
    )
  } catch (err) {
    console.error(`Could not connect ${name} for user ${user.id}:`, err)
    return back('failed')
  }
  return back('connected')
}
