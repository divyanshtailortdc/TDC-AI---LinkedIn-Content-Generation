'use client'

import { Button, buttonClassName } from '@/components/button'
import { ConfirmPopover } from '@/components/confirm-popover'
import { FormAlert } from '@/components/form-alert'
import { PageHeader } from '@/components/page-header'
import { StatusFilterMenu } from '@/components/status-filter-menu'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { formatAbsoluteDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import {
  NEWSLETTER_CATEGORY_LABELS,
  NEWSLETTER_STATUS_LABELS,
  nextNewsletterStatus,
  type NewsletterAction,
  type NewsletterCategory,
  type NewsletterStatus
} from '@/lib/newsletters/status'
import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  MailX,
  Newspaper,
  Rss,
  Search,
  Trash2
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  discoverNewslettersAction,
  recordSignupOpenedAction,
  updateNewsletterStatusAction
} from './actions'

type NewsletterRow = {
  id: string
  name: string
  publisher: string
  description: string
  category: NewsletterCategory
  topics: string[]
  relevanceScore: number
  relevanceReason: string | null
  websiteUrl: string
  signupUrl: string
  feedUrl: string | null
  status: NewsletterStatus
  discoveredAt: Date | string
}

type Filter = 'all' | 'discovered' | 'subscribed' | 'other'

type FilterOption = {
  value: Filter
  label: string
  statuses: NewsletterStatus[] | null
}

const FILTERS: FilterOption[] = [
  { value: 'all', label: 'All statuses', statuses: null },
  // Saved ones are not subscribed to yet either, so they count as new.
  { value: 'discovered', label: 'New', statuses: ['discovered', 'saved'] },
  {
    value: 'subscribed',
    label: 'Subscribed',
    statuses: ['pending_confirmation', 'subscribed', 'active']
  },
  {
    value: 'other',
    label: 'Unsubscribed / failed',
    statuses: ['unsubscribed', 'failed']
  }
]

const FILTER_VALUES = FILTERS.map(f => f.value)
const filterLabel = (value: Filter) =>
  FILTERS.find(f => f.value === value)!.label

const STATUS_TONE: Record<NewsletterStatus, string> = {
  discovered: 'bg-surface-hover text-muted',
  saved: 'bg-accent/10 text-accent',
  pending_confirmation: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  subscribed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  unsubscribed: 'bg-surface-hover text-muted',
  failed: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  removed: 'bg-surface-hover text-muted'
}

/** The newsletters a filter shows: those in its statuses, or all of them. */
function inFilter(newsletters: NewsletterRow[], { statuses }: FilterOption) {
  return statuses
    ? newsletters.filter(n => statuses.includes(n.status))
    : newsletters
}

function scoreTone(score: number): string {
  if (score >= 80)
    return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (score >= 60) return 'bg-accent/10 text-accent'
  return 'bg-surface-hover text-muted'
}

/** Only http(s) links are rendered; anything else in the row is not a link. */
function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined
}

function displayUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path =
      parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')
    return `${parsed.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}

export function NewslettersClient({
  initialNewsletters,
  missingKeys
}: {
  initialNewsletters: NewsletterRow[]
  /** Settings discovery needs that are not set; empty when it can run. */
  missingKeys: string[]
}) {
  // A new list from the server (after discovery or a status change) replaces
  // the local one, which only runs ahead of it between the two.
  const [newsletters, setNewsletters] = useState(initialNewsletters)
  const [prevInitial, setPrevInitial] = useState(initialNewsletters)
  if (prevInitial !== initialNewsletters) {
    setPrevInitial(initialNewsletters)
    setNewsletters(initialNewsletters)
  }

  const [filter, setFilter] = useState<Filter>('all')
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Newsletters whose signup page was opened here, so the card asks how it went.
  const [openedIds, setOpenedIds] = useState<string[]>([])

  const canDiscover = missingKeys.length === 0

  const handleDiscover = async () => {
    setIsDiscovering(true)
    setDiscoverError(null)
    try {
      const result = await discoverNewslettersAction()
      if (!result.success) {
        setDiscoverError(result.error)
        return
      }
      const { found, added } = result.summary
      showToast(
        found === 0
          ? {
              type: 'info',
              title: 'No new newsletters',
              message:
                'Nothing found this time fit your profile well enough. Try again later, or add more detail to your identity.'
            }
          : {
              type: 'success',
              title: `Found ${found} newsletter${found === 1 ? '' : 's'}`,
              message:
                added > 0
                  ? `${added} new to your list.`
                  : 'All were already on your list; their details are refreshed.'
            }
      )
    } catch {
      setDiscoverError('Discovery could not finish. Please try again.')
    } finally {
      setIsDiscovering(false)
    }
  }

  const handleAction = async (id: string, action: NewsletterAction) => {
    setPendingId(id)
    try {
      const result = await updateNewsletterStatusAction(id, action)
      if (!result.success) {
        showToast({
          type: 'error',
          title: 'Not updated',
          message: result.error
        })
        return
      }
      setNewsletters(prev =>
        result.status === 'removed'
          ? // The page does not list removed ones; drop it here as well.
            prev.filter(n => n.id !== id)
          : prev.map(n => (n.id === id ? { ...n, status: result.status } : n))
      )
      setOpenedIds(prev => prev.filter(openedId => openedId !== id))
    } catch {
      showToast({
        type: 'error',
        title: 'Not updated',
        message: 'Please try again.'
      })
    } finally {
      setPendingId(null)
    }
  }

  // The link itself opens the page; this only notes it and asks how it went.
  const handleOpenedSignup = (id: string) => {
    setOpenedIds(prev => (prev.includes(id) ? prev : [...prev, id]))
    void recordSignupOpenedAction(id).catch(() => {})
  }

  const counts = Object.fromEntries(
    FILTERS.map(f => [f.value, inFilter(newsletters, f).length])
  ) as Record<Filter, number>
  const shown = inFilter(
    newsletters,
    FILTERS.find(f => f.value === filter)!
  )

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Discover Newsletters"
        description="Newsletters that fit your profile. You subscribe on each publisher's own page."
        actions={
          <Button
            size="sm"
            onClick={handleDiscover}
            loading={isDiscovering}
            disabled={!canDiscover}
          >
            {!isDiscovering && <Search className="h-3.5 w-3.5" />}
            {isDiscovering ? 'Discovering…' : 'Discover Newsletters'}
          </Button>
        }
        bottomContent={
          newsletters.length > 0 ? (
            <StatusFilterMenu
              value={filter}
              options={FILTER_VALUES}
              label={filterLabel}
              counts={counts}
              onChange={setFilter}
            />
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-4">
        {/* A container, so the two-column grid follows the room left beside
            the sidebar (open or collapsed), not the width of the screen. */}
        <div className="@container space-y-4">
          {!canDiscover && (
            <FormAlert variant="info">
              Discovery needs {missingKeys.join(' and ')} to be set on the
              server.
            </FormAlert>
          )}

          {isDiscovering && (
            <FormAlert variant="info">
              <span className="font-medium">Discovering newsletters…</span>{' '}
              Searching the web from your profile, reading publisher pages to
              find their signup forms, then scoring each against your business.
              This usually takes about a minute.
            </FormAlert>
          )}

          {discoverError && !isDiscovering && (
            <FormAlert>
              <p>{discoverError}</p>
              {canDiscover && (
                <button
                  type="button"
                  onClick={handleDiscover}
                  className="mt-1 font-medium underline underline-offset-2"
                >
                  Try again
                </button>
              )}
            </FormAlert>
          )}

          {newsletters.length === 0 ? (
            !isDiscovering && (
              <div className="border-border bg-surface rounded-xl border border-dashed px-6 py-12 text-center">
                <div className="bg-accent/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
                  <Newspaper className="text-accent h-6 w-6" />
                </div>
                <p className="text-foreground text-sm font-medium">
                  No newsletters yet
                </p>
                <p className="text-muted mx-auto mt-1 max-w-md text-xs leading-relaxed">
                  Discovery uses your identity (industry, offerings and
                  audience) to find industry, niche, business and technology
                  newsletters, with a link to each one&apos;s signup page.
                </p>
                <Button
                  size="sm"
                  className="mt-5"
                  onClick={handleDiscover}
                  disabled={!canDiscover}
                >
                  <Search className="h-3.5 w-3.5" />
                  Discover Newsletters
                </Button>
              </div>
            )
          ) : shown.length === 0 ? (
            <div className="border-border bg-surface rounded-xl border border-dashed py-10 text-center">
              <p className="text-muted text-sm">
                No newsletters with this status.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
              {shown.map(n => (
                <NewsletterCard
                  key={n.id}
                  newsletter={n}
                  busy={pendingId === n.id}
                  askHowItWent={openedIds.includes(n.id)}
                  onAction={action => handleAction(n.id, action)}
                  onOpenedSignup={() => handleOpenedSignup(n.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function NewsletterCard({
  newsletter: n,
  busy,
  askHowItWent,
  onAction,
  onOpenedSignup
}: {
  newsletter: NewsletterRow
  busy: boolean
  askHowItWent: boolean
  onAction: (action: NewsletterAction) => void
  onOpenedSignup: () => void
}) {
  const mounted = useHasMounted()
  /** A button for `action`, only where it applies to the current status. */
  const actionButton = (
    action: NewsletterAction,
    label: ReactNode,
    title?: string
  ) =>
    nextNewsletterStatus(n.status, action) !== null && (
      <Button
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => onAction(action)}
        title={title}
      >
        {label}
      </Button>
    )
  const signupHref = safeHref(n.signupUrl)
  const websiteHref = safeHref(n.websiteUrl)

  return (
    <article className="border-border bg-surface @container flex h-full flex-col gap-3 rounded-xl border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="bg-accent/10 text-accent rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase">
              {NEWSLETTER_CATEGORY_LABELS[n.category]}
            </span>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
                STATUS_TONE[n.status]
              )}
            >
              {NEWSLETTER_STATUS_LABELS[n.status]}
            </span>
          </div>
          <h3 className="text-foreground text-base font-semibold">{n.name}</h3>
          <p className="text-muted text-xs">by {n.publisher}</p>
        </div>
        <div
          className={cn(
            'flex shrink-0 flex-col items-center rounded-lg px-3 py-1.5',
            scoreTone(n.relevanceScore)
          )}
          title="How well it fits your profile, out of 100"
        >
          <span className="text-lg leading-none font-bold tabular-nums">
            {n.relevanceScore}
          </span>
          <span className="mt-0.5 text-[10px] font-medium uppercase">
            Relevance
          </span>
        </div>
      </div>

      <p className="text-foreground text-sm leading-relaxed">{n.description}</p>

      {n.relevanceReason && (
        <p className="text-muted text-xs leading-relaxed">
          <span className="font-medium">Why it fits:</span> {n.relevanceReason}
        </p>
      )}

      {n.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {n.topics.map(topic => (
            <span
              key={topic}
              className="bg-surface-hover text-muted rounded-md px-2 py-0.5 text-[11px]"
            >
              {topic}
            </span>
          ))}
        </div>
      )}

      <dl className="text-muted grid gap-x-6 gap-y-1 text-xs @md:grid-cols-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="sr-only">Website</dt>
          <Globe aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <dd className="min-w-0 truncate">
            {websiteHref ? (
              <a
                href={websiteHref}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                {displayUrl(n.websiteUrl)}
              </a>
            ) : (
              displayUrl(n.websiteUrl)
            )}
          </dd>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <dt className="sr-only">Signup page</dt>
          <Mail aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <dd className="min-w-0 truncate" title={n.signupUrl}>
            {displayUrl(n.signupUrl)}
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Discovered</dt>
          <Search aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <dd>
            Discovered {mounted ? formatAbsoluteDate(n.discoveredAt) : ''}
          </dd>
        </div>
        {n.feedUrl && (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Feed</dt>
            <Rss aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <dd>Feed available</dd>
          </div>
        )}
      </dl>

      {/* At the bottom, so the buttons of cards side by side line up. */}
      <div className="border-border mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
        {signupHref && (
          <a
            href={signupHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpenedSignup}
            className={buttonClassName({ size: 'sm' })}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Signup Page
          </a>
        )}
        {actionButton(
          'save',
          <>
            <Bookmark className="h-3.5 w-3.5" />
            Save
          </>
        )}
        {actionButton(
          'unsave',
          <>
            <BookmarkCheck className="text-accent h-3.5 w-3.5" />
            Saved
          </>,
          'Remove from saved'
        )}
        {actionButton(
          'mark_subscribed',
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark as Subscribed
          </>
        )}
        {actionButton(
          'mark_unsubscribed',
          <>
            <MailX className="h-3.5 w-3.5" />
            Mark as Unsubscribed
          </>
        )}
        {busy && (
          <Loader2
            aria-label="Updating"
            className="text-muted h-4 w-4 animate-spin"
          />
        )}
        <div className="ml-auto">
          <ConfirmPopover
            title="Remove this newsletter?"
            description="It is taken off your list, and discovering again will not add it back."
            confirmLabel="Remove"
            align="end"
            onConfirm={() => onAction('remove')}
            disabled={busy}
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              className="hover:text-rose-600 dark:hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          </ConfirmPopover>
        </div>
      </div>

      {askHowItWent && (
        <div className="border-accent/20 bg-accent/5 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs">
          <span className="text-foreground mr-1 font-medium">
            Finished on their page? Tell us how it went:
          </span>
          {actionButton('mark_subscribed', "I'm subscribed")}
          {actionButton('mark_pending', 'Waiting for confirmation email')}
          {actionButton('mark_failed', "Couldn't sign up")}
        </div>
      )}
    </article>
  )
}
