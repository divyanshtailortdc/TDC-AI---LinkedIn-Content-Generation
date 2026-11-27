/** Where people land after signing in when no safe `?next=` was given. */
export const DEFAULT_SIGNED_IN_PATH = '/'

/** The sign-in page, which sends people back to `next` afterwards. */
export const LOGIN_PATH = '/login'

/** The email and password sign-up page; also takes `?next=`. */
export const SIGNUP_PATH = '/signup'

/**
 * `value` when it is a path inside this app, otherwise `fallback`. Used for
 * `?next=`, which anyone can put in a link, so an open redirect here would
 * send someone from our sign-in page to a look-alike site.
 *
 * Rejected: absolute URLs (`https://evil.com`), protocol-relative URLs
 * (`//evil.com`), and backslash forms (`/\evil.com`), which browsers treat as
 * `//evil.com`. Control characters are rejected too, since browsers strip tabs
 * and newlines from URLs (`/\t/evil.com` becomes `//evil.com`).
 *
 * The path returned is the normalised one, so it is checked again after
 * normalising: dot segments can leave a `//` that was not there before
 * (`/.//evil.com`, `/x/..//evil.com`, `/%2e//evil.com` all become `//evil.com`).
 */
export function safeRedirectPath(
  value: unknown,
  fallback: string = DEFAULT_SIGNED_IN_PATH
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return fallback
  }
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//') || value.includes('\\')) return fallback
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback

  // Last check: resolving it against a placeholder origin must stay on that origin.
  try {
    const base = 'http://app.invalid'
    const resolved = new URL(value, base)
    if (resolved.origin !== base) return fallback
    const path = `${resolved.pathname}${resolved.search}${resolved.hash}`
    // A browser would read a leading `//` (or `/\`) as another site.
    if (path.startsWith('//') || path.startsWith('/\\')) return fallback
    return path
  } catch {
    return fallback
  }
}

/** The login URL that returns to `path` after signing in. */
export function loginPathFor(path: string): string {
  return withNext(LOGIN_PATH, path)
}

/** The sign-up URL that goes on to `path` after signing up. */
export function signupPathFor(path: string): string {
  return withNext(SIGNUP_PATH, path)
}

function withNext(page: string, path: string): string {
  const next = safeRedirectPath(path, '')
  return next && next !== DEFAULT_SIGNED_IN_PATH
    ? `${page}?next=${encodeURIComponent(next)}`
    : page
}
