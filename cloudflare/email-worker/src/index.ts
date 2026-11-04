import { deliver, DeliveryError, MAX_SOURCE_BYTES, readPrefix } from './deliver'

/**
 * Cloudflare Email Routing's catch-all for the inbound domain runs this for
 * every email, once per recipient: it posts the email to the app
 * (README.md).
 *
 * - Stored, or already stored: accepted.
 * - No identity has the address: refused with a permanent error (setReject),
 *   so the sender gets a bounce at once instead of the email vanishing.
 * - The app could not take it: the handler throws, which Cloudflare answers
 *   with a temporary error, so the sender keeps the email and retries for
 *   days. Never setReject for these: that bounces it for good.
 *
 * Awaited in the handler, not ctx.waitUntil: Cloudflare answers the sender
 * only after the handler returns, so the outcome reaches the sender.
 */

interface Env {
  /** https://<app>/api/mail/inbound */
  WEBHOOK_URL: string
  /** The app's MAIL_WEBHOOK_SECRET (wrangler secret put WEBHOOK_SECRET). */
  WEBHOOK_SECRET: string
}

export default {
  async email(message, env) {
    if (!env.WEBHOOK_URL || !env.WEBHOOK_SECRET) {
      console.error('WEBHOOK_URL or WEBHOOK_SECRET is not set.')
      throw new Error('The email worker is not configured.')
    }
    const raw = await readPrefix(message.raw, MAX_SOURCE_BYTES)
    const startedAt = Date.now()
    try {
      const outcome = await deliver(
        { to: message.to, from: message.from, rawSize: message.rawSize, raw },
        { url: env.WEBHOOK_URL, secret: env.WEBHOOK_SECRET }
      )
      // Sizes and outcomes only: addresses and content stay out of the logs.
      console.log(
        JSON.stringify({
          event: 'delivered',
          outcome,
          rawSize: message.rawSize,
          sent: raw.length,
          ms: Date.now() - startedAt
        })
      )
      if (outcome === 'unrouted') message.setReject('Unknown recipient')
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'failed',
          error: err instanceof Error ? err.message : String(err),
          status: err instanceof DeliveryError ? err.status : null,
          rawSize: message.rawSize,
          ms: Date.now() - startedAt
        })
      )
      throw err
    }
  }
} satisfies ExportedHandler<Env>
