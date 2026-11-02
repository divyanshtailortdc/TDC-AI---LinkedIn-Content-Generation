import 'server-only'

import { db } from '@/db'
import {
  mailMessagesTable,
  mailSyncStateTable,
  type MailSyncState,
  type NewMailMessage
} from '@/db/schema'
import {
  ImapFlow,
  type FetchMessageObject,
  type FetchQueryObject,
  type ImapFlowError
} from 'imapflow'
import { simpleParser, type SimpleParserOptions } from 'mailparser'
import { readFileSync } from 'node:fs'
import { identitiesByAddress } from './addresses'
import {
  claimSyncLease,
  holdsLease,
  LeaseLostError,
  nextLeaseEnd,
  recordSyncFailure,
  recordSyncSuccess,
  type SyncLease
} from './mailbox'
import { recipientOf, toMessageRow } from './parse-message'
import {
  inboundMailConfig,
  MAIL_SYNC_SETTINGS,
  SYNCED_FOLDER,
  type InboundMailConfig
} from './settings'

/**
 * One sync pass over our mail server's mailbox (mailserver/README.md), where
 * every identity address delivers.
 *
 * The cursor is the pair (UIDVALIDITY, last UID handled). A pass asks for the
 * UIDs above it and handles them oldest first, in batches; each batch's rows
 * and the cursor move in one transaction, so a crash part-way never skips
 * mail and never stores it twice. The database refuses duplicates as well:
 * UNIQUE (mailbox, UIDVALIDITY, UID), and (identity, Message-ID), which
 * outlives a UIDVALIDITY change.
 *
 * Each copy is stored for the identity whose address it was delivered to.
 * Mail for an address no identity has (spam to made-up addresses) is skipped;
 * it stays on the server.
 *
 * The folder is opened read-only and bodies are fetched with BODY.PEEK, so a
 * pass changes nothing on the server.
 */

type SyncResult =
  | { status: 'skipped' }
  | { status: 'synced'; stored: number; unrouted: number; backlog: boolean }
  | { status: 'failed'; error: string }

const FETCH_QUERY: FetchQueryObject = {
  uid: true,
  envelope: true,
  internalDate: true,
  size: true,
  // Routes a copy before its source is parsed (see rowsFor).
  headers: ['delivered-to'],
  source: { maxLength: MAIL_SYNC_SETTINGS.maxSourceBytes }
}

const PARSER_OPTIONS: SimpleParserOptions = {
  // cid: images stay links: inlining them as data URLs multiplies the HTML size.
  keepCidLinks: true,
  // HTML-only mail gets its text from readableText (parse-message.ts), the
  // one conversion for every email; mailparser's own shouts headings in capitals.
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipTextLinks: true
}

/** Network errors worth a quiet retry rather than the raw message. */
const UNREACHABLE_CODES = new Set([
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'UPGRADE_TIMEOUT',
  'ETIMEOUT',
  'ETIMEDOUT',
  'NoConnection',
  'EConnectionClosed',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE'
])

/** imapflow's errors are Errors whose extra fields are all optional. */
function imapError(err: unknown): ImapFlowError | null {
  return err instanceof Error ? err : null
}

/** What the inbox shows about a failed pass. Never email content or secrets. */
function describeSyncError(err: unknown): string {
  if (imapError(err)?.authenticationFailed) {
    return 'The mail server refused the login. Check MAIL_IMAP_USER and MAIL_IMAP_PASSWORD.'
  }
  const code = imapError(err)?.code
  if (code && UNREACHABLE_CODES.has(code)) {
    return 'Could not reach the mail server. Syncing will retry automatically.'
  }
  const message = err instanceof Error ? err.message : String(err)
  return `Sync failed: ${message.slice(0, 300)}`
}

function sortedUids(found: number[] | false | undefined) {
  return (found || []).slice().sort((a, b) => a - b)
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Stores one batch and moves the cursor to `lastUid`, in one transaction that
 * also renews the lease. The cursor update goes first, so a pass that lost
 * its lease fails before inserting anything.
 */
async function commitBatch(
  lease: SyncLease,
  {
    uidValidity,
    lastUid,
    rows
  }: { uidValidity: number; lastUid: number; rows: NewMailMessage[] }
) {
  const until = nextLeaseEnd()
  const stored = await db.transaction(async tx => {
    const [held] = await tx
      .update(mailSyncStateTable)
      .set({ uidValidity, lastUid, syncLeaseUntil: until })
      .where(holdsLease(lease))
      .returning({ id: mailSyncStateTable.id })
    if (!held) throw new LeaseLostError()
    if (rows.length === 0) return 0
    // No target: skips a row that clashes with either unique index.
    const inserted = await tx
      .insert(mailMessagesTable)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: mailMessagesTable.id })
    return inserted.length
  })
  lease.until = until
  return stored
}

