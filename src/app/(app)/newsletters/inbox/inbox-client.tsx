'use client'

import { Button } from '@/components/button'
import { FormAlert } from '@/components/form-alert'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { showToast } from '@/components/toast-notification'
import { EmptyState } from '@/components/ui/empty-state'
import { FIELD_CLASS } from '@/components/ui/field'
import {
  FilterChips,
  type FilterChipOption
} from '@/components/ui/filter-chips'
import { StatusChip } from '@/components/ui/status-chip'
import { TimeAgo } from '@/components/ui/time-ago'
import { FOCUS_RING } from '@/components/ui/tone'
import type { MailAddress } from '@/db/schema'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { MAX_INBOX_QUERY_LENGTH } from '@/lib/inbox-path'
import type { PageInfo } from '@/lib/pagination'
import {
  ArrowLeft,
  Inbox,
  Loader2,
  Mail,
  Paperclip,
  RefreshCw,
  Search,
  SearchX,
  Sparkles,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent
} from 'react'
import { RETENTION_SETTINGS } from '~/lib/intel/settings'
import type { MailSyncStatus } from '~/lib/mail/mailbox'
import { isTestDomain } from '~/lib/mail/test-domain'
import { InfoTip } from '@/components/ui/info-tip'
import {
  getInboxMessage,
  getInboxSyncStatus,
  pollInbox,
  refreshInbox
} from './actions'
import { EmailBody } from './email-body'
import { EmailInsights } from './email-insights'
import { InboxAddress } from './inbox-address'
import type {
  InboxListItem,
  InboxMessage,
  InboxProgress,
  InboxStats
} from './inbox-data'
import { emailProcessing, inboxHref, type InboxFilter } from './inbox-status'

const SYNCING_POLL_MS = 3000
const IDLE_POLL_MS = 60_000
/** While emails are being read, the inbox checks on them this often… */
const READING_POLL_MS = 5000
/** …for five minutes at most; the next sync or visit shows the rest. */
const MAX_READING_POLLS = 60

const NOT_SET_UP_HELP =
  'An administrator needs to set INBOUND_EMAIL_DOMAIN and either MAIL_WEBHOOK_SECRET for Cloudflare Email Routing (see cloudflare/email-worker/README.md) or the MAIL_IMAP_* settings for our mail server (see mailserver/README.md).'

const PARTLY_SAVED_HELP =
  'This email is large, so only its first part was saved.'

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
  /** The filter the page was loaded with (?status=); null for all emails. */
  filter: InboxFilter | null
  stats: InboxStats
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
 * The figures and listed emails' states, as one string: the poll compares
 * the page's with what it gets back, and refreshes the page only when they
 * differ.
 */
function progressKey(stats: InboxStats, emails: InboxProgress[]) {
  return [
    stats.received,
    stats.newsletters,
    stats.stories,
    stats.processing,
    stats.failed,
    ...emails
      .map(e => `${e.id}:${e.extractionStatus}:${e.digestKind}:${e.storyCount}`)
      .sort()
  ].join('|')
}

