import { after } from 'next/server'
import { runMailExtraction } from '~/jobs/mail-extraction'
import { runsJobsHere } from '~/jobs/role'
import {
  inboundWebhookConfig,
  MAIL_WEBHOOK_SETTINGS
} from '~/lib/mail/settings'
import { InboundPayloadError, receiveInboundEmail } from '~/lib/mail/webhook'
import {
  inboundPayloadSchema,
  SIGNATURE_HEADER,
  signatureError,
  signatureHeadersError,
  TIMESTAMP_HEADER
} from '~/lib/mail/webhook-payload'

/**
 * Where the Cloudflare Email Worker posts each email sent to an identity
 * address (cloudflare/email-worker/README.md). Signed with
 * MAIL_WEBHOOK_SECRET; no session.
 *
 * The status tells the worker what to do:
 * - 200 `stored` / `duplicate`: accepted (a retry of a stored email is too).
 * - 200 `unrouted`: no identity has the address; the worker refuses the email.
 * - 4xx: the request is wrong (not set up, bad signature, too large, malformed).
 *   Retrying will not help; the worker fails temporarily so the sender
 *   retries for days while it is fixed.
 * - 5xx: our failure (the database); the worker retries, then fails temporarily.
 */

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status })

/** The body, or null once it passes `limit` bytes; never reads more than that. */
async function readBody(request: Request, limit: number) {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export async function POST(request: Request) {
  const config = inboundWebhookConfig()
  if (!config) return json(404, { error: 'Not found' })

  const headers = {
    timestamp: request.headers.get(TIMESTAMP_HEADER),
    signature: request.headers.get(SIGNATURE_HEADER),
    now: Date.now(),
    toleranceMs: MAIL_WEBHOOK_SETTINGS.signatureToleranceMs
  }
  // Unsigned or stale requests are refused before their body is read.
  const unsigned = signatureHeadersError(headers)
  if (unsigned) {
    console.warn(`Inbound mail webhook refused: ${unsigned}.`)
    return json(401, { error: 'Unauthorized' })
  }
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAIL_WEBHOOK_SETTINGS.maxBodyBytes) {
    return json(413, { error: 'Too large' })
  }
  const body = await readBody(request, MAIL_WEBHOOK_SETTINGS.maxBodyBytes)
  if (!body) return json(413, { error: 'Too large' })

  const refused = signatureError({ ...headers, secret: config.secret, body })
  if (refused) {
    console.warn(`Inbound mail webhook refused: ${refused}.`)
    return json(401, { error: 'Unauthorized' })
  }

  let payload
  try {
    payload = inboundPayloadSchema.parse(
      JSON.parse(Buffer.from(body).toString('utf8'))
    )
  } catch {
    console.warn('Inbound mail webhook: malformed payload.')
    return json(400, { error: 'Malformed payload' })
  }

  const startedAt = Date.now()
  try {
    const result = await receiveInboundEmail(payload, config.domain)
    // Never the content or the sender: who received what is in the database.
    console.info(
      `Inbound mail: ${result.status}, ${payload.rawSize} bytes, ${Date.now() - startedAt} ms.`
    )
    // Its stories and links are extracted after the response, as after a sync.
    if (result.status === 'stored' && runsJobsHere()) after(runMailExtraction)
    return json(200, { status: result.status })
  } catch (err) {
    if (err instanceof InboundPayloadError) {
      console.warn(`Inbound mail webhook: ${err.message}.`)
      return json(400, { error: 'Malformed payload' })
    }
    console.error('Inbound mail webhook failed:', err)
    return json(500, { error: 'Could not store the email' })
  }
}
