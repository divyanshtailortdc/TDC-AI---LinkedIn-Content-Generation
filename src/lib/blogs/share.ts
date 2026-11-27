/**
 * A blog's public link: /share/<token>, where anyone with the link reads
 * the blog's saved text without signing in (src/app/share/[token]/route.ts).
 * The token is the only secret: 24 random bytes, base64url, made on the
 * server (src/lib/blogs/store.ts). No server-only imports: the proxy and the
 * editor use the path too.
 */

export const SHARE_PATH = '/share'

/** Whether a value has a share token's shape, checked before any lookup. */
export const isShareToken = (value: string): boolean =>
  /^[A-Za-z0-9_-]{32}$/.test(value)

/** The public link's path for a token. */
export const sharePath = (token: string): string => `${SHARE_PATH}/${token}`
