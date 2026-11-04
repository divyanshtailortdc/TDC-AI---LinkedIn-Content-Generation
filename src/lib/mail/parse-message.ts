import type {
  MailAddress,
  MailAttachmentMeta,
  NewMailMessage
} from '@/db/schema'
import { load } from 'cheerio'
import type { FetchMessageObject, MessageAddressObject } from 'imapflow'
import type {
  AddressObject,
  EmailAddress,
  ParsedMail,
  SimpleParserOptions
} from 'mailparser'
import { createHash } from 'node:crypto'
import { INVISIBLE, readableText } from '../html-text'
import { MAIL_SYNC_SETTINGS } from './settings'

/**
 * One fetched IMAP message as a mail_messages row for the identity it was
 * delivered to. mailparser's result is preferred; the IMAP envelope fills in
 * when the source could not be parsed, so a malformed email is still listed
 * instead of blocking the sync cursor. Webhook mail (webhook.ts) is built the
 * same way, from a message shaped like a fetched one.
 */

/** How every email's source is parsed, whichever way it arrived. */
export const PARSER_OPTIONS: SimpleParserOptions = {
  // cid: images stay links: inlining them as data URLs multiplies the HTML size.
  keepCidLinks: true,
  // HTML-only mail gets its text from readableText (below), the one
  // conversion for every email; mailparser's own shouts headings in capitals.
  skipHtmlToText: true,
  skipTextToHtml: true,
  skipTextLinks: true
}

/** What toMessageRow reads of a message besides its parsed source. */
export type ReceivedMessage = Pick<
  FetchMessageObject,
  'uid' | 'envelope' | 'size' | 'internalDate'
>

/** Postgres text and jsonb reject NUL, which broken mailers do send. */
function clean(value: string | null | undefined, max?: number): string | null {
  if (!value) return null
  const text = value.replaceAll('\u0000', '').trim()
  if (!text) return null
  return max && text.length > max ? text.slice(0, max) : text
}

function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function toAddress(
  name: string | null | undefined,
  address: string | null | undefined
): MailAddress | null {
  const cleanAddress = clean(address, 320)
  return cleanAddress ? { name: clean(name, 200), address: cleanAddress } : null
}

/** Group syntax ("Team: a@x, b@x;") is flattened into its members. */
function flatten(entry: EmailAddress): MailAddress[] {
  if (entry.group) return entry.group.flatMap(flatten)
  const address = toAddress(entry.name, entry.address)
  return address ? [address] : []
}

function parsedAddresses(
  list: AddressObject | AddressObject[] | undefined
): MailAddress[] {
  const objects = Array.isArray(list) ? list : list ? [list] : []
  return objects.flatMap(object => object.value.flatMap(flatten)).slice(0, 100)
}

function envelopeAddresses(
  list: MessageAddressObject[] | undefined
): MailAddress[] {
  return (list ?? [])
    .map(entry => toAddress(entry.name, entry.address))
    .filter((entry): entry is MailAddress => entry !== null)
    .slice(0, 100)
}

/**
 * The email's text: its text part, or for HTML-only mail (most newsletters)
 * the readable text of its HTML.
 */