async function parseSource(message: FetchMessageObject) {
  if (!message.source) return null
  try {
    return await simpleParser(message.source, PARSER_OPTIONS)
  } catch (err) {
    console.warn(
      `Could not parse message UID ${message.uid}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/**
 * UIDs above the cursor, oldest first. `N:*` always matches the newest
 * message, even when its UID is below N, hence the filter.
 */
async function uidsAfter(client: ImapFlow, lastUid: number) {
  const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
  return sortedUids(found).filter(uid => uid > lastUid)
}

/**
 * One batch as rows, each for the identity it was delivered to. A copy for an
 * address no identity has is skipped before it is parsed.
 */
async function rowsFor(
  messages: FetchMessageObject[],
  config: InboundMailConfig,
  owner: { mailboxId: string; uidValidity: number }
) {
  const recipients = messages.map(message => recipientOf(message, config))
  const identities = await identitiesByAddress(
    recipients.filter((recipient): recipient is string => recipient !== null)
  )
  const rows: NewMailMessage[] = []
  // One at a time: parsing is CPU work on the process that serves pages.
  for (const [i, message] of messages.entries()) {
    const recipient = recipients[i]
    const accountId = recipient ? identities.get(recipient) : undefined
    if (!accountId) continue
    rows.push(
      toMessageRow({ ...owner, accountId }, message, await parseSource(message))
    )
  }
  return { rows, unrouted: messages.length - rows.length }
}

async function pullNewMessages(
  client: ImapFlow,
  config: InboundMailConfig,
  state: MailSyncState,
  lease: SyncLease,
  deadline: number
) {
  const lock = await client.getMailboxLock(SYNCED_FOLDER, { readOnly: true })
  try {
    if (!client.mailbox)
      throw new Error(`${SYNCED_FOLDER} could not be opened.`)
    const uidValidity = Number(client.mailbox.uidValidity)
    // A new UIDVALIDITY: the mailbox was rebuilt and old UIDs mean nothing,
    // so it is read again from the start; Message-IDs catch the repeats.
    const restart = state.uidValidity !== uidValidity
    if (restart && state.uidValidity !== null) {
      console.warn(
        'The mailbox UIDVALIDITY changed; reading it again from the start.'
      )
    }
    const lastUid = restart ? 0 : state.lastUid

    const uids = await uidsAfter(client, lastUid)
    if (uids.length === 0) {
      if (restart)
        await commitBatch(lease, { uidValidity, lastUid: 0, rows: [] })
      return { stored: 0, unrouted: 0, backlog: false }
    }

    const owner = { mailboxId: state.id, uidValidity }
    let stored = 0
    let unrouted = 0
    let handled = 0
    for (const batch of chunk(
      uids.slice(0, MAIL_SYNC_SETTINGS.maxMessagesPerPass),
      MAIL_SYNC_SETTINGS.fetchBatchSize
    )) {
      if (Date.now() > deadline) break
      const messages = await client.fetchAll(batch, FETCH_QUERY, { uid: true })
      const result = await rowsFor(messages, config, owner)
      // The batch's last UID, not the last one returned: a message deleted
      // between SEARCH and FETCH must not be asked for again.
      stored += await commitBatch(lease, {
        uidValidity,
        lastUid: Math.max(...batch),
        rows: result.rows
      })
      unrouted += result.unrouted
      handled += batch.length
    }
    return { stored, unrouted, backlog: handled < uids.length }
  } finally {
    lock.release()
  }
}

async function openImap(config: InboundMailConfig) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.password },
    // A self-signed local certificate is checked against its own CA, never skipped.
    ...(config.tlsCaFile && { tls: { ca: readFileSync(config.tlsCaFile) } }),
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 2 * 60_000
  })
  // Without a listener, an 'error' event on a dropped socket would crash the process.
  client.on('error', err => {
    console.warn(
      'IMAP connection error:',
      err instanceof Error ? err.message : err
    )
  })
  try {
    await client.connect()
  } catch (err) {
    client.close()
    throw err
  }
  return client
}

/**
 * Runs one pass if the mailbox is due and no other pass holds it. Never
 * throws: the outcome is recorded on the sync state, where the inbox shows it.
 */
export async function syncInbox(): Promise<SyncResult> {
  const config = inboundMailConfig()
  if (!config) return { status: 'skipped' }
  const claim = await claimSyncLease(config.user)
  if (!claim) return { status: 'skipped' }
  const { row: state, lease } = claim
  const startedAt = new Date()
  const deadline = startedAt.getTime() + MAIL_SYNC_SETTINGS.passDeadlineMs
  let client: ImapFlow | null = null

  try {
    client = await openImap(config)
    const result = await pullNewMessages(client, config, state, lease, deadline)
    // The mail is stored: a failed goodbye is not a failed sync.
    await client.logout().catch(() => client?.close())
    await recordSyncSuccess(lease, { startedAt, backlog: result.backlog })
    return { status: 'synced', ...result }
  } catch (err) {
    if (err instanceof LeaseLostError) return { status: 'skipped' }
    const message = describeSyncError(err)
    console.error(
      'Inbox sync failed:',
      imapError(err)?.code ?? '',
      err instanceof Error ? err.message : err
    )
    await recordSyncFailure(lease, {
      message,
      failures: state.consecutiveFailures + 1
    }).catch(recordErr =>
      console.error('Could not record the inbox sync failure:', recordErr)
    )
    return { status: 'failed', error: message }
  } finally {
    // Already closed after a clean logout; this ends a connection a failure left open.
    if (client?.usable) client.close()
  }
}
