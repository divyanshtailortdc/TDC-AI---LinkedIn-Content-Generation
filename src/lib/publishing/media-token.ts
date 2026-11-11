import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed links to a post's image, for a provider that fetches the image
 * itself (Buffer takes an image URL, not bytes). The token names the post and
 * an expiry and is signed with the server's key, so the link opens that one
 * image for a day and cannot be forged or turned into another post's. No
 * `server-only` import, so tests can use it.
 */

/** Long enough for Buffer to fetch it, even after a retry. */
export const MEDIA_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** The path the image is served at; the token follows it. */
export const MEDIA_PATH = '/api/publishing-media'

const mac = (key: Buffer, payload: string) =>
  createHmac('sha256', key)
    .update(`publish-media:${payload}`)
    .digest('base64url')

export function createMediaToken(
  key: Buffer,
  draftId: string,
  now = Date.now()
): string {
  const payload = `${draftId}.${now + MEDIA_TOKEN_TTL_MS}`
  return `${payload}.${mac(key, payload)}`
}

/** The post id the token opens, or null when it is forged, malformed or expired. */
export function verifyMediaToken(
  key: Buffer,
  token: string | null | undefined,
  now = Date.now()
): string | null {
  const parts = (token ?? '').split('.')
  if (parts.length !== 3) return null
  const [draftId, expires, signature] = parts as [string, string, string]
  const expected = Buffer.from(mac(key, `${draftId}.${expires}`))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null
  }
  return Number(expires) > now ? draftId : null
}

/** The image's public link on `appUrl`. */
export const mediaUrl = (appUrl: string, token: string) =>
  new URL(`${MEDIA_PATH}/${encodeURIComponent(token)}`, appUrl).toString()