function bodyText(
  parsed: ParsedMail | null,
  html: string | null
): string | null {
  const text =
    parsed?.text?.trim() || (html ? readableText(load(html)) : undefined)
  const stripped = text
    ?.replace(INVISIBLE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
  return clean(stripped, MAIL_SYNC_SETTINGS.maxTextChars)
}

function snippetOf(text: string | null): string | null {
  return clean(text?.replace(/\s+/g, ' '), MAIL_SYNC_SETTINGS.snippetChars)
}

/** Files people attached; images only embedded in the HTML are left out. */
function attachmentsOf(parsed: ParsedMail | null): MailAttachmentMeta[] {
  return (parsed?.attachments ?? [])
    .filter(a => a.contentDisposition === 'attachment' || !a.related)
    .slice(0, MAIL_SYNC_SETTINGS.maxAttachments)
    .map(a => ({
      filename: clean(a.filename, 255),
      contentType: a.contentType,
      size: a.size
    }))
}

/**
 * What makes a stored email the same email whatever its Message-ID: the
 * sender, subject and both bodies exactly as stored. The unique index on
 * (identity, content_hash) then refuses a copy delivered again without a
 * Message-ID, resent under a new one, or read again from a rebuilt mailbox.
 * Exact on purpose: two different issues must never be taken for one.
 *
 * Null without a body, so emails that could not be parsed are never taken
 * for one another. Migration 0031 computes the same digest in SQL for the
 * mail stored before it; keep the two in step.
 */
export function contentHashOf(
  row: Pick<NewMailMessage, 'fromAddress' | 'subject' | 'htmlBody' | 'textBody'>
): string | null {
  if (!row.htmlBody && !row.textBody) return null
  return createHash('sha256')
    .update(
      [
        row.fromAddress ?? '',
        row.subject ?? '',
        row.htmlBody ?? '',
        row.textBody ?? ''
      ].join('\n')
    )
    .digest('hex')
}

/**
 * The local part of the identity address a copy was delivered to (`test`
 * for test@<domain>), lower-case, or null. Our mail server rewrites every
 * address at the domain to `<mailbox>+<local part>` and Dovecot records that
 * in Delivered-To (mailserver/README.md), which holds even when a
 * newsletter's own To shows a list address. Read from the fetched header
 * alone, so a copy can be routed before it is parsed.
 */
export function recipientOf(
  message: FetchMessageObject,
  mailbox: { user: string; domain: string }
): string | null {
  const deliveredTo = message.headers
    ?.toString('utf8')
    .match(/^delivered-to:\s*<?([^\s<>]+@[^\s<>]+)>?/im)?.[1]
    ?.toLowerCase()
  const prefix = `${mailbox.user.split('@')[0]}+`
  const suffix = `@${mailbox.domain}`
  if (!deliveredTo?.startsWith(prefix) || !deliveredTo.endsWith(suffix))
    return null
  return deliveredTo.slice(prefix.length, -suffix.length) || null
}

export function toMessageRow(
  owner: { accountId: string; mailboxId: string; uidValidity: number },
  message: ReceivedMessage,
  parsed: ParsedMail | null
): NewMailMessage {
  const envelope = message.envelope
  const from =
    parsedAddresses(parsed?.from)[0] ?? envelopeAddresses(envelope?.from)[0]
  const html = parsed?.html ? parsed.html.replaceAll('\u0000', '') : null
  const textBody = bodyText(parsed, html)
  const sentAt = validDate(parsed?.date) ?? validDate(envelope?.date)

  const row: NewMailMessage = {
    accountId: owner.accountId,
    mailboxId: owner.mailboxId,
    uidValidity: owner.uidValidity,
    uid: message.uid,
    messageIdHeader: clean(parsed?.messageId ?? envelope?.messageId, 998),
    fromName: from?.name ?? null,
    fromAddress: from?.address ?? null,
    toAddresses: parsed
      ? parsedAddresses(parsed.to)
      : envelopeAddresses(envelope?.to),
    ccAddresses: parsed
      ? parsedAddresses(parsed.cc)
      : envelopeAddresses(envelope?.cc),
    subject: clean(parsed?.subject ?? envelope?.subject, 1000),
    snippet: snippetOf(textBody),
    textBody,
    // Too long to keep: the text version is shown instead.
    htmlBody:
      html && html.length <= MAIL_SYNC_SETTINGS.maxHtmlChars ? html : null,
    attachments: attachmentsOf(parsed),
    truncated: (message.size ?? 0) > MAIL_SYNC_SETTINGS.maxSourceBytes,
    sentAt,
    receivedAt: validDate(message.internalDate) ?? sentAt ?? new Date()
  }
  return {
    ...row,
    contentHash: contentHashOf(row),
    // Listed from its envelope, but with nothing to read: the inbox says so,
    // instead of calling it "not a newsletter". Not retried on its own, as
    // the same bytes fail the same way.
    ...(parsed
      ? {}
      : {
          extractionStatus: 'failed' as const,
          extractionError: UNREADABLE_EMAIL
        })
  }
}

/** Why an email whose source could not be parsed has no stories. */
export const UNREADABLE_EMAIL =
  'Its content could not be read: the email is malformed or arrived incomplete.'
