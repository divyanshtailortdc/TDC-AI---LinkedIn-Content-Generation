'use client'

import { Button, buttonClassName } from '@/components/button'
import { ConfirmPopover } from '@/components/confirm-popover'
import { FormAlert } from '@/components/form-alert'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { showToast } from '@/components/toast-notification'
import { EmptyState } from '@/components/ui/empty-state'
import { FIELD_CLASS, Select } from '@/components/ui/field'
import { FilterChips } from '@/components/ui/filter-chips'
import { ProgressBar } from '@/components/ui/meter'
import { StatTile } from '@/components/ui/stat-tile'
import { StatusChip } from '@/components/ui/status-chip'
import { FOCUS_RING, TONES, type Tone } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { INBOX_PATH } from '@/lib/inbox-path'
import {
  NEWSLETTER_CATEGORIES,
  NEWSLETTER_CATEGORY_LABELS,
  NEWSLETTER_STATUS_LABELS,
  nextNewsletterStatus,
  type NewsletterAction,
  type NewsletterCategory,
  type NewsletterStatus
} from '@/lib/newsletters/status'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import {
  Bookmark,
  BookmarkX,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gauge,
  Globe,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  MailX,
  MoreVertical,
  Newspaper,
  Rss,
  Search,
  SearchX,
  Sparkles,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { isTestDomain } from '~/lib/mail/test-domain'
import {
  discoverNewslettersAction,
  recordSignupOpenedAction,
  updateNewsletterStatusAction
} from './actions'
import { InfoTip } from '@/components/ui/info-tip'

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
  { value: 'all', label: 'All', statuses: null },
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

type CategoryFilter = 'all' | NewsletterCategory
type Sort = 'relevance' | 'newest'

/** A newsletter's status as a chip, in the app's shared tones (tone.ts). */
const STATUS_TONE: Record<NewsletterStatus, Tone> = {
  discovered: 'neutral',
  saved: 'info',
  pending_confirmation: 'warning',
  subscribed: 'success',
  active: 'success',
  unsubscribed: 'neutral',
  failed: 'danger',
  removed: 'neutral'
}

/** From this relevance score up, a newsletter is a strong fit. */
const STRONG_FIT = 80

/** Topics shown on a card; the rest are counted ("+3"). */
const SHOWN_TOPICS = 2

/** What the ⋮ menu offers, where the status allows it (nextNewsletterStatus). */
const MENU_ACTIONS: {
  action: NewsletterAction
  label: string
  icon: LucideIcon
}[] = [
  { action: 'save', label: 'Save for later', icon: Bookmark },
  { action: 'unsave', label: 'Remove from saved', icon: BookmarkX },
  {
    action: 'mark_subscribed',
    label: 'Mark as subscribed',
    icon: CheckCircle2
  },
  { action: 'mark_unsubscribed', label: 'Mark as unsubscribed', icon: MailX }
]

/** What the user can say after opening a signup page here. */
const FOLLOW_UPS: { action: NewsletterAction; label: string }[] = [
  { action: 'mark_subscribed', label: "I'm subscribed" },
  { action: 'mark_pending', label: 'Awaiting email' },
  { action: 'mark_failed', label: "Couldn't sign up" }
]

const ADDRESS_HELP =
  'Newsletters sent to this address arrive in your Inbox, where their stories are read for your ideas.'
const TEST_ADDRESS_HELP =
  'A test address: newsletter sites refuse it and cannot send to it.'

const GHOST_ICON = cn(
  'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  FOCUS_RING
)

/** The newsletters a filter shows: those in its statuses, or all of them. */
function inFilter(newsletters: NewsletterRow[], { statuses }: FilterOption) {
  return statuses
    ? newsletters.filter(n => statuses.includes(n.status))
    : newsletters
}

function matchesSearch(n: NewsletterRow, term: string) {
  return (
    n.name.toLowerCase().includes(term) ||
    n.publisher.toLowerCase().includes(term) ||
    n.topics.some(topic => topic.toLowerCase().includes(term))
  )
}

const discoveredTime = (n: NewsletterRow) => new Date(n.discoveredAt).getTime()

/** Best fit first (as the page loads them), or the latest found first. */
function sortNewsletters(newsletters: NewsletterRow[], sort: Sort) {
  return [...newsletters].sort((a, b) =>
    sort === 'newest'
      ? discoveredTime(b) - discoveredTime(a) ||
        b.relevanceScore - a.relevanceScore
      : b.relevanceScore - a.relevanceScore ||
        discoveredTime(b) - discoveredTime(a)
  )
}

function fitTone(score: number): Tone {
  if (score >= STRONG_FIT) return 'success'
  if (score >= 60) return 'info'
  return 'neutral'
}

/** Only http(s) links are rendered; anything else in the row is not a link. */
function safeHref(url: string | null): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

export function NewslettersClient({
  initialNewsletters,
  missingKeys,
  inbox
}: {
  initialNewsletters: NewsletterRow[]
  /** Settings discovery needs that are not set; empty when it can run. */
  missingKeys: string[]
  /** The identity's inbox address (null until chosen); null without an inbox. */
  inbox: { address: string | null } | null
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
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [sort, setSort] = useState<Sort>('relevance')
  // A page of the filtered list; any change to the filters starts again at
  // its first page.
  const [page, setPage] = useState(1)
  const changeFilter = (value: Filter) => {
    setFilter(value)
    setPage(1)
  }
  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }
  const changeCategory = (value: CategoryFilter) => {
    setCategory(value)
    setPage(1)
  }
  const changeSort = (value: Sort) => {
    setSort(value)
    setPage(1)
  }
  const clearFilters = () => {
    setFilter('all')
    setSearch('')
    setCategory('all')
    setPage(1)
  }

  // When the running discovery started; null while none runs.
  const [discoveryStartedAt, setDiscoveryStartedAt] = useState<number | null>(
    null
  )
  const isDiscovering = discoveryStartedAt !== null
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  // Newsletters whose signup page was opened here, so the card asks how it went.
  const [openedIds, setOpenedIds] = useState<string[]>([])

  const canDiscover = missingKeys.length === 0

  const handleDiscover = async () => {
    setDiscoveryStartedAt(Date.now())
    setDiscoverError(null)
    try {
      const result = await discoverNewslettersAction()
      if (!result.success) {
        setDiscoverError(result.error)
        return
      }
      const { found, added } = result.summary
      // Back to the first page: the best fits, where the newly found ones rank
      // among them (or the newest, which they are).
      setPage(1)
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
      setDiscoveryStartedAt(null)
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

  // The tiles count the whole list. The status chips carry no counts, so
  // each number is shown in one place only.
  const statusCount = (...statuses: NewsletterStatus[]) =>
    newsletters.filter(n => statuses.includes(n.status)).length
  const total = newsletters.length
  const newCount = statusCount('discovered', 'saved')
  const savedCount = statusCount('saved')
  const subscribedCount = statusCount(
    'pending_confirmation',
    'subscribed',
    'active'
  )
  const awaitingCount = statusCount('pending_confirmation')
  const strongCount = newsletters.filter(
    n => n.relevanceScore >= STRONG_FIT
  ).length
  const averageScore = total
    ? Math.round(
        newsletters.reduce((sum, n) => sum + n.relevanceScore, 0) / total
      )
    : 0
  const categoryCounts = NEWSLETTER_CATEGORIES.map(value => ({
    value,
    count: newsletters.filter(n => n.category === value).length
  }))

  const term = search.trim().toLowerCase()
  const shown = sortNewsletters(
    inFilter(
      newsletters.filter(
        n =>
          (category === 'all' || n.category === category) &&
          (!term || matchesSearch(n, term))
      ),
      FILTERS.find(f => f.value === filter)!
    ),
    sort
  )
  const { rows: pageNewsletters, pageInfo } = paginate(shown, page, PAGE_SIZE)
  const narrowed = filter !== 'all' || term !== '' || category !== 'all'

  const discoverButton = (
    <Button
      size="sm"
      onClick={handleDiscover}
      loading={isDiscovering}
      disabled={!canDiscover}
      className={FOCUS_RING}
    >
      {!isDiscovering && <Search aria-hidden className="h-3.5 w-3.5" />}
      {isDiscovering ? 'Discovering…' : 'Discover Newsletters'}
    </Button>
  )

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Discover Newsletters"
        description="Newsletters that fit your profile."
        // With an empty list the empty state carries this button, so the
        // page has one main action either way.
        actions={total > 0 || isDiscovering ? discoverButton : undefined}
        bottomContent={
          total > 0 ? (
            // Padded so focus rings are not cut off by the strip's sideways
            // scroll.
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-0.5">
              <FilterChips
                label="Show newsletters by status"
                value={filter}
                onChange={changeFilter}
                options={FILTERS.map(f => ({ value: f.value, label: f.label }))}
              />
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <div className="relative min-w-0 flex-[1_1_12rem] sm:w-56 sm:flex-none">
                  <Search
                    aria-hidden
                    className="text-muted pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={e => changeSearch(e.target.value)}
                    placeholder="Search"
                    aria-label="Search name, publisher or topic"
                    className={cn(FIELD_CLASS, 'bg-surface-hover h-9 py-1.5 pr-3 pl-8.5')}
                  />
                </div>
                <SelectField
                  label="Category"
                  value={category}
                  onChange={value => changeCategory(value as CategoryFilter)}
                >
                  <option value="all">All</option>
                  {categoryCounts
                    .filter(c => c.count > 0 || c.value === category)
                    .map(c => (
                      <option key={c.value} value={c.value}>
                        {NEWSLETTER_CATEGORY_LABELS[c.value]}
                      </option>
                    ))}
                </SelectField>
                <SelectField
                  label="Sort"
                  value={sort}
                  onChange={value => changeSort(value as Sort)}
                >
                  <option value="relevance">Best fit</option>
                  <option value="newest">Newest</option>
                </SelectField>
              </div>
            </div>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* A container, so the grids follow the room left beside the sidebar
            (open or collapsed), not the width of the screen. */}
        <div className="@container mx-auto max-w-7xl space-y-6">
          {!canDiscover && (
            <FormAlert variant="info">
              Discovery needs {missingKeys.join(' and ')}.
            </FormAlert>
          )}

          {discoveryStartedAt !== null && (
            <DiscoveryProgress startedAt={discoveryStartedAt} />
          )}

          {discoverError && !isDiscovering && (
            <FormAlert>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0">{discoverError}</span>
                {canDiscover && (
                  <button
                    type="button"
                    onClick={handleDiscover}
                    className={cn(
                      'cursor-pointer rounded-sm font-medium underline underline-offset-2',
                      FOCUS_RING
                    )}
                  >
                    Try again
                  </button>
                )}
              </span>
            </FormAlert>
          )}

          {total === 0 ? (
            !isDiscovering && (
              <EmptyState
                icon={Newspaper}
                tone="brand"
                title="No newsletters yet"
                description="Find newsletters that fit your profile."
                action={discoverButton}
              />
            )
          ) : (
            <>
              <section
                aria-label="Overview"
                className="grid grid-cols-2 gap-3 sm:gap-4 @4xl:grid-cols-4"
              >
                <StatTile label="Found" value={total} icon={Newspaper} />
                <StatTile
                  label="New"
                  value={newCount}
                  icon={Sparkles}
                  hint={savedCount > 0 ? `${savedCount} saved` : undefined}
                />
                <StatTile
                  label="Subscribed"
                  value={subscribedCount}
                  icon={MailCheck}
                  tone="success"
                  hint={
                    awaitingCount > 0 ? (
                      <span className={TONES.warning.text}>
                        {awaitingCount} to confirm
                      </span>
                    ) : undefined
                  }
                />
                <StatTile
                  label="Avg. relevance"
                  value={averageScore}
                  icon={Gauge}
                  tone={fitTone(averageScore)}
                  hint={`${strongCount} strong`}
                >
                  <ProgressBar
                    value={averageScore}
                    tone={fitTone(averageScore)}
                    label="Average relevance"
                    size="xs"
                  />
                </StatTile>
              </section>

              {inbox && <SignupAddress address={inbox.address} />}

              {shown.length === 0 ? (
                <EmptyState
                  compact
                  icon={SearchX}
                  title="No matches"
                  action={
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={clearFilters}
                      className={FOCUS_RING}
                    >
                      <X aria-hidden className="h-3.5 w-3.5" />
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <section aria-labelledby="newsletter-list-heading">
                  <h2
                    id="newsletter-list-heading"
                    className="text-foreground mb-3 flex items-baseline gap-2 text-sm font-semibold"
                  >
                    Newsletters
                    <span className="text-muted text-xs font-normal tabular-nums">
                      {narrowed ? `${shown.length} of ${total}` : total}
                    </span>
                  </h2>
                  <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
                    {pageNewsletters.map(n => (
                      <NewsletterCard
                        key={n.id}
                        newsletter={n}
                        busy={pendingId === n.id}
                        askHowItWent={openedIds.includes(n.id)}
                        onAction={action => handleAction(n.id, action)}
                        onOpenedSignup={() => handleOpenedSignup(n.id)}
                        onDismissAsk={() =>
                          setOpenedIds(prev => prev.filter(id => id !== n.id))
                        }
                      />
                    ))}
                  </div>
                  <div className="mt-4">
                    <Pagination
                      {...pageInfo}
                      noun="newsletters"
                      onPageChange={setPage}
                    />
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A labelled native select, styled like the search box beside it. */
function SelectField({
  label,
  value,
  onChange,
  children
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <label className="border-border bg-surface text-muted focus-within:ring-brand/15 focus-within:border-brand relative flex h-9 min-w-0 items-center gap-1.5 rounded-lg border pl-3 text-[13px] transition-[border-color,box-shadow] focus-within:ring-3">
      <span className="shrink-0">{label}</span>
      {/* A long choice ends in an ellipsis, with the whole of it on hover. */}
      <Select
        value={value}
        onChange={e => onChange(e.target.value)}
        wrapperClassName="flex-1 self-stretch"
        className="text-foreground bg-surface h-full rounded-lg border-0 py-0 pr-8 pl-0 text-[13px] leading-normal font-medium shadow-none focus:ring-0"
      >
        {children}
      </Select>
    </label>
  )
}

/**
 * While discovery runs (a minute or so): one slim bar and the time so far.
 * Nothing reports which step it is on, so none is shown.
 */
function DiscoveryProgress({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000))
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div
      className={cn(
        'bg-surface rounded-2xl border px-4 py-3 shadow-xs sm:px-5',
        TONES.brand.border
      )}
    >
      <div className="flex items-center gap-2 text-[13px]">
        <p role="status" className="min-w-0">
          <span className="text-foreground font-medium">Discovering…</span>{' '}
          <span className="text-muted">about a minute</span>
        </p>
        <span
          aria-hidden
          className="text-muted ml-auto shrink-0 text-xs tabular-nums"
        >
          {elapsed}
        </span>
      </div>
      <ProgressBar
        indeterminate
        size="xs"
        label="Discovering"
        className="mt-2.5"
      />
    </div>
  )
}

/** The inbox address to sign up with, so issues arrive where they are read. */
function SignupAddress({ address }: { address: string | null }) {
  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      showToast({ type: 'success', title: 'Address copied', message: address })
    } catch {
      showToast({ type: 'error', title: 'Could not copy the address' })
    }
  }
  const testDomain =
    address !== null && isTestDomain(address.slice(address.indexOf('@') + 1))

  return (
    <section
      aria-label="Signup address"
      className="border-border bg-surface flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-3 shadow-xs sm:px-5"
    >
      <Mail aria-hidden className="text-brand-strong h-4 w-4 shrink-0" />
      <p className="flex min-w-0 flex-[1_1_14rem] flex-wrap items-center gap-x-1.5 text-[13px]">
        {address ? (
          <>
            <span className="text-muted">Sign up with</span>
            <code className="text-foreground font-semibold break-all">
              {address}
            </code>
          </>
        ) : (
          <span className="text-foreground">Choose your signup address</span>
        )}
        <InfoTip label="About this address">{ADDRESS_HELP}</InfoTip>
      </p>
      {testDomain && (
        <StatusChip tone="warning" title={TEST_ADDRESS_HELP}>
          Test address
        </StatusChip>
      )}
      <div className="flex items-center gap-1">
        {address && (
          <button
            type="button"
            onClick={copyAddress}
            aria-label="Copy address"
            title="Copy address"
            className={GHOST_ICON}
          >
            <Copy aria-hidden className="h-4 w-4" />
          </button>
        )}
        <Link
          href={INBOX_PATH}
          className={buttonClassName({
            variant: 'secondary',
            size: 'sm',
            className: FOCUS_RING
          })}
        >
          <Inbox aria-hidden className="h-3.5 w-3.5" />
          Open Inbox
        </Link>
      </div>
    </section>
  )
}

/** How well it fits the profile: a bar and its number, out of 100. */
function RelevanceMeter({ score }: { score: number }) {
  const tone = fitTone(score)
  return (
    <div
      title="How well it fits your profile, out of 100"
      className="flex items-center gap-3"
    >
      <span className="text-muted shrink-0 text-xs">Relevance</span>
      <ProgressBar
        value={score}
        tone={tone}
        label="Relevance"
        className="flex-1"
      />
      <span className="text-foreground w-7 shrink-0 text-right text-[13px] font-semibold tabular-nums">
        {score}
      </span>
    </div>
  )
}

/**
 * The card's other actions, behind ⋮: a disclosure (a button and the list
 * it opens), closed by Escape, a click elsewhere or picking one.
 */
function MoreMenu({
  label,
  items,
  disabled
}: {
  label: string
  items: {
    key: string
    label: string
    icon: LucideIcon
    onSelect: () => void
  }[]
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (items.length === 0) return null
  return (
    <div ref={wrapper} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title="More actions"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
        className={GHOST_ICON}
      >
        <MoreVertical aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        // Opens upward: the card's content above always has room for it.
        <ul
          id={panelId}
          className="border-border bg-surface absolute right-0 bottom-full z-20 mb-1.5 w-56 rounded-xl border p-1 shadow-lg"
        >
          {items.map(item => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={cn(
                  'text-foreground hover:bg-surface-hover flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px]',
                  FOCUS_RING
                )}
              >
                <item.icon aria-hidden className="text-muted h-4 w-4" />
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** A small icon link that opens a page in a new tab. */
function IconLink({
  href,
  label,
  icon: Icon,
  onClick
}: {
  href: string
  label: string
  icon: LucideIcon
  onClick?: () => void
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={GHOST_ICON}
    >
      <Icon aria-hidden className="h-4 w-4" />
    </a>
  )
}

function NewsletterCard({
  newsletter: n,
  busy,
  askHowItWent,
  onAction,
  onOpenedSignup,
  onDismissAsk
}: {
  newsletter: NewsletterRow
  busy: boolean
  askHowItWent: boolean
  onAction: (action: NewsletterAction) => void
  onOpenedSignup: () => void
  onDismissAsk: () => void
}) {
  const nameId = useId()
  const followUpId = useId()
  const allows = (action: NewsletterAction) =>
    nextNewsletterStatus(n.status, action) !== null
  const signupHref = safeHref(n.signupUrl)
  const websiteHref = safeHref(n.websiteUrl)
  const feedHref = safeHref(n.feedUrl)
  const subscribed = n.status === 'subscribed' || n.status === 'active'
  const pending = n.status === 'pending_confirmation'
  // One thing to do next: sign up, or confirm the email that signing up
  // sent. A subscribed one has nothing left but the ⋮ menu.
  const signupIsPrimary = !subscribed && !pending && Boolean(signupHref)
  const followUps = FOLLOW_UPS.filter(f => allows(f.action))
  const menuItems = MENU_ACTIONS.filter(m => allows(m.action)).map(m => ({
    key: m.action,
    label: m.label,
    icon: m.icon,
    onSelect: () => onAction(m.action)
  }))
  // The full description and the reason it fits, on hover of the one line
  // the card shows.
  const fitLine = n.relevanceReason ?? n.description
  const fitTitle = n.relevanceReason
    ? `${n.description}\n\nWhy it fits: ${n.relevanceReason}`
    : n.description
  const shownTopics = n.topics.slice(0, SHOWN_TOPICS)
  const moreTopics = n.topics.slice(SHOWN_TOPICS)

  return (
    <article
      aria-labelledby={nameId}
      className="border-border bg-surface flex h-full flex-col rounded-2xl border shadow-xs"
    >
      <div className="flex flex-1 flex-col gap-3.5 p-4 sm:p-5">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3
              id={nameId}
              className="text-foreground text-[15px] leading-snug font-semibold wrap-break-word"
            >
              {n.name}
            </h3>
            <p className="text-muted mt-0.5 truncate text-xs">
              {n.publisher} · {NEWSLETTER_CATEGORY_LABELS[n.category]}
            </p>
          </div>
          <StatusChip tone={STATUS_TONE[n.status]}>
            {NEWSLETTER_STATUS_LABELS[n.status]}
          </StatusChip>
        </header>

        <RelevanceMeter score={n.relevanceScore} />

        {fitLine && (
          <p title={fitTitle} className="text-muted line-clamp-1 text-[13px]">
            {fitLine}
          </p>
        )}

        {n.topics.length > 0 && (
          <ul aria-label="Topics" className="mt-auto flex flex-wrap gap-1.5">
            {shownTopics.map(topic => (
              <li
                key={topic}
                className="border-border bg-surface-hover text-foreground/80 max-w-full truncate rounded-full border px-2.5 py-0.5 text-xs"
              >
                {topic}
              </li>
            ))}
            {moreTopics.length > 0 && (
              <li
                title={moreTopics.join(', ')}
                className="text-muted px-1 py-0.5 text-xs tabular-nums"
              >
                +{moreTopics.length}
              </li>
            )}
          </ul>
        )}
      </div>

      {/* At the bottom, so the buttons of cards side by side line up. */}
      <footer className="border-border flex items-center gap-2 border-t px-4 py-2.5 sm:px-5">
        {signupIsPrimary && signupHref && (
          <a
            href={signupHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpenedSignup}
            className={buttonClassName({
              variant: 'secondary',
              size: 'sm',
              className: FOCUS_RING
            })}
          >
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            Open signup page
          </a>
        )}
        {pending && (
          <Link
            href={INBOX_PATH}
            title="Open the publisher's confirmation email and click its link."
            className={buttonClassName({
              variant: 'secondary',
              size: 'sm',
              className: FOCUS_RING
            })}
          >
            <Inbox aria-hidden className="h-3.5 w-3.5" />
            Confirm in Inbox
          </Link>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          {busy && (
            <Loader2
              aria-label="Updating"
              className="text-muted mr-1 h-4 w-4 animate-spin motion-reduce:animate-none"
            />
          )}
          {websiteHref && (
            <IconLink href={websiteHref} label="Website" icon={Globe} />
          )}
          {/* The signup page is the main button until signing up is done. */}
          {!signupIsPrimary && signupHref && (
            <IconLink
              href={signupHref}
              label="Signup page"
              icon={Mail}
              onClick={onOpenedSignup}
            />
          )}
          {feedHref && <IconLink href={feedHref} label="Feed" icon={Rss} />}
          <MoreMenu
            label={`More for ${n.name}`}
            items={menuItems}
            disabled={busy}
          />
          <ConfirmPopover
            title="Remove this newsletter?"
            description="Discovery won't add it back."
            confirmLabel="Remove"
            align="end"
            onConfirm={() => onAction('remove')}
            disabled={busy}
          >
            <button
              type="button"
              disabled={busy}
              aria-label={`Remove ${n.name}`}
              title="Remove"
              className={cn(
                GHOST_ICON,
                'hover:text-rose-600 dark:hover:text-rose-400'
              )}
            >
              <Trash2 aria-hidden className="h-4 w-4" />
            </button>
          </ConfirmPopover>
        </div>
      </footer>

      {askHowItWent && followUps.length > 0 && (
        <div
          role="group"
          aria-labelledby={followUpId}
          className="border-border flex flex-wrap items-center gap-2 border-t px-4 py-3 sm:px-5"
        >
          <p
            id={followUpId}
            className="text-foreground mr-auto text-[13px] font-medium"
          >
            How did it go?
          </p>
          {followUps.map(f => (
            <Button
              key={f.action}
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAction(f.action)}
              className={FOCUS_RING}
            >
              {f.label}
            </Button>
          ))}
          <button
            type="button"
            onClick={onDismissAsk}
            aria-label="Not now"
            title="Not now"
            className={GHOST_ICON}
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
      )}
    </article>
  )
}
