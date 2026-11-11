import type { CallbackResult } from '../callback-results'
import { PlatformOAuthError } from '../errors'
import type { TokenSet } from '../linkedin/oauth'
import { pkceChallenge } from '../oauth-state'

/**
 * Buffer's OAuth for app clients: authorization code with PKCE (required),
 * so each customer authorizes their own Buffer account and the app holds no
 * API key of theirs. A confidential client also sends its secret; a public
 * one (no secret) authenticates with the PKCE verifier alone, and Buffer
 * refuses it if it sends one. Plain functions over a config and a `fetch`,
 * so tests can run them against a stub; config.ts builds the config from the
 * environment.
 *
 * Access tokens last about an hour. With `offline_access` Buffer also gives a
 * refresh token, which is single-use: each refresh returns a new one, and
 * sending an old one again revokes the whole grant. connection.ts therefore
 * refreshes under a row lock, one process at a time.
 *
 * https://developers.buffer.com/guides/authentication.html
 */

const AUTHORIZE_URL = 'https://auth.buffer.com/auth'
const TOKEN_URL = 'https://auth.buffer.com/token'

/** The scope publishing needs; account:read lists the channels. */
export const BUFFER_PUBLISH_SCOPE = 'posts:write'

/** What a Buffer API key can do: everything an app client may ask for. */
export const API_KEY_SCOPES = ['account:read', 'posts:read', BUFFER_PUBLISH_SCOPE]

export type BufferOAuthConfig = {
  clientId: string
  /** Confidential clients only; unset for a public client, which must not send one. */
  clientSecret?: string
  /** Must match a redirect URI registered on the app client, character for character (HTTPS, even on localhost). */
  redirectUri: string
  scopes: string[]
}

type FetchFn = typeof fetch

export function buildAuthorizationUrl(
  oauth: BufferOAuthConfig,
  state: string,
  codeVerifier: string
): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', oauth.clientId)
  url.searchParams.set('redirect_uri', oauth.redirectUri)
  url.searchParams.set('scope', oauth.scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', pkceChallenge(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

/** Buffer refused a token request; `status` is its HTTP status. */
export class BufferOAuthError extends PlatformOAuthError {
  constructor(message: string, status?: number) {
    super(message, status)
    this.name = 'BufferOAuthError'
  }
}

async function tokenRequest(
  oauth: BufferOAuthConfig,
  params: Record<string, string>,
  fetchFn: FetchFn,
  now: number
): Promise<TokenSet> {
  // The secret goes in the POST body, never a URL.
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: oauth.clientId,
      ...(oauth.clientSecret && { client_secret: oauth.clientSecret })
    }),
    signal: AbortSignal.timeout(20_000)
  })
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok || typeof body?.access_token !== 'string') {
    // Buffer's error_description; never the request, which holds the secret.
    const detail =
      typeof body?.error_description === 'string'
        ? `: ${body.error_description.slice(0, 200)}`
        : typeof body?.error === 'string'
          ? `: ${body.error}`
          : ''
    throw new BufferOAuthError(
      `Buffer refused the token request${detail}`,
      res.status
    )
  }
  const expiresIn =
    typeof body.expires_in === 'number' ? body.expires_in : 60 * 60
  return {
    accessToken: body.access_token,
    accessTokenExpiresAt: new Date(now + expiresIn * 1000),
    refreshToken:
      typeof body.refresh_token === 'string' ? body.refresh_token : null,
    refreshTokenExpiresAt: null,
    scopes:
      typeof body.scope === 'string'
        ? [...new Set(body.scope.split(/[\s,]+/).filter(Boolean))]
        : oauth.scopes
  }
}

/** Exchanges the callback's code, with the PKCE verifier, on the server only. */
export function exchangeCode(
  oauth: BufferOAuthConfig,
  code: string,
  codeVerifier: string,
  fetchFn: FetchFn = fetch,
  now = Date.now()
) {
  return tokenRequest(
    oauth,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauth.redirectUri,
      code_verifier: codeVerifier
    },
    fetchFn,
    now
  )
}

/**
 * A new access token, and a new refresh token in place of `refreshToken`
 * (which Buffer invalidates). Never call it twice with the same one.
 */
export function refreshAccessToken(
  oauth: BufferOAuthConfig,
  refreshToken: string,
  fetchFn: FetchFn = fetch,
  now = Date.now()
) {
  return tokenRequest(
    oauth,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchFn,
    now
  )
}

/** Buffer's `error` on the callback: a user who said no, or anything else. */
export function callbackErrorResult(error: string): CallbackResult {
  return error === 'access_denied' ? 'cancelled' : 'failed'
}
