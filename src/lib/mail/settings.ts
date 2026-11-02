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
