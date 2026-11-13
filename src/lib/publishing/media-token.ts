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

/**
 * What a token opens: a post's image, or one slide of its carousel
 * (createMediaToken with slideSubject). The subject never holds a ".".
 */
export const slideSubject = (draftId: string, slideId: string) => `${draftId}~${slideId}`

/** The post and, for a carousel slide, the slide a token's subject names. */
export function parseMediaSubject(subject: string): { draftId: string; slideId: string | null } {
  const [draftId = '', slideId] = subject.split('~')
  return { draftId, slideId: slideId || null }
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

/**
 * How the image is served for a network that takes only some images
 * (./buffer/image-variant.ts): `instagram` as a JPEG within Instagram's
 * aspect ratios, `facebook` with WebP as JPEG. Not signed: it only changes
 * how the one image the token opens is encoded.
 */
export const MEDIA_VARIANTS = ['facebook', 'instagram'] as const
export type MediaVariant = (typeof MEDIA_VARIANTS)[number]
export const MEDIA_VARIANT_PARAM = 'for'

export const isMediaVariant = (value: unknown): value is MediaVariant =>
  (MEDIA_VARIANTS as readonly unknown[]).includes(value)

/**
 * Whether only this computer or its network can open `origin` (localhost, a
 * private or link-local address): Buffer's servers cannot fetch images there.
 */
export function isPrivateOrigin(origin: string): boolean {
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return true
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe80:/.test(host)
  )
}

/** The image's public link on `appUrl`, as `variant` when given. */
export function mediaUrl(
  appUrl: string,
  token: string,
  variant?: MediaVariant
): string {
  const url = new URL(`${MEDIA_PATH}/${encodeURIComponent(token)}`, appUrl)
  if (variant) url.searchParams.set(MEDIA_VARIANT_PARAM, variant)
  return url.toString()
}
