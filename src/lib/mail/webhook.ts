import 'server-only'

import { db } from '@/db'
import { mailMessagesTable, mailSyncStateTable } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { simpleParser } from 'mailparser'
import { identitiesByLocalPart } from './addresses'
import {
  PARSER_OPTIONS,
  toMessageRow,
  type ReceivedMessage
} from './parse-message'
import { MAIL_WEBHOOK_SETTINGS } from './settings'
import {
  deliveryUid,
  localPartOf,
  type InboundPayload
} from './webhook-payload'

/**
 * Stores one email Cloudflare Email Routing delivered
 * (cloudflare/email-worker/README.md): the other way in besides IMAP sync
 * (sync.ts), into the same mail_messages rows, parsed the same way.
 *
 * Webhook mail is filed under its own mail_sync_state row
 * (MAIL_WEBHOOK_SETTINGS.mailbox), with a digest of the delivery as its UID
 * (deliveryUid), so the same unique indexes refuse duplicates: a repeated
 * post by UID, a resent email by Message-ID or, without one, by its content
 * (contentHashOf), also across the two ways in while both are on.
 */

export type InboundResult =
  /** Stored for the identity it was sent to. */
  | { status: 'stored'; messageId: string }
  /** Already stored: a retry, or the same email received before. */
  | { status: 'duplicate' }
  /** No identity has this address; the worker refuses it. */
  | { status: 'unrouted' }

/** A request that is signed but cannot be right; retrying it will not help. */
export class InboundPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InboundPayloadError'
  }
}

const state = mailSyncStateTable

/**
 * The webhook's mail_sync_state row id, created on first use. Asked for each
 * email rather than kept, so a recreated row (a reset database) is never
 * stale; one small query per email.
 */
async function webhookMailboxId() {
  const [row] = await db
    .insert(state)
    .values({ mailbox: MAIL_WEBHOOK_SETTINGS.mailbox })
    .onConflictDoUpdate({
      target: state.mailbox,
      set: { mailbox: sql`excluded.mailbox` }
    })
    .returning({ id: state.id })
  if (!row) throw new Error('Could not create the webhook mailbox row.')
  return row.id
}

async function parseRaw(raw: Buffer) {
  try {
    return await simpleParser(raw, PARSER_OPTIONS)
  } catch (err) {
    console.warn(
      'Could not parse a webhook email:',
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/**
 * Stores `payload` for the identity at `domain` it was sent to. Throws
 * InboundPayloadError for a payload that contradicts itself, and database
 * errors as they are (the worker retries those).
 */
export async function receiveInboundEmail(
  payload: InboundPayload,
  domain: string
): Promise<InboundResult> {
  const sent = Buffer.from(payload.raw, 'base64')
  if (sent.length === 0) throw new InboundPayloadError('empty email')
  if (payload.rawSize < sent.length) {
    throw new InboundPayloadError('rawSize is smaller than the email sent')
  }
  // Cut to our own cap, as IMAP sync does, whatever the worker's is: an email
  // is stored truncated rather than refused (and retried by its sender for days).
  const raw = sent.subarray(0, MAIL_WEBHOOK_SETTINGS.maxSourceBytes)

  const localPart = localPartOf(payload.to, domain)
  const accountId = localPart
    ? (await identitiesByLocalPart([localPart])).get(localPart)
    : undefined
  if (!localPart || !accountId) return { status: 'unrouted' }

  const now = new Date()
  // What an IMAP fetch gives; the envelope only stands in when the source
  // cannot be parsed, so the email is still listed with its sender.
  const message: ReceivedMessage = {
    uid: deliveryUid(localPart, raw),
    size: payload.rawSize,
    internalDate: now,
    envelope: {
      from: payload.from ? [{ address: payload.from }] : [],
      to: [{ address: payload.to }]
    }
  }
  const row = toMessageRow(
    {
      accountId,
      mailboxId: await webhookMailboxId(),
      uidValidity: MAIL_WEBHOOK_SETTINGS.uidValidity
    },
    message,
    await parseRaw(raw)
  )
  // The worker says how much it cut, whatever its own cap is.
  row.truncated = payload.rawSize > raw.length

  const [stored] = await db
    .insert(mailMessagesTable)
    .values(row)
    // No target: skips a row that clashes with any of its unique indexes.
    .onConflictDoNothing()
    .returning({ id: mailMessagesTable.id })
  if (!stored) return { status: 'duplicate' }

  // The inbox polls this when it shows the webhook's row, and refreshes.
  await db
    .update(state)
    .set({ lastSyncedAt: now, updatedAt: now })
    .where(eq(state.mailbox, MAIL_WEBHOOK_SETTINGS.mailbox))
  return { status: 'stored', messageId: stored.id }
}
