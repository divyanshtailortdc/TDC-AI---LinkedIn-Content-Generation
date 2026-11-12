import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The OAuth state (CSRF) and PKCE verifier every publishing OAuth flow uses
 * (LinkedIn, Buffer). The random state goes to the provider; the cookie
 * holds it with the user who started the flow (and the identity it connects
 * for) and an expiry, signed, so the callback can check them all and nothing
 * in the cookie can be forged or swapped. The flow's name is signed in too, so a state made for one
 * platform's flow is refused by another's callback. No `server-only` import,
 * so tests can use it.
 */

/** The provider's authorization code lives longer; the state lives 10 minutes. */
export const STATE_TTL_MS = 10 * 60 * 1000

const stateMac = (key: Buffer, flow: string, payload: string) =>
  createHmac('sha256', key)
    .update(`${flow}-publish-state:${payload}`)
    .digest('base64url')

/** Joins the user and the identity in the cookie's first part; neither id has one. */
const SUBJECT_SEPARATOR = '~'

export function createOAuthState(
  key: Buffer,
  userId: string,
  now = Date.now(),
  flow = 'linkedin',
  /** The identity the connection is for: the one active when it started. */
  accountId?: string
): { state: string; cookie: string } {
  const state = randomBytes(32).toString('base64url')
  const subject = accountId ? `${userId}${SUBJECT_SEPARATOR}${accountId}` : userId
  const payload = `${subject}.${state}.${now + STATE_TTL_MS}`
  return { state, cookie: `${payload}.${stateMac(key, flow, payload)}` }
}

type StateCheck =
  | {
      ok: true
      /** The identity it was started for; null for a state made without one. */
      accountId: string | null
    }
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
 * by this user, for this flow, less than STATE_TTL_MS ago.
 */
export function verifyOAuthState(
  key: Buffer,
  input: {
    cookie: string | null | undefined
    state: string | null | undefined
    userId: string
    now?: number
    flow?: string
  }
): StateCheck {
  if (!input.cookie || !input.state) return { ok: false, reason: 'missing' }
  const parts = input.cookie.split('.')
  if (parts.length !== 4) return { ok: false, reason: 'invalid' }
  const [subject, state, expires, mac] = parts as [
    string,
    string,
    string,
    string
  ]
  const flow = input.flow ?? 'linkedin'
  if (!sameString(mac, stateMac(key, flow, `${subject}.${state}.${expires}`))) {
    return { ok: false, reason: 'invalid' }
  }
  const [userId, accountId = null] = subject.split(SUBJECT_SEPARATOR)
  if (!sameString(state, input.state)) return { ok: false, reason: 'mismatch' }
  if (userId !== input.userId) return { ok: false, reason: 'wrong_user' }
  if (!(Number(expires) > (input.now ?? Date.now()))) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true, accountId }
}

/**
 * The PKCE code verifier for a state, derived from it with the server's key:
 * nothing more to keep between /connect and /callback, and only this server
 * can work it out from the state (which the provider and the browser see).
 * 43 base64url characters, as RFC 7636 asks.
 */
export const pkceVerifier = (key: Buffer, state: string) =>
  createHmac('sha256', key).update(`pkce:${state}`).digest('base64url')

/** The S256 challenge sent with the authorization request. */
export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url')
