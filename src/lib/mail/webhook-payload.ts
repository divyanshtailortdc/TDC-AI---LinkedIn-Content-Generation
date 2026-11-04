import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/**
 * The inbound webhook's wire format, shared with the Email Worker
 * (cloudflare/email-worker/src/deliver.ts): what a request carries, how it is
 * signed, and how an email is routed and recognised again. Pure, so it is
 * tested on its own; webhook.ts stores what it lets through.
 *
 * Signature: `X-Mail-Signature: v1=<hex HMAC-SHA256>` of `<timestamp>.<body>`
 * with MAIL_WEBHOOK_SECRET, where `X-Mail-Timestamp` is in Unix seconds. The
 * timestamp is signed too, so an old request cannot be replayed with a new one.
 */

export const SIGNATURE_HEADER = 'x-mail-signature'
export const TIMESTAMP_HEADER = 'x-mail-timestamp'
const SIGNATURE_VERSION = 'v1'

export function signatureFor(
  secret: string,
  timestamp: string,
  body: Uint8Array
) {
  const hmac = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex')
  return `${SIGNATURE_VERSION}=${hmac}`
}

type SignatureHeaders = {
  timestamp: string | null
  signature: string | null
  now: number
  toleranceMs: number
}

/**
 * Why a request is refused from its headers alone, or null: checked before
 * the body is read, so unsigned or stale requests cost nothing.
 */
export function signatureHeadersError({
  timestamp,
  signature,
  now,
  toleranceMs
}: SignatureHeaders): string | null {
  if (!timestamp || !signature) return 'missing signature'
  if (!/^\d{1,12}$/.test(timestamp)) return 'malformed timestamp'
  if (!/^v1=[0-9a-f]{64}$/.test(signature)) return 'bad signature'
  if (Math.abs(now - Number(timestamp) * 1000) > toleranceMs) {
    return 'timestamp outside the allowed window'
  }
  return null
}

/** Why a request's signature is refused, or null when it is good. */
export function signatureError({
  secret,
  body,
  ...headers
}: SignatureHeaders & { secret: string; body: Uint8Array }): string | null {
  const refused = signatureHeadersError(headers)
  if (refused) return refused
  const { timestamp, signature } = headers as {
    timestamp: string
    signature: string
  }
  const expected = Buffer.from(signatureFor(secret, timestamp, body))
  const given = Buffer.from(signature)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'bad signature'
  }
  return null
}

/** One email, as the worker posts it. Envelope addresses, not header ones. */
export const inboundPayloadSchema = z.object({
  /** RCPT TO: the identity address it was sent to. */
  to: z.string().min(3).max(320),
  /** MAIL FROM; empty for bounces (`<>`). */
  from: z.string().max(320),
  /** The email's full size; `raw` is cut at maxSourceBytes when larger. */
  rawSize: z.number().int().nonnegative(),
  /** The MIME source (or its first maxSourceBytes), base64. */
  raw: z.base64()
})

export type InboundPayload = z.infer<typeof inboundPayloadSchema>

/**
 * The local part of `recipient` (`test` for test@<domain>), lower-case, or
 * null when it is not an address at the domain. The same name the IMAP flow
 * reads from Delivered-To (parse-message.ts recipientOf).
 */
export function localPartOf(recipient: string, domain: string) {
  const address = recipient.trim().toLowerCase()
  const suffix = `@${domain.toLowerCase()}`
  if (!address.endsWith(suffix)) return null
  const localPart = address.slice(0, -suffix.length)
  return localPart && !localPart.includes('@') ? localPart : null
}

/**
 * The UID a webhook email is stored under: 53 bits (a safe JS integer) of
 * the SHA-256 of its recipient and source. The worker posting the same
 * delivery again (a retry after a lost response) gives the same UID, which
 * UNIQUE (mailbox, UIDVALIDITY, UID) refuses. A sender sending it again gets
 * new Received headers and a new UID; (identity, Message-ID) catches that.
 */
export function deliveryUid(localPart: string, raw: Uint8Array) {
  const digest = createHash('sha256')
    .update(localPart)
    .update('\n')
    .update(raw)
    .digest()
  // 21 + 32 bits; never 0, which no IMAP UID is either.
  return (
    (digest.readUInt32BE(0) & 0x1f_ffff) * 2 ** 32 + digest.readUInt32BE(4) || 1
  )
}
