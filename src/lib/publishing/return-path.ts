import { LOGIN_PATH, safeRedirectPath } from '@/lib/safe-redirect'

/**
 * Where connecting Buffer sends the user back to: the page they started from
 * (the onboarding checklist on the dashboard, say), instead of always
 * Settings → Integrations. /connect keeps it in a short-lived httpOnly cookie
 * beside the OAuth state, and the callback reads it back. No `server-only`,
 * so tests can use it.
 */

/** Holds the return path between /connect and /callback only. */
export const RETURN_COOKIE = 'tdc_publish_return'

/** The query parameters a page reads the connect outcome from. */
export const RESULT_PARAM = 'connection'
export const PLATFORM_PARAM = 'platform'

/**
 * `value` when it is a page of this app to return to, else null. Never
 * another site (safeRedirectPath), an API route (the connect route itself
 * would loop) or the sign-in page. An outcome left in it by an earlier
 * attempt is dropped, so a new one is not mixed up with it.
 */
export function connectReturnPath(value: unknown): string | null {
  const path = safeRedirectPath(value, '')
  if (!path) return null
  const url = new URL(path, 'http://app.invalid')
  if (
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === LOGIN_PATH
  ) {
    return null
  }
  url.searchParams.delete(RESULT_PARAM)
  url.searchParams.delete(PLATFORM_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

/** `path` with the outcome of connecting `platform` in its query. */
export function withConnectResult(
  path: string,
  result: string,
  platform: string
): string {
  const url = new URL(path, 'http://app.invalid')
  url.searchParams.set(RESULT_PARAM, result)
  url.searchParams.set(PLATFORM_PARAM, platform)
  return `${url.pathname}${url.search}${url.hash}`
}