/**
 * The identity's inbox: the mail our mail server received at its address,
 * with search, a filter and paging (in the URL, loaded on the server) and a
 * reading pane that loads one email at a time.
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
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-4 sm:p-6">
        <EmptyState
          icon={Mail}
          tone="brand"
          title="Inbox not set up"
          description={
            <>
              An administrator needs to set up inbound email.{' '}
              <InfoTip label="Setup details">{NOT_SET_UP_HELP}</InfoTip>
            </>
          }
          className="w-full max-w-lg"
        />
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
  query,
  filter,
  stats
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
  // The pager sits outside the list's scroll box, so it is told what to bring
  // into view on a page change.
  const emailListRef = useRef<HTMLUListElement>(null)
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

  // Emails are read after they arrive (src/lib/intel). While some are being
  // read, or are due to be, a small action (pollInbox) checks the figures and
  // the listed emails, and the page is refreshed only when one of them
  // changed. Not during a sync: the poll above refreshes once it is done.
  // A change starts the five minutes again; a queue that does not move
  // stops being polled.
  const readingNow = stats.due
  const listedIds = messages.map(message => message.id).join(',')
  const shownProgress = progressKey(stats, messages)
  useEffect(() => {
    if (readingNow === 0 || syncing) return
    const ids = listedIds ? listedIds.split(',') : []
    let polls = 0
    const timer = setInterval(async () => {
      if (++polls > MAX_READING_POLLS) return clearInterval(timer)
      if (document.visibilityState !== 'visible') return
      const res = await pollInbox(ids).catch(() => null)
      if (
        res?.success &&
        progressKey(res.stats, res.emails) !== shownProgress
      ) {
        router.refresh()
      }
    }, READING_POLL_MS)
    return () => clearInterval(timer)
  }, [readingNow, syncing, listedIds, shownProgress, router])

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
    const closed = selectedId
    latestSelection.current = null
    setSelectedId(null)
    // On a phone the list comes back in place of the email: focus returns to
    // the email it was opened from, not to the top of the page.
    if (closed) {
      requestAnimationFrame(() =>
        emailListRef.current
          ?.querySelector<HTMLElement>(`[data-email-id="${closed}"]`)
          ?.focus()
      )
    }
  }

  // A new search or filter starts at the first page; each keeps the other.
  const navigate = (q: string, nextFilter: InboxFilter | null) => {
    startNavigation(() => {
      router.push(inboxHref({ q: q.trim(), status: nextFilter }))
    })
  }
  const search = (value: string) => navigate(value, filter)

  // ↑/↓ (or k/j), Home and End move between the emails while one has focus;
  // Enter or Space opens it, as for any button.
  const moveFocus = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-email-id]')
    )
    const index = items.indexOf(event.target as HTMLElement)
    if (index === -1) return
    const next =
      event.key === 'ArrowDown' || event.key === 'j'
        ? index + 1
        : event.key === 'ArrowUp' || event.key === 'k'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    items[Math.min(items.length - 1, Math.max(0, next))]?.focus()
  }

  // The email counts live on these chips only (the strip above shows the
  // stories). They are the whole inbox's: with a search they would not match
  // what the list shows, so they are left off then.
  const counted = (n: number) => (query ? undefined : n)
  const filterOptions: FilterChipOption<'all' | InboxFilter>[] = [
    { value: 'all', label: 'All', count: counted(stats.received) },
    {
      value: 'newsletters',
      label: 'Newsletters',
      count: counted(stats.newsletters),
      tone: 'success'
    },
    {
      value: 'processing',
      label: 'Processing',
      count: counted(stats.processing),
      tone: 'brand'
    },
    {
      value: 'failed',
      label: 'Failed',
      count: counted(stats.failed),
      tone: 'danger'
    }
  ]
  const pagerQuery: Record<string, string> = {}
  if (query) pagerQuery.q = query
  if (filter) pagerQuery.status = filter

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Inbox"
        description="Newsletters sent to your address."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={syncing}
            className={FOCUS_RING}
          >
            <RefreshCw
              aria-hidden
              className={cn(
                'h-3.5 w-3.5',
                syncing && 'animate-spin motion-reduce:animate-none'
              )}
            />
            {syncing ? 'Syncing…' : 'Refresh'}
          </Button>
        }
        bottomContent={
          // Padded so the focus rings of the address' buttons are not cut
          // off by the strip's sideways scroll.
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 p-0.5">
            <InboxAddress
              address={address}
              domain={domain}
              earlierAddresses={earlierAddresses}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              {syncing ? (
                <StatusChip tone="brand" spinning>
                  Syncing…
                </StatusChip>
              ) : status.lastSyncedAt ? (
                <StatusChip tone={status.lastError ? 'neutral' : 'success'}>
                  Synced <TimeAgo value={status.lastSyncedAt} />
                </StatusChip>
              ) : (
                <StatusChip tone="neutral">Not synced yet</StatusChip>
              )}
              <p className="text-muted">
                <span className="text-foreground text-sm font-semibold tabular-nums">
                  {stats.stories.toLocaleString('en')}
                </span>{' '}
                stories
              </p>
            </div>
          </div>
        }
      />

      {status.lastError && !syncing && (
        <div className="px-4 pt-4 sm:px-6">
          <FormAlert variant="error">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0">Sync failed: {status.lastError}</span>
              <button
                type="button"
                onClick={refresh}
                className={cn(
                  'cursor-pointer rounded-sm font-medium underline underline-offset-2',
                  FOCUS_RING
                )}
              >
                Try again
              </button>
            </span>
          </FormAlert>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          aria-label="Emails"
          className={cn(
            'border-border bg-surface w-full shrink-0 flex-col lg:flex lg:w-96 lg:border-r xl:w-104',
            selectedId ? 'hidden' : 'flex'
          )}
        >
          <div className="border-border space-y-3 border-b px-3 py-3 sm:px-4">
            <form
              key={query}
              role="search"
              onSubmit={e => {
                e.preventDefault()
                search(String(new FormData(e.currentTarget).get('q') ?? ''))
              }}
              className="flex items-center gap-2"
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
                  placeholder="Search"
                  aria-label="Search sender, subject or text"
                  className={cn(FIELD_CLASS, 'bg-surface-hover h-9 py-1.5 pr-3 pl-8.5')}
                />
              </div>
              {navigating ? (
                <Loader2
                  aria-label="Loading"
                  className="text-muted h-4 w-4 animate-spin motion-reduce:animate-none"
                />
              ) : (
                query && (
                  <button
                    type="button"
                    onClick={() => search('')}
                    aria-label="Clear search"
                    title="Clear search"
                    className={cn(
                      'text-muted hover:text-foreground hover:bg-surface-hover flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg',
                      FOCUS_RING
                    )}
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                )
              )}
            </form>
            <FilterChips
              options={filterOptions}
              value={filter ?? 'all'}
              onChange={value =>
                navigate(query, value === 'all' ? null : value)
              }
              label="Show emails"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            {messages.length === 0 ? (
              <EmptyList
                syncing={syncing}
                narrowed={Boolean(query || filter)}
                address={address}
                onShowAll={() => navigate('', null)}
              />
            ) : (
              <ul
                ref={emailListRef}
                aria-label="Emails, newest first"
                onKeyDown={moveFocus}
                className="space-y-1"
              >
                {messages.map(message => (
                  <li key={message.id}>
                    <EmailListItem
                      message={message}
                      active={message.id === selectedId}
                      onOpen={() => openMessage(message.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {pageInfo.pageCount > 1 && (
            <div className="border-border border-t px-4 py-2.5">
              <Pagination
                {...pageInfo}
                noun="emails"
                query={pagerQuery}
                scrollTarget={emailListRef}
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
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={Inbox}
                bordered={false}
                title="Select an email"
                description={
                  <>
                    <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move, <Kbd>Enter</Kbd> to open
                  </>
                }
              />
            </div>
          ) : (
            <article className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 p-4 sm:p-6">
              <button
                type="button"
                onClick={closeMessage}
                className={cn(
                  'text-muted hover:text-foreground -ml-1 inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-[13px] font-medium lg:hidden',
                  FOCUS_RING
                )}
              >
                <ArrowLeft aria-hidden className="h-4 w-4" />
                Back
              </button>
              {detailError ? (
                <FormAlert variant="error">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0">{detailError}</span>
                    <button
                      type="button"
                      onClick={() => openMessage(selectedId)}
                      className={cn(
                        'cursor-pointer rounded-sm font-medium underline underline-offset-2',
                        FOCUS_RING
                      )}
                    >
                      Try again
                    </button>
                  </span>
                </FormAlert>
              ) : selected ? (
                <MessageView
                  message={selected}
                  hasMounted={hasMounted}
                  onInsightsChanged={() => router.refresh()}
                />
              ) : (
                <div
                  role="status"
                  className="text-muted flex flex-1 items-center justify-center gap-2 text-sm"
                >
                  <Loader2
                    aria-hidden
                    className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                  Loading…
                </div>
              )}
            </article>
          )}
        </section>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="border-border bg-surface text-foreground rounded border px-1 font-sans text-[11px] font-semibold">
      {children}
    </kbd>
  )
}

function EmailListItem({
  message,
  active,
  onOpen
}: {
  message: InboxListItem
  active: boolean
  onOpen: () => void
}) {
  const processing = emailProcessing({
    status: message.extractionStatus,
    error: message.extractionError,
    kind: message.digestKind,
    storyCount: message.storyCount,
    superseded: message.superseded
  })
  // The digest's summary says more than the email's first lines.
  const preview = message.digestSummary || message.snippet
  return (
    <button
      type="button"
      data-email-id={message.id}
      onClick={onOpen}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'relative w-full cursor-pointer rounded-xl border px-3.5 py-3 text-left transition-colors',
        FOCUS_RING,
        active
          ? 'border-border bg-surface-hover/70 shadow-xs'
          : 'hover:bg-surface-hover/50 border-transparent'
      )}
    >
      {active && (
        <span
          aria-hidden
          className="bg-brand absolute top-3 bottom-3 left-0 w-0.5 rounded-full"
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
        <TimeAgo
          value={message.receivedAt}
          className="text-muted shrink-0 text-xs"
        />
      </span>
      <span className="mt-1 flex items-center gap-2">
        <span className="text-foreground/90 min-w-0 flex-1 truncate text-[13px]">
          {message.subject || '(no subject)'}
        </span>
        <StatusChip
          tone={processing.tone}
          spinning={processing.spinning}
          title={processing.detail ?? undefined}
        >
          {processing.label}
        </StatusChip>
      </span>
      {preview && (
        <span className="text-muted mt-1 flex items-center gap-1.5 text-xs">
          {message.digestSummary && (
            <Sparkles
              aria-hidden
              className="text-brand-strong h-3 w-3 shrink-0"
            />
          )}
          <span className="min-w-0 truncate">{preview}</span>
        </span>
      )}
    </button>
  )
}

function EmptyList({
  syncing,
  narrowed,
  address,
  onShowAll
}: {
  syncing: boolean
  /** A search or a filter is on. */
  narrowed: boolean
  address: string | null
  onShowAll: () => void
}) {
  if (narrowed) {
    return (
      <EmptyState
        compact
        bordered={false}
        icon={SearchX}
        title="No matching emails"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={onShowAll}
            className={FOCUS_RING}
          >
            Show all
          </Button>
        }
      />
    )
  }
  if (syncing) {
    return (
      <EmptyState
        compact
        bordered={false}
        tone="brand"
        icon={RefreshCw}
        title="Checking for mail…"
      />
    )
  }
  return (
    <EmptyState
      compact
      bordered={false}
      icon={Inbox}
      title="No emails yet"
      description={
        !address
          ? 'Choose your address above to start.'
          : isTestDomain(address.slice(address.indexOf('@') + 1))
            ? `Send a test email to ${address}.`
            : `Subscribe to newsletters with ${address}.`
      }
    />
  )
}

