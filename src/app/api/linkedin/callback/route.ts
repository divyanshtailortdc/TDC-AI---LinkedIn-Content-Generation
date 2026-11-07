import { db } from '@/db'
import { linkedInPublishConfig } from '@/lib/linkedin/config'
import { saveConnection } from '@/lib/linkedin/connection'
import {
  callbackErrorResult,
  exchangeCode,
  fetchMemberInfo,
  PUBLISH_SCOPE,
  verifyOAuthState
} from '@/lib/linkedin/oauth'
import { settingsRedirect, STATE_COOKIE } from '@/lib/linkedin/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { LINKEDIN_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where LinkedIn sends the user back. The state must match the signed cookie
 * this browser got from /connect, for this same user, within ten minutes;
 * only then is the code exchanged (on the server, with the secret) and the
 * connection saved for the signed-in user. Tokens never reach the browser.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(LINKEDIN_SETTINGS_PATH), request.url)
    )
  }

  const config = linkedInPublishConfig()
  if (!config) return settingsRedirect('not_configured')
  const back = (result: Parameters<typeof settingsRedirect>[0]) =>
    settingsRedirect(result, config.redirectUri)

  const params = request.nextUrl.searchParams
  const error = params.get('error')
  // A refusal changes nothing, so it needs no state check to be reported.
  if (error) return back(callbackErrorResult(error))

  const check = verifyOAuthState(config.encryptionKey, {
    cookie: request.cookies.get(STATE_COOKIE)?.value,
    state: params.get('state'),
    userId: user.id
  })
  if (!check.ok) {
    console.warn(
      `LinkedIn connect callback refused for user ${user.id}: state ${check.reason}.`
    )
    return back('state_error')
  }

  const code = params.get('code')
  if (!code) return back('failed')

  try {
    const tokens = await exchangeCode(config, code)
    if (!tokens.scopes.includes(PUBLISH_SCOPE))
      return back('missing_permission')
    const member = await fetchMemberInfo(tokens.accessToken)
    await saveConnection(db, config, user.id, tokens, member)
  } catch (err) {
    console.error(`Could not connect LinkedIn for user ${user.id}:`, err)
    return back('failed')
  }
  return back('connected')
}
