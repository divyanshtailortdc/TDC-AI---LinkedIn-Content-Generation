import { env } from '~/env'

/** The only folder synced. Opened read-only, so syncing changes nothing on the server. */
export const SYNCED_FOLDER = 'INBOX'

/** Caps and windows of inbox sync (src/lib/mail/sync.ts). */
export const MAIL_SYNC_SETTINGS = {
  /** How often the mailbox is checked for new mail. */
  intervalMs: 60_000,
  /** Messages one pass stores; the rest wait for the next pass, queued at once. */
  maxMessagesPerPass: 300,
  /** Messages downloaded per FETCH; each batch is stored with the cursor in one transaction. */
  fetchBatchSize: 20,
  /** Bytes of each message downloaded. Text comes first, so only late attachments are lost. */
  maxSourceBytes: 1_500_000,
  /** Longer HTML is dropped and the text shown instead. */
  maxHtmlChars: 500_000,
  maxTextChars: 100_000,
  snippetChars: 200,
  maxAttachments: 50,
  /**
   * A pass stops starting batches after this, so it ends well inside its lease
   * and inside a serverless function's time limit (Vercel). The rest of the
   * mail is due again at once.
   */
  passDeadlineMs: 4 * 60_000,
  /** How long a claimed pass holds the mailbox; renewed with every batch. */
  leaseMs: 10 * 60_000,
  /** Back-off after failed passes: 1 min, doubling, at most 1 hour. */
  backoffBaseMs: 60_000,
  backoffMaxMs: 60 * 60_000
} as const

/**
 * Our mail server's mailbox that every identity address delivers into
 * (mailserver/README.md), or null when the inbox is not set up here.
 */
export function inboundMailConfig() {
  const domain = env.INBOUND_EMAIL_DOMAIN
  const host = env.MAIL_IMAP_HOST
  const user = env.MAIL_IMAP_USER
  const password = env.MAIL_IMAP_PASSWORD
  if (!domain || !host || !user || !password) return null
  return {
    domain: domain.toLowerCase(),
    host,
    port: env.MAIL_IMAP_PORT,
    user: user.toLowerCase(),
    password,
    tlsCaFile: env.MAIL_IMAP_TLS_CA_FILE ?? null
  }
}

export type InboundMailConfig = NonNullable<
  ReturnType<typeof inboundMailConfig>
>

/** Caps of the inbound webhook Cloudflare Email Routing calls (src/lib/mail/webhook.ts). */
export const MAIL_WEBHOOK_SETTINGS = {
  /**
   * The mail_sync_state row webhook mail is filed under. Not an email
   * address, so it can never be an IMAP mailbox's row; no sync pass claims it.
   */
  mailbox: 'cloudflare-email-routing',
  /** Every webhook email has this UIDVALIDITY; its UID is a digest (webhook.ts). */
  uidValidity: 0,
  /**
   * The worker sends at most this much of each email, as IMAP sync downloads
   * (cloudflare/email-worker keeps the same number): text comes first.
   */
  maxSourceBytes: MAIL_SYNC_SETTINGS.maxSourceBytes,
  /** The request body: the source in base64 (4/3) plus the JSON around it. */
  maxBodyBytes: Math.ceil(MAIL_SYNC_SETTINGS.maxSourceBytes / 3) * 4 + 16_384,
  /** A signed request older or newer than this is refused (replays, clock skew). */
  signatureToleranceMs: 5 * 60_000
} as const

/**
 * The webhook Cloudflare Email Routing delivers to
 * (cloudflare/email-worker/README.md), or null when it is off here.
 */
export function inboundWebhookConfig() {
  const domain = env.INBOUND_EMAIL_DOMAIN
  const secret = env.MAIL_WEBHOOK_SECRET
  if (!domain || !secret) return null
  return { domain: domain.toLowerCase(), secret }
}

/**
 * The inbox, received through either or both ways: the IMAP mailbox and the
 * Cloudflare webhook. `statusMailbox` is the mail_sync_state row the inbox
 * shows: the IMAP one when IMAP is set up, which is the one that syncs.
 * Null when neither is set up here.
 */
export function inboxConfig() {
  const imap = inboundMailConfig()
  const webhook = inboundWebhookConfig()
  const domain = imap?.domain ?? webhook?.domain
  if (!domain) return null
  return {
    domain,
    imap,
    statusMailbox: imap?.user ?? MAIL_WEBHOOK_SETTINGS.mailbox
  }
}