function MessageView({
  message,
  hasMounted,
  onInsightsChanged
}: {
  message: InboxMessage
  hasMounted: boolean
  /** A retry or a sender change: the list's chip for this email changes. */
  onInsightsChanged: () => void
}) {
  const sender = senderOf(message)
  const textOnly =
    hasMounted && !message.htmlBody && isPastHtmlRetention(message)
  return (
    <>
      <header className="space-y-4">
        <h2 className="text-foreground text-lg font-semibold tracking-tight wrap-break-word sm:text-xl">
          {message.subject || '(no subject)'}
        </h2>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="bg-brand/10 text-brand-strong flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase"
          >
            {sender.trim().charAt(0) || '?'}
          </span>
          <div className="min-w-0 flex-1 space-y-0.5 text-sm wrap-break-word">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-foreground min-w-0">
                <span className="font-semibold">{sender}</span>
                {message.fromName && message.fromAddress && (
                  <span className="text-muted text-xs">
                    {` <${message.fromAddress}>`}
                  </span>
                )}
              </p>
              <TimeAgo
                absolute
                value={message.sentAt ?? message.receivedAt}
                className="text-muted shrink-0 text-xs"
              />
            </div>
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
        </div>
        {(message.attachments.length > 0 || message.truncated || textOnly) && (
          <ul aria-label="About this email" className="flex flex-wrap gap-2">
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
                <span className="text-muted shrink-0 tabular-nums">
                  {formatBytes(attachment.size)}
                </span>
              </li>
            ))}
            {message.truncated && (
              <li>
                <StatusChip tone="neutral" title={PARTLY_SAVED_HELP}>
                  Partly saved
                </StatusChip>
              </li>
            )}
            {textOnly && (
              <li>
                <StatusChip
                  tone="neutral"
                  title={`An email's original layout is kept for ${RETENTION_SETTINGS.emailHtmlDays} days. Its stories stay in your Knowledge base.`}
                >
                  Text only
                </StatusChip>
              </li>
            )}
          </ul>
        )}
      </header>
      <EmailInsights
        key={`insights-${message.id}`}
        messageId={message.id}
        onChanged={onInsightsChanged}
      />
      <EmailBody
        key={message.id}
        html={message.htmlBody}
        text={message.textBody}
      />
    </>
  )
}
