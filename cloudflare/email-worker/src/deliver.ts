/**
 * How the Email Worker hands an email to the app: reads at most
 * MAX_SOURCE_BYTES of it, signs it and posts it to /api/mail/inbound, retrying
 * our failures. Only standard Web APIs, so the app's tests run it as it is
 * against the app's own verifier (src/lib/mail/webhook-payload.ts holds the
 * same format).
 */

/** As src/lib/mail/settings.ts MAIL_SYNC_SETTINGS.maxSourceBytes; the app refuses more. */
export const MAX_SOURCE_BYTES = 1_500_000

export type DeliveryOutcome = 'stored' | 'duplicate' | 'unrouted'

const OUTCOMES = new Set<string>(['stored', 'duplicate', 'unrouted'])

/** A delivery that did not go through; `status` is the app's answer, if any. */
export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message)
    this.name = 'DeliveryError'
  }
}

export type DeliveryOptions = {
  url: string
  secret: string
  /** Tries in all, for our 5xx, 429 and network failures. */
  attempts?: number
  timeoutMs?: number
  /** Waits before the 2nd, 3rd, … try. */
  backoffMs?: number[]
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

/** The first `limit` bytes of `stream`; the rest is never read. */
export async function readPrefix(
  stream: ReadableStream<Uint8Array>,
  limit: number
): Promise<Uint8Array> {
  const reader = stream.getReader()
  const out = new Uint8Array(limit)
  let length = 0
  while (length < limit) {
    const { done, value } = await reader.read()
    if (done) break
    const take = Math.min(value.byteLength, limit - length)
    out.set(value.subarray(0, take), length)
    length += take
  }
  await reader.cancel().catch(() => {})
  return out.slice(0, length)
}

export function toBase64(bytes: Uint8Array) {
  let binary = ''
  // In slices: String.fromCharCode takes its arguments on the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** `v1=<hex HMAC-SHA256>` of `<timestamp>.<body>`. */
export async function sign(
  secret: string,
  timestamp: string,
  body: Uint8Array
) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const prefix = encoder.encode(`${timestamp}.`)
  const message = new Uint8Array(prefix.length + body.length)
  message.set(prefix)
  message.set(body, prefix.length)
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  return `v1=${Array.from(mac, b => b.toString(16).padStart(2, '0')).join('')}`
}

const retryable = (status: number) => status >= 500 || status === 429

/**
 * Posts one email and returns what the app made of it. Throws DeliveryError
 * when it did not go through: at once for a 4xx (a setup problem retrying
 * cannot fix), after `attempts` tries for the rest.
 */
export async function deliver(
  email: { to: string; from: string; rawSize: number; raw: Uint8Array },
  {
    url,
    secret,
    attempts = 3,
    timeoutMs = 20_000,
    backoffMs = [1_000, 3_000],
    fetch: doFetch = fetch,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = Date.now
  }: DeliveryOptions
): Promise<DeliveryOutcome> {
  const body = new TextEncoder().encode(
    JSON.stringify({
      to: email.to,
      from: email.from,
      rawSize: email.rawSize,
      raw: toBase64(email.raw)
    })
  )
  let lastError = new DeliveryError('not attempted', null)
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1)
      await sleep(backoffMs[attempt - 2] ?? backoffMs.at(-1) ?? 0)
    // Signed per try, so a late retry is not refused as too old.
    const timestamp = String(Math.floor(now() / 1000))
    let res: Response
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mail-timestamp': timestamp,
          'x-mail-signature': await sign(secret, timestamp, body)
        },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (err) {
      lastError = new DeliveryError(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
        null
      )
      continue
    }
    if (res.ok) {
      const answer = (await res.json().catch(() => null)) as {
        status?: unknown
      } | null
      const status = String(answer?.status)
      if (OUTCOMES.has(status)) return status as DeliveryOutcome
      throw new DeliveryError(`unexpected answer: ${status}`, res.status)
    }
    lastError = new DeliveryError(`the app answered ${res.status}`, res.status)
    if (!retryable(res.status)) throw lastError
  }
  throw lastError
}
