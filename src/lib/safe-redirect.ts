/** Where people land after signing in when no safe `?next=` was given. */
export const DEFAULT_SIGNED_IN_PATH = '/'

/** The sign-in page, which sends people back to `next` afterwards. */
export const LOGIN_PATH = '/login'

/**
 * `value` when it is a path inside this app, otherwise `fallback`. Used for
 * `?next=`, which anyone can put in a link, so an open redirect here would
 * send someone from our sign-in page to a look-alike site.
 *
 * Rejected: absolute URLs (`https://evil.com`), protocol-relative URLs
 * (`//evil.com`), and backslash forms (`/\evil.com`), which browsers treat as
 * `//evil.com`. Control characters are rejected too, since browsers strip tabs
 * and newlines from URLs (`/\t/evil.com` becomes `//evil.com`).
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
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return fallback
  }
}

/** The login URL that returns to `path` after signing in. */
export function loginPathFor(path: string): string {
  const next = safeRedirectPath(path, '')
  return next && next !== DEFAULT_SIGNED_IN_PATH
    ? `${LOGIN_PATH}?next=${encodeURIComponent(next)}`
    : LOGIN_PATH
}
