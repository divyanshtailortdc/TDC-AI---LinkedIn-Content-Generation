import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

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

/** LinkedIn's authorization code lives 30 minutes; the state lives 10. */
export const STATE_TTL_MS = 10 * 60 * 1000

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
// State (CSRF). The random state goes to LinkedIn; the cookie holds it with
// the user who started the flow and an expiry, signed, so the callback can
// check all three and nothing in the cookie can be forged or swapped.
// ---------------------------------------------------------------------------

const stateMac = (key: Buffer, payload: string) =>
  createHmac('sha256', key)
    .update(`linkedin-publish-state:${payload}`)
    .digest('base64url')

export function createOAuthState(
  key: Buffer,
  userId: string,
  now = Date.now()
): { state: string; cookie: string } {
  const state = randomBytes(32).toString('base64url')
  const payload = `${userId}.${state}.${now + STATE_TTL_MS}`
  return { state, cookie: `${payload}.${stateMac(key, payload)}` }
}

type StateCheck =
  | { ok: true }
  | {
      ok: false
      reason: 'missing' | 'invalid' | 'expired' | 'mismatch' | 'wrong_user'
    }

const sameString = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Whether the callback's `state` is the one this browser was sent off with,
 * by this user, less than STATE_TTL_MS ago.
 */
export function verifyOAuthState(
  key: Buffer,
  input: {
    cookie: string | null | undefined
    state: string | null | undefined
    userId: string
    now?: number
  }
): StateCheck {
  if (!input.cookie || !input.state) return { ok: false, reason: 'missing' }
  const parts = input.cookie.split('.')
  if (parts.length !== 4) return { ok: false, reason: 'invalid' }
  const [userId, state, expires, mac] = parts as [
    string,
    string,
    string,
    string
  ]
  if (!sameString(mac, stateMac(key, `${userId}.${state}.${expires}`))) {
    return { ok: false, reason: 'invalid' }
  }
  if (!sameString(state, input.state)) return { ok: false, reason: 'mismatch' }
  if (userId !== input.userId) return { ok: false, reason: 'wrong_user' }
  if (!(Number(expires) > (input.now ?? Date.now()))) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Tokens and the member
// ---------------------------------------------------------------------------

/** LinkedIn refused a token or profile request; `status` is its HTTP status. */
export class LinkedInOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
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

/**
 * What the settings page says after the callback, keyed by the `linkedin`
 * query parameter it redirects with. Nothing from LinkedIn is echoed back.
 */
export const CALLBACK_RESULTS = {
  connected:
    'LinkedIn is connected. You can publish approved posts from Posts.',
  cancelled: 'LinkedIn was not connected: authorization was cancelled.',
  state_error:
    'LinkedIn was not connected: the request could not be verified. Please try again.',
  missing_permission:
    'LinkedIn did not grant permission to publish posts. Connect again and allow it.',
  failed: 'LinkedIn could not be connected. Please try again.',
  not_configured: 'Publishing to LinkedIn is not set up on this server.'
} as const
export type CallbackResult = keyof typeof CALLBACK_RESULTS

/** LinkedIn's `error` on the callback: a member who said no, or anything else. */
export function callbackErrorResult(error: string): CallbackResult {
  return error === 'user_cancelled_authorize' ||
    error === 'user_cancelled_login'
    ? 'cancelled'
    : 'failed'
}
