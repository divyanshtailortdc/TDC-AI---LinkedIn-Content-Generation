import { db } from '@/db'
import { publishingConfig } from '@/lib/publishing/config'
import { saveConnection } from '@/lib/publishing/connection'
import { canPublishTo, PUBLISHING_PLATFORM } from '@/lib/publishing/platform'
import {
  callbackErrorResult,
  exchangeCode,
  fetchAccountInfo,
  PUBLISH_SCOPE,
  verifyOAuthState
} from '@/lib/publishing/provider'
import { settingsRedirect, STATE_COOKIE } from '@/lib/publishing/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where the platform sends the user back. The state must match the signed cookie
 * this browser got from /connect, for this same user, within ten minutes;
 * only then is the code exchanged (on the server, with the secret) and the
 * connection saved for the signed-in user. Tokens never reach the browser.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  if (!canPublishTo((await context.params).platform)) {
    return new NextResponse('Not found', { status: 404 })
  }
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(INTEGRATIONS_SETTINGS_PATH), request.url)
    )
  }

  const config = publishingConfig()
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
      `${PUBLISHING_PLATFORM.name} connect callback refused for user ${user.id}: state ${check.reason}.`
    )
    return back('state_error')
  }

  const code = params.get('code')
  if (!code) return back('failed')

  try {
    const tokens = await exchangeCode(config, code)
    if (!tokens.scopes.includes(PUBLISH_SCOPE))
      return back('missing_permission')
    const member = await fetchAccountInfo(tokens.accessToken)
    await saveConnection(db, config, user.id, tokens, member)
  } catch (err) {
    console.error(
      `Could not connect ${PUBLISHING_PLATFORM.name} for user ${user.id}:`,
      err
    )
    return back('failed')
  }
  return back('connected')
}
