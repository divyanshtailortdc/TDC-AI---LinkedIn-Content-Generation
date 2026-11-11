import { PlatformOAuthError } from '../errors'
import type { CallbackResult } from '../callback-results'

export {
  createOAuthState,
  STATE_TTL_MS,
  verifyOAuthState
} from '../oauth-state'

/**
 * LinkedIn's 3-legged OAuth (authorization code) for publishing, apart from
 * Better Auth's sign-in. Everything here is plain functions over a config and
 * a `fetch`, so tests can run it against a stub; config.ts builds the config
 * from the environment.
 *
 * https://learn.microsoft.com/linkedin/shared/authentication/authorization-code-flow
 */

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization'
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken'
const USERINFO_URL = 'https://api.linkedin.com/v2/userinfo'

/** The scope publishing needs. */
export const PUBLISH_SCOPE = 'w_member_social'

export type LinkedInAppConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  apiVersion: string
  encryptionKey: Buffer
}

export type FetchFn = typeof fetch

/** "openid profile w_member_social" or "openid,profile,…", as LinkedIn returns either. */
export function parseScopes(value: string | null | undefined): string[] {
  return [...new Set((value ?? '').split(/[\s,]+/).filter(Boolean))]
}

export function buildAuthorizationUrl(
  config: Pick<LinkedInAppConfig, 'clientId' | 'redirectUri' | 'scopes'>,
  state: string
): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('scope', config.scopes.join(' '))
  return url.toString()
}

// ---------------------------------------------------------------------------
// Tokens and the member
// ---------------------------------------------------------------------------

/** LinkedIn refused a token or profile request; `status` is its HTTP status. */
export class LinkedInOAuthError extends PlatformOAuthError {
  constructor(message: string, status?: number) {
    super(message, status)
    this.name = 'LinkedInOAuthError'
  }
}

export type TokenSet = {
  accessToken: string
  accessTokenExpiresAt: Date
  refreshToken: string | null
  refreshTokenExpiresAt: Date | null
  scopes: string[]
}

async function tokenRequest(
  config: LinkedInAppConfig,
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
      client_id: config.clientId,
      client_secret: config.clientSecret
    }),
    signal: AbortSignal.timeout(20_000)
  })
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok || typeof body?.access_token !== 'string') {
    // LinkedIn's error_description; never the request, which holds the secret.
    const detail =
      typeof body?.error_description === 'string'
        ? `: ${body.error_description}`
        : ''
    throw new LinkedInOAuthError(
      `LinkedIn refused the token request${detail}`,
      res.status
    )
  }
  const seconds = (key: string) =>
    typeof body[key] === 'number' ? (body[key] as number) : null
  const expiresIn = seconds('expires_in') ?? 60 * 24 * 60 * 60
  const refreshIn = seconds('refresh_token_expires_in')
  return {
    accessToken: body.access_token,
    accessTokenExpiresAt: new Date(now + expiresIn * 1000),
    refreshToken:
      typeof body.refresh_token === 'string' ? body.refresh_token : null,
    refreshTokenExpiresAt:
      refreshIn === null ? null : new Date(now + refreshIn * 1000),
    // LinkedIn may leave scope out; then it granted what was asked for.
    scopes:
      typeof body.scope === 'string' ? parseScopes(body.scope) : config.scopes
  }
}

/** Exchanges the callback's code, on the server only (it needs the secret). */
export function exchangeCode(
  config: LinkedInAppConfig,
  code: string,
  fetchFn: FetchFn = fetch,
  now = Date.now()
) {
  return tokenRequest(
    config,
    {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri
    },
    fetchFn,
    now
  )
}

/** Only for apps LinkedIn has granted programmatic refresh tokens. */
export function refreshAccessToken(
  config: LinkedInAppConfig,
  refreshToken: string,
  fetchFn: FetchFn = fetch,
  now = Date.now()
) {
  return tokenRequest(
    config,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchFn,
    now
  )
}

export type MemberInfo = {
  memberId: string
  name: string | null
  pictureUrl: string | null
}

/** The member the token belongs to, from the OpenID userinfo endpoint (openid + profile). */
export async function fetchMemberInfo(
  accessToken: string,
  fetchFn: FetchFn = fetch
): Promise<MemberInfo> {
  const res = await fetchFn(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000)
  })
  const body = (await res.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!res.ok || typeof body?.sub !== 'string' || !body.sub) {
    throw new LinkedInOAuthError(
      'LinkedIn did not return your profile.',
      res.status
    )
  }
  const name =
    typeof body.name === 'string'
      ? body.name
      : [body.given_name, body.family_name]
          .filter(v => typeof v === 'string')
          .join(' ') || null
  return {
    memberId: body.sub,
    name,
    pictureUrl:
      typeof body.picture === 'string' && body.picture.startsWith('https://')
        ? body.picture
        : null
  }
}

export const personUrn = (memberId: string) => `urn:li:person:${memberId}`

/** LinkedIn's `error` on the callback: a member who said no, or anything else. */
export function callbackErrorResult(error: string): CallbackResult {
  return error === 'user_cancelled_authorize' ||
    error === 'user_cancelled_login'
    ? 'cancelled'
    : 'failed'
}
