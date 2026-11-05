'use client'

import { Button } from '@/components/button'
import { FormAlert } from '@/components/form-alert'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { showToast } from '@/components/toast-notification'
import type { MailAddress } from '@/db/schema'
import { cn } from '@/lib/cn'
import { formatAbsoluteDateTime, formatRelativeDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { INBOX_PATH, MAX_INBOX_QUERY_LENGTH } from '@/lib/inbox-path'
import type { PageInfo } from '@/lib/pagination'
import {
  ArrowLeft,
  Inbox,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { RETENTION_SETTINGS } from '~/lib/intel/settings'
import type { MailSyncStatus } from '~/lib/mail/mailbox'
import { isTestDomain } from '~/lib/mail/test-domain'
import { getInboxMessage, getInboxSyncStatus, refreshInbox } from './actions'
import { EmailBody } from './email-body'
import { EmailInsights } from './email-insights'
import { InboxAddress } from './inbox-address'
import type { InboxListItem, InboxMessage } from './inbox-data'

const SYNCING_POLL_MS = 3000
const IDLE_POLL_MS = 60_000

type InboxData = {
  /** The identity's address: mail sent to it shows up here. Null until chosen. */
  address: string | null
  /** Replaced addresses, which still deliver here. */
  earlierAddresses: string[]
  /** INBOUND_EMAIL_DOMAIN, for choosing a new address. */
  domain: string
  status: MailSyncStatus
  messages: InboxListItem[]
  pageInfo: PageInfo
  /** The search the page was loaded with (?q=). */
  query: string
}

/** Old enough that upkeep has cleared its HTML (src/lib/intel/tidy.ts). */
function isPastHtmlRetention(message: Pick<InboxMessage, 'receivedAt'>) {
  const days = RETENTION_SETTINGS.emailHtmlDays * 24 * 60 * 60_000
  return Date.now() - new Date(message.receivedAt).getTime() > days
}

function senderOf(message: Pick<InboxListItem, 'fromName' | 'fromAddress'>) {
  return message.fromName || message.fromAddress || 'Unknown sender'
}

/** "Ana <ana@x.com>, bob@y.com and 3 more" */
function formatAddresses(addresses: MailAddress[]) {
  const shown = addresses
    .slice(0, 4)
    .map(a => (a.name ? `${a.name} <${a.address}>` : a.address))
    .join(', ')
  const more = addresses.length - 4
  return more > 0 ? `${shown} and ${more} more` : shown
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The identity's inbox: the mail our mail server received at its address,
 * with search and paging (in the URL, loaded on the server) and a reading
 * pane that loads one email at a time.
 */
export function InboxClient({ inbox }: { inbox: InboxData | null }) {
  return inbox ? <IdentityInbox {...inbox} /> : <NotSetUp />
}

function NotSetUp() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Inbox"
        description="The emails your identity receives."
      />
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 sm:p-8">
        <div className="border-border bg-surface w-full max-w-md rounded-2xl border p-8 text-center shadow-xs">
          <div className="bg-accent/10 mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
            <Mail aria-hidden className="text-accent h-7 w-7" />
          </div>
          <h2 className="text-foreground mb-2 text-lg font-semibold">
            The inbox is not set up yet
          </h2>
          <p className="text-muted text-sm leading-relaxed">
            An administrator needs to set INBOUND_EMAIL_DOMAIN and either
            MAIL_WEBHOOK_SECRET for Cloudflare Email Routing (see
            cloudflare/email-worker/README.md) or the MAIL_IMAP_* settings for
            our mail server (see mailserver/README.md).
          </p>
        </div>
      </div>
    </div>
  )
}

function IdentityInbox({
  address,
  earlierAddresses,
  domain,
  status,
  messages,
  pageInfo,
  query
}: InboxData) {
  const router = useRouter()
  const hasMounted = useHasMounted()
  const [navigating, startNavigation] = useTransition()

  // Refresh was pressed and its pass has not reported back yet.
  const [requested, setRequested] = useState(false)
  const syncing = status.syncing || requested

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, InboxMessage>>({})
  const [detailError, setDetailError] = useState<string | null>(null)
  const latestSelection = useRef<string | null>(null)
  const selected = selectedId ? details[selectedId] : undefined

  // Polls a small action, not the page: every few seconds while a pass runs,
  // otherwise once a minute in case the background sync brought new mail.
  // The page itself is refreshed only when something changed.
  const lastSyncedAt = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).getTime()
    : 0
  useEffect(() => {
    const interval = setInterval(
      async () => {
        if (document.visibilityState !== 'visible') return
        const res = await getInboxSyncStatus().catch(() => null)
        if (!res?.success) return
        const synced = res.status.lastSyncedAt
          ? new Date(res.status.lastSyncedAt).getTime()
          : 0
        const changed = syncing ? !res.status.syncing : synced !== lastSyncedAt
        if (changed) {
          setRequested(false)
          router.refresh()
        }
      },
      syncing ? SYNCING_POLL_MS : IDLE_POLL_MS
    )
    return () => clearInterval(interval)
  }, [syncing, lastSyncedAt, router])

  const refresh = async () => {
    setRequested(true)
    const res = await refreshInbox().catch(() => null)
    if (!res?.success) {
      setRequested(false)
      showToast({
        type: 'error',
        title: 'Could not refresh',
        message: res?.error ?? 'Please try again.'
      })
    }
  }

  const openMessage = async (id: string) => {
    setSelectedId(id)
    setDetailError(null)
    latestSelection.current = id
    if (details[id]) return
    const res = await getInboxMessage(id).catch(() => null)
    if (res?.success) {
      // Kept even if another email was opened meanwhile: it is ready next time.
      setDetails(prev => ({ ...prev, [id]: res.message }))
    } else if (latestSelection.current === id) {
      setDetailError(res?.error ?? 'Could not load this email.')
    }
  }

  const closeMessage = () => {
    latestSelection.current = null
    setSelectedId(null)
  }

  const search = (value: string) => {
    const q = value.trim()
    startNavigation(() => {
      router.push(q ? `${INBOX_PATH}?q=${encodeURIComponent(q)}` : INBOX_PATH)
    })
  }

  const description = syncing
    ? 'Syncing…'
    : status.lastSyncedAt && hasMounted
      ? `Synced ${formatRelativeDate(status.lastSyncedAt)}`
      : 'The emails your identity receives.'

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Inbox"
        description={description}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={syncing}
          >
            <RefreshCw
              aria-hidden
              className={cn('h-3.5 w-3.5', syncing && 'animate-spin')}
            />
            {syncing ? 'Syncing…' : 'Refresh'}
          </Button>
        }
        bottomContent={
          <InboxAddress
            address={address}
            domain={domain}
            earlierAddresses={earlierAddresses}
          />
        }
      />

      {status.lastError && (
        <div className="px-4 pt-4 sm:px-6">
          <FormAlert variant="error">{status.lastError}</FormAlert>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            'border-border bg-surface w-full shrink-0 flex-col lg:flex lg:w-95 lg:border-r',
            selectedId ? 'hidden' : 'flex'
          )}
        >
          <form
            key={query}
            role="search"
            onSubmit={e => {
              e.preventDefault()
              search(String(new FormData(e.currentTarget).get('q') ?? ''))
            }}
            className="border-border flex items-center gap-2 border-b px-4 py-3"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="text-muted pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <input
                name="q"
                type="search"
                defaultValue={query}
                maxLength={MAX_INBOX_QUERY_LENGTH}
                placeholder="Search sender, subject or text"
                aria-label="Search emails"
                className="border-border bg-surface-hover text-foreground placeholder:text-muted focus-visible:ring-foreground/30 h-9 w-full rounded-lg border pr-3 pl-8.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
            {navigating ? (
              <Loader2
                aria-label="Loading"
                className="text-muted h-4 w-4 animate-spin"
              />
            ) : (
              query && (
                <button
                  type="button"
                  onClick={() => search('')}
                  className="text-muted hover:text-foreground flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-medium"
                >
                  <X aria-hidden className="h-3 w-3" />
                  Clear
                </button>
              )
            )}
          </form>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {messages.length === 0 ? (
              <EmptyList syncing={syncing} query={query} address={address} />
            ) : (
              <ul className="space-y-1">
                {messages.map(message => {
                  const active = message.id === selectedId
                  return (
                    <li key={message.id}>
                      <button
                        type="button"
                        onClick={() => openMessage(message.id)}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'relative w-full cursor-pointer rounded-xl border px-3.5 py-3 text-left transition-colors',
                          active
                            ? 'border-border bg-surface-hover/70 shadow-xs'
                            : 'hover:bg-surface-hover/50 border-transparent'
                        )}
                      >
                        {active && (
                          <span
                            aria-hidden
                            className="bg-accent absolute top-3 bottom-3 left-0 w-0.5 rounded-full"
                          />
                        )}
                        <span className="flex items-center gap-2">
                          <span className="text-foreground min-w-0 flex-1 truncate text-[13px] font-semibold">
                            {senderOf(message)}
                          </span>
                          {message.hasAttachments && (
                            <Paperclip
                              aria-label="Has attachments"
                              className="text-muted h-3 w-3 shrink-0"
                            />
                          )}
                          <time
                            dateTime={new Date(
                              message.receivedAt
                            ).toISOString()}
                            title={
                              hasMounted
                                ? formatAbsoluteDateTime(message.receivedAt)
                                : undefined
                            }
                            className="text-muted shrink-0 text-[11px] tabular-nums"
                          >
                            {hasMounted &&
                              formatRelativeDate(message.receivedAt)}
                          </time>
                        </span>
                        <span className="text-foreground/90 mt-0.5 block truncate text-[13px]">
                          {message.subject || '(no subject)'}
                        </span>
                        {message.snippet && (
                          <span className="text-muted mt-0.5 line-clamp-2 block text-xs leading-snug">
                            {message.snippet}
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {pageInfo.pageCount > 1 && (
            <div className="border-border border-t px-4 py-2.5">
              <Pagination
                {...pageInfo}
                noun="emails"
                query={query ? { q: query } : {}}
              />
            </div>
          )}
        </aside>

        <section
          aria-label="Email"
          className={cn(
            'bg-surface-hover/30 min-w-0 flex-1 flex-col overflow-y-auto lg:flex',
            selectedId ? 'flex' : 'hidden'
          )}
        >
          {!selectedId ? (
            <div className="text-muted flex flex-1 flex-col items-center justify-center gap-2 p-8 text-sm">
              <Inbox aria-hidden className="h-6 w-6 opacity-60" />
              Select an email to read it.
            </div>
          ) : (
            <article className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-4 sm:p-6">
              <button
                type="button"
                onClick={closeMessage}
                className="text-muted hover:text-foreground inline-flex w-fit cursor-pointer items-center gap-1.5 text-xs font-medium lg:hidden"
              >
                <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
                Back to inbox
              </button>
              {detailError ? (
                <FormAlert variant="error">{detailError}</FormAlert>
              ) : selected ? (
                <MessageView message={selected} hasMounted={hasMounted} />
              ) : (
                <div className="text-muted flex flex-1 items-center justify-center gap-2 text-sm">
                  <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  Loading email…
                </div>
              )}
            </article>
          )}
        </section>
      </div>
    </div>
  )
}

function EmptyList({
  syncing,
  query,
  address
}: {
  syncing: boolean
  query: string
  address: string | null
}) {
  return (
    <div className="text-muted flex flex-col items-center px-4 py-12 text-center text-xs leading-relaxed">
      {query ? (
        <>
          <Search aria-hidden className="mb-2 h-5 w-5 opacity-60" />
          No emails match “{query}”.
        </>
      ) : syncing ? (
        <>
          <Loader2 aria-hidden className="mb-2 h-5 w-5 animate-spin" />
          Checking for new mail…
        </>
      ) : (
        <>
          <Inbox aria-hidden className="mb-2 h-5 w-5 opacity-60" />
          {!address
            ? 'No emails yet. Choose your address above, then subscribe to newsletters with it.'
            : isTestDomain(address.slice(address.indexOf('@') + 1))
              ? `No emails yet. Send a test email to ${address} through the local mail server and it shows up here.`
              : `No emails yet. Subscribe to newsletters with ${address} and they show up here.`}
        </>
      )}
    </div>
  )
}

function MessageView({
  message,
  hasMounted
}: {
  message: InboxMessage
  hasMounted: boolean
}) {
  return (
    <>
      <header className="space-y-3">
        <h2 className="text-foreground text-lg font-semibold tracking-tight wrap-break-word sm:text-xl">
          {message.subject || '(no subject)'}
        </h2>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5 text-sm wrap-break-word">
            <p className="text-foreground">
              <span className="font-medium">{senderOf(message)}</span>
              {message.fromName && message.fromAddress && (
                <span className="text-muted">
                  {' '}
                  &lt;{message.fromAddress}&gt;
                </span>
              )}
            </p>
            {message.toAddresses.length > 0 && (
              <p className="text-muted text-xs">
                To: {formatAddresses(message.toAddresses)}
              </p>
            )}
            {message.ccAddresses.length > 0 && (
              <p className="text-muted text-xs">
                Cc: {formatAddresses(message.ccAddresses)}
              </p>
            )}
          </div>
          {hasMounted && (
            <time className="text-muted shrink-0 text-xs tabular-nums">
              {formatAbsoluteDateTime(message.sentAt ?? message.receivedAt)}
            </time>
          )}
        </div>
        {message.attachments.length > 0 && (
          <ul aria-label="Attachments" className="flex flex-wrap gap-2">
            {message.attachments.map((attachment, i) => (
              <li
                key={i}
                title="Attachments are listed only; their files are not stored."
                className="border-border bg-surface text-foreground inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs"
              >
                <Paperclip
                  aria-hidden
                  className="text-muted h-3 w-3 shrink-0"
                />
                <span className="truncate">
                  {attachment.filename ?? 'Unnamed file'}
                </span>
                <span className="text-muted shrink-0">
                  {formatBytes(attachment.size)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {message.truncated && (
          <FormAlert variant="info">
            This email is large, so only its first part was saved.
          </FormAlert>
        )}
        {hasMounted && !message.htmlBody && isPastHtmlRetention(message) && (
          <FormAlert variant="info">
            Shown as text: an email&apos;s original layout is kept for{' '}
            {RETENTION_SETTINGS.emailHtmlDays} days. Its stories stay in your
            Knowledge base.
          </FormAlert>
        )}
      </header>
      <EmailInsights key={`insights-${message.id}`} messageId={message.id} />
      <EmailBody
        key={message.id}
        html={message.htmlBody}
        text={message.textBody}
      />
    </>
  )
}
