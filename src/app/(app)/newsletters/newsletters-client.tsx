'use client'

import { Button, buttonClassName } from '@/components/button'
import { FormAlert } from '@/components/form-alert'
import { PageHeader } from '@/components/page-header'
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
  Search
} from 'lucide-react'
import { useState } from 'react'
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

type Filter = 'all' | 'discovered' | 'saved' | 'subscribed' | 'other'

const FILTERS: Array<{
  value: Filter
  label: string
  statuses: NewsletterStatus[] | null
}> = [
  { value: 'all', label: 'All', statuses: null },
  { value: 'discovered', label: 'New', statuses: ['discovered'] },
  { value: 'saved', label: 'Saved', statuses: ['saved'] },
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

const STATUS_TONE: Record<NewsletterStatus, string> = {
  discovered: 'bg-surface-hover text-muted',
  saved: 'bg-accent/10 text-accent',
  pending_confirmation: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  subscribed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  unsubscribed: 'bg-surface-hover text-muted',
  failed: 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
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
        prev.map(n => (n.id === id ? { ...n, status: result.status } : n))
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
    FILTERS.map(f => [
      f.value,
      f.statuses
        ? newsletters.filter(n => f.statuses!.includes(n.status)).length
        : newsletters.length
    ])
  ) as Record<Filter, number>
  const activeFilter = FILTERS.find(f => f.value === filter)!
  const shown = activeFilter.statuses
    ? newsletters.filter(n => activeFilter.statuses!.includes(n.status))
    : newsletters

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Newsletters"
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
            <div
              className="flex items-center gap-1.5"
              role="group"
              aria-label="Filter by status"
            >
              {FILTERS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={filter === f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors',
                    filter === f.value
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted hover:bg-surface-hover hover:text-foreground'
                  )}
                >
                  {f.label}
                  <span className="tabular-nums opacity-70">
                    {counts[f.value]}
                  </span>
                </button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl space-y-4 pb-16">
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
            shown.map(n => (
              <NewsletterCard
                key={n.id}
                newsletter={n}
                busy={pendingId === n.id}
                askHowItWent={openedIds.includes(n.id)}
                onAction={action => handleAction(n.id, action)}
                onOpenedSignup={() => handleOpenedSignup(n.id)}
              />
            ))
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
  const can = (action: NewsletterAction) =>
    nextNewsletterStatus(n.status, action) !== null
  const signupHref = safeHref(n.signupUrl)
  const websiteHref = safeHref(n.websiteUrl)

  return (
    <article className="border-border bg-surface space-y-3 rounded-xl border p-5">
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

      <dl className="text-muted grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
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

      <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
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
        {can('save') && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('save')}
          >
            <Bookmark className="h-3.5 w-3.5" />
            Save
          </Button>
        )}
        {can('unsave') && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('unsave')}
            title="Remove from saved"
          >
            <BookmarkCheck className="text-accent h-3.5 w-3.5" />
            Saved
          </Button>
        )}
        {can('mark_subscribed') && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('mark_subscribed')}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Mark as Subscribed
          </Button>
        )}
        {can('mark_unsubscribed') && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('mark_unsubscribed')}
          >
            <MailX className="h-3.5 w-3.5" />
            Mark as Unsubscribed
          </Button>
        )}
        {busy && (
          <Loader2
            aria-label="Updating"
            className="text-muted h-4 w-4 animate-spin"
          />
        )}
      </div>

      {askHowItWent && (
        <div className="border-accent/20 bg-accent/5 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs">
          <span className="text-foreground mr-1 font-medium">
            Finished on their page? Tell us how it went:
          </span>
          {can('mark_subscribed') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAction('mark_subscribed')}
            >
              I&apos;m subscribed
            </Button>
          )}
          {can('mark_pending') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAction('mark_pending')}
            >
              Waiting for confirmation email
            </Button>
          )}
          {can('mark_failed') && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAction('mark_failed')}
            >
              Couldn&apos;t sign up
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
