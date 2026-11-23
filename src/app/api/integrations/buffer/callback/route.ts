import { db } from '@/db'
import { getIdentity } from '@/lib/identity'
import { findOwnedAccount } from '@/lib/ownership'
import {
  connectBuffer,
  fetchBufferAccount
} from '@/lib/publishing/buffer/connection'
import {
  BufferOAuthError,
  callbackErrorResult,
  exchangeCode,
  missingBufferScopes
} from '@/lib/publishing/buffer/oauth'
import { getBufferConnection } from '@/lib/publishing/buffer/token'
import type { CallbackResult } from '@/lib/publishing/callback-results'
import {
  bufferConnectConfig,
  enabledBufferPlatforms
} from '@/lib/publishing/config'
import { pkceVerifier, verifyOAuthState } from '@/lib/publishing/oauth-state'
import {
  connectReturnPath,
  RETURN_COOKIE
} from '@/lib/publishing/return-path'
import {
  BUFFER_FLOW,
  settingsRedirect,
  STATE_COOKIE
} from '@/lib/publishing/routes'
import { loginPathFor } from '@/lib/safe-redirect'
import { getSessionUser } from '@/lib/session'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where Buffer sends the user back after the consent screen. The state must
 * match the signed cookie this browser got from /connect, for this same user
 * and flow, within ten minutes; only then is the code exchanged, on the
 * server, with the PKCE verifier (and the secret, for a confidential client).
 * The account and its channels are then read with the new token and saved
 * with it, for the signed-in user only. Tokens, codes and secrets never reach
 * the browser or the logs; the page is told only the outcome's key.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(loginPathFor(INTEGRATIONS_SETTINGS_PATH), request.url)
    )
  }
  // The page the flow was started from, when /connect was told one.
  const returnTo =
    connectReturnPath(request.cookies.get(RETURN_COOKIE)?.value) ?? undefined
  const config = bufferConnectConfig()
  if (!config) {
    return settingsRedirect('not_configured', BUFFER_FLOW, undefined, returnTo)
  }
  // Back on the callback's own origin, where the session cookie is.
  const back = (result: CallbackResult) =>
    settingsRedirect(result, BUFFER_FLOW, config.oauth.redirectUri, returnTo)

  const params = request.nextUrl.searchParams
  const error = params.get('error')
  // A refusal changes nothing, so it needs no state check to be reported.
  if (error) return back(callbackErrorResult(error))

  const state = params.get('state')
  const check = verifyOAuthState(config.encryptionKey, {
    cookie: request.cookies.get(STATE_COOKIE)?.value,
    state,
    userId: user.id,
    flow: BUFFER_FLOW
  })
  if (!check.ok) {
    console.warn(
      `Buffer connect callback refused for user ${user.id}: state ${check.reason}.`
    )
    return back('state_error')
  }
  const code = params.get('code')
  if (!code) return back('failed')

  // The identity the flow started from, if it is still the user's: its
  // networks get set up with the channels. The connection itself is the user's.
  const identity = check.accountId
    ? await findOwnedAccount(db, user.id, check.accountId)
    : await getIdentity()

  let tokens
  try {
    tokens = await exchangeCode(
      config.oauth,
      code,
      pkceVerifier(config.encryptionKey, state!)
    )
  } catch (err) {
    // The same callback twice (a double load, a back button): the code is
    // single-use, so the second exchange fails though the first connected.
    if (err instanceof BufferOAuthError && err.status === 400) {
      const saved = await getBufferConnection(db, user.id).catch(() => null)
      if (
        saved?.status === 'connected' &&
        saved.connectedAt.getTime() >= check.issuedAt
      ) {
        return back('connected')
      }
    }
    // Buffer's own error text only: never the request, which holds the code.
    console.error(
      `Buffer refused the code exchange for user ${user.id}:`,
      err instanceof Error ? err.message : 'unknown error'
    )
    return back('failed')
  }
  if (missingBufferScopes(tokens.scopes).length > 0) {
    return back('missing_permission')
  }

  try {
    const fetched = await fetchBufferAccount(config, tokens.accessToken)
    await connectBuffer(
      db,
      config,
      { userId: user.id, identityId: identity?.id ?? null },
      tokens,
      fetched,
      { platforms: enabledBufferPlatforms() }
    )
  } catch (err) {
    console.error(
      `Could not connect Buffer for user ${user.id}:`,
      err instanceof Error ? err.message : 'unknown error'
    )
    return back('failed')
  }
  return back('connected')
}
