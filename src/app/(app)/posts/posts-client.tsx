'use client'

import { buttonClassName } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChips } from '@/components/ui/filter-chips'
import { StatTile } from '@/components/ui/stat-tile'
import { TimeAgo } from '@/components/ui/time-ago'
import { FOCUS_RING, TONES, type Tone } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import {
  copyText,
  FORMATS,
  formatOf,
  resolveMediaFormat,
  videoScriptOf,
  type FormatId
} from '@/lib/formats'
import { MobileNavButton } from '@/components/mobile-nav'
import { PlatformMark } from '@/components/platform-mark'
import { PlatformTabs } from '@/components/platform-tabs'
import { markDataChanged } from '@/components/refresh-on-back'
import { ThemeToggle } from '@/components/theme-toggle'
import { showToast } from '@/components/toast-notification'
import type { LintFinding } from '@/lib/lint/run-linter'
import { SIMILAR_POST_ENABLED } from '@/lib/reference-post/types'
import type { IdentitySummary } from '@/lib/identity'
import { PAGE_SIZE, pageNumbers, paginate, parsePage } from '@/lib/pagination'
import { getPlatform, PLATFORM_IDS, type PlatformId } from '@/lib/platforms'
import { platformPostText } from '@/lib/post-text'
import { formatPostCost, formatTokens, type PostUsage } from '@/lib/post-usage'
import { canPublishFormat } from '@/lib/publishing/platform'
import { isOnPlatform } from '@/lib/publishing/status'
import type { BackgroundPattern, ImageStyleChoice } from '@/lib/brand/theme'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpDown,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Funnel,
  Image as ImageIcon,
  ImageOff,
  Inbox,
  Layers,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  MoreVertical,
  Play,
  Plus,
  Search,
  Send,
  SquareCheck,
  Trash2,
  X,
  XCircle
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import {
  Suspense,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import {
  approveDraft,
  deleteDrafts,
  loadMorePosts,
  rejectDraft,
  setDraftHidden
} from './actions'
import type { PublicationSummary } from '@/lib/publishing/engine'
import {
  formatAbsoluteDate,
  formatAbsoluteDateTime,
  formatRelativeDate
} from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { LIST_PARAMS } from './list-params'
import { DeletedFromPlatformTag, PostStatusPill } from './post-status'
import { RejectPostDialog } from './reject-dialog'

export interface PostDetail {
  id: string
  accountId: string
  /** Where it goes out (src/lib/platforms). */
  platform: PlatformId
  accountName: string
  accountHeadline?: string | null
  runId?: string | null
  hook: string
  /** The hook the AI wrote, kept so a swap can be undone. */
  originalHook?: string | null
  body: string
  cta?: string | null
  firstComment?: string | null
  hashtags: string[]
  charCount: number
  status: string
  createdAt: Date | string
  /** The platform format (src/lib/formats); posts from before formats are LinkedIn. */
  formatId?: string
  /** Format-specific structure, e.g. an Instagram caption's visual idea. */
  payload?: Record<string, unknown> | null
  /**
   * What goes out with the text, as chosen: 'text', 'image' or 'carousel';
   * null follows the post's image (resolveMediaFormat).
   */
  mediaFormat?: string | null
  /** How many carousel slides it has (kept even when set to another type). */
  slideCount?: number
  ideaId?: string | null
  /** Every format the post's idea already has, this one included. */
  ideaFormats?: string[]
  /** How many earlier versions of its text are kept. */
  versionCount?: number
  variants: Array<{ id: string; variantType: string; content: string }>
  /** How many sources the draft cites, for the queue badge. */
  citationCount: number
  media?: {
    id?: string
    version?: number
    status?: string
    mode: string
    imageUrl?: string | null
    altText?: string | null
    promptOrQuery?: string | null
    source?: string
    workflow?: 'generate' | 'edit'
    width?: number | null
    height?: number | null
    fallbackApplied?: boolean
    visualType?: string
    relevanceScore?: number
    relevanceExplanation?: string
    issues?: string[]
    mediaBrief?: any
    providerRequestId?: string
    seed?: number
    regenerationAttempt?: number
    /** The brand logo was laid over this image. */
    hasLogo?: boolean
    /** A vision check looked at this image for bad lettering and drawn logos. */
    reviewChecked?: boolean
    /** An uploaded reference image guided its composition and style. */
    usedReference?: boolean
    /** The image style it was made in; unset for older, stock or edited images. */
    imageStyle?: ImageStyleChoice
  } | null
  /** Why drafting could not make this post's image, when it tried and failed. */
  mediaFailure?: string | null
  lintFindings: LintFinding[]
  /** When it was marked posted (by hand on Schedule, or by publishing), as ISO. */
  postedAt?: string | null
  /** When it was hidden from the queue, as ISO; it shows only under Hidden. */
  hiddenAt?: string | null
  /** The latest attempt to publish it to its platform, if any. */
  publication?: PublicationSummary | null
  /** What the post cost in AI so far (src/lib/post-usage.ts); null when none was recorded. */
  usage?: PostUsage | null
  /**
   * When it was last deleted from its platform through the app (ISO), for its
   * "Deleted from X" tag; null when never.
   */
  deletedFromPlatformAt?: string | null
}

/** What every generated image gets from the Brand Theme. */
export interface BrandSummary {
  hasLogo: boolean
  /** Hex colours, the primary first. */
  colors: string[]
  /** Set from the image panel; saved for the identity. */
  pattern: BackgroundPattern
  /** The website or handle on images; null for none. */
  footerText: string | null
  /** The identity's website as an image would show it, as a placeholder hint. */
  website: string | null
  /** The Brand Theme's image style: the default for a new image. */
  style: ImageStyleChoice
}

const LINT_RULE_LABELS: Record<string, string> = {
  char_limit: 'Character limit',
  hook_fold: 'Hook & fold',
  no_markdown_leakage: 'Plain text formatting',
  link_placement: 'Link placement strategy',
  banned_words: 'Tone & banned language',
  engagement_bait: 'Algorithmic engagement',
  grounded_citations: 'Citation grounding coverage',
  citations_coverage: 'Citation grounding coverage',
  unsupported_figures: 'Figures backed by evidence',
  unknown_links: 'Links from known sources',
  generic_cta: 'Call to action fits the post',
  CHAR_LIMIT: 'Character limit',
  HOOK_FOLD: 'Hook & fold',
  NO_MARKDOWN_LEAKAGE: 'Plain text formatting',
  LINK_PLACEMENT: 'Link placement strategy',
  BANNED_WORDS: 'Tone & banned language',
  ENGAGEMENT_BAIT: 'Algorithmic engagement',
  GROUNDED_CITATIONS: 'Citation grounding coverage',
  CITATIONS_COVERAGE: 'Citation grounding coverage'
}

function getHumanRuleLabel(rule: string, formatId?: string | null): string {
  // The fold label names LinkedIn; other platforms have their own fold.
  if (rule.toLowerCase() === 'hook_fold' && formatOf(formatId) !== 'linkedin.post') {
    return 'Hook & fold'
  }
  if (rule === 'thread_length') return 'Thread length'
  if (rule === 'script_length') return 'Script length'
  if (rule === 'caption_missing') return 'Caption'
  if (rule === 'video_title') return 'Video title'
  if (LINT_RULE_LABELS[rule]) return LINT_RULE_LABELS[rule]
  return rule
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * The status filters (?status=). Each post is under exactly one of the
 * statuses, so they add up to All: Published is live on its platform;
 * Approved is approved and not live yet (waiting, scheduled or publishing).
 * Scheduled is the part of Approved on its way out (scheduled or publishing),
 * so it is not counted in that sum.
 */
type StatusFilter =
  | 'all'
  | 'awaiting_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected'
  | 'draft'
type SortOrder = 'newest' | 'oldest'
type ViewMode = 'grid' | 'list'

const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'awaiting_review',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'draft'
]

/** Each status's name and tone, as on PostStatusPill and the Schedule page. */
const STATUS_META: Record<StatusFilter, { label: string; tone?: Tone }> = {
  all: { label: 'All' },
  awaiting_review: { label: 'Awaiting review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'brand' },
  published: { label: 'Published', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  draft: { label: 'Drafts', tone: 'neutral' }
}

/** The stages a post moves through, as the tiles over the list. */
const PIPELINE: {
  status: 'awaiting_review' | 'approved' | 'scheduled' | 'published'
  icon: typeof Inbox
}[] = [
  { status: 'awaiting_review', icon: Inbox },
  { status: 'approved', icon: CheckCircle2 },
  { status: 'scheduled', icon: CalendarClock },
  { status: 'published', icon: Send }
]

/** Cards or rows; each named only in its button's tooltip. */
const VIEW_OPTIONS = [
  { value: 'grid', label: 'Cards', Icon: LayoutGrid },
  { value: 'list', label: 'List', Icon: List }
] as const

/** The statuses off that path, beside All, as chips over the list. */
const OTHER_STATUSES: StatusFilter[] = ['all', 'rejected', 'draft']

/** Which status a post is under (Scheduled aside: see isQueued). */
function statusOf(
  post: PostDetail
): Exclude<StatusFilter, 'all' | 'scheduled'> {
  // Out on its platform. One deleted from it counts as approved again.
  if (post.postedAt || isOnPlatform(post.publication)) {
    return 'published'
  }
  if (post.status === 'approved') return 'approved'
  if (post.status === 'rejected') return 'rejected'
  if (post.status === 'draft') return 'draft'
  return 'awaiting_review'
}

/** Approved and on its way out: scheduled, or publishing right now. */
function isQueued(post: PostDetail): boolean {
  const publication = post.publication?.status
  return (
    statusOf(post) === 'approved' &&
    (publication === 'scheduled' || publication === 'publishing')
  )
}

function matchesStatus(post: PostDetail, status: StatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'scheduled') return isQueued(post)
  return statusOf(post) === status
}

/** When a queued publication goes out next: its retry, or its time. */
function queuedAt(publication: PublicationSummary): string {
  return publication.attempts > 0 ? publication.nextAttemptAt : publication.scheduledAt
}

/**
 * Awaiting review, so Approve and Reject are offered on its card. Never one
 * going out right now, which rejectDraft refuses (as the post page does).
 */
function isReviewable(post: PostDetail): boolean {
  return (
    statusOf(post) === 'awaiting_review' &&
    post.publication?.status !== 'publishing'
  )
}

/**
 * Approved or rejected, as the post page shows it after the same action:
 * rejecting also cancels its scheduled publication (rejectDraft does that on
 * the server), so it shows as cancelled here too.
 */
function withReviewStatus(
  post: PostDetail,
  status: 'approved' | 'rejected'
): PostDetail {
  const publication =
    status === 'rejected' && post.publication?.status === 'scheduled'
      ? {
          ...post.publication,
          status: 'cancelled' as const,
          error: 'Cancelled because the post was rejected.',
          errorCode: 'not_approved' as const
        }
      : post.publication
  return { ...post, status, publication }
}

/** Short platform names for "Live on …". */
const LIVE_ON: Partial<Record<PlatformId, string>> = {
  instagram: 'IG',
  facebook: 'FB'
}

const DAY_MS = 86_400_000

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/**
 * Local midnight of a date input's yyyy-mm-dd value, moved by `addDays`, or
 * null when the input is empty.
 */
function dayStart(value: string, addDays = 0): Date | null {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day + addDays)
}

/** Whether a date falls in the From–To range; both days count, an empty end is open. */
function inDateRange(value: Date | string, from: string, to: string): boolean {
  const time = toDate(value).getTime()
  const start = dayStart(from)
  if (start && time < start.getTime()) return false
  const end = dayStart(to, 1)
  if (end && time >= end.getTime()) return false
  return true
}

/**
 * The list as shown: posts already narrowed by platform, dates and search,
 * with the hidden and status filters applied, in the chosen order. Hidden
 * posts show only when Filters asks for them.
 */
function queueOf(
  scoped: PostDetail[],
  status: StatusFilter,
  hidden: boolean,
  sort: SortOrder
): PostDetail[] {
  return scoped
    .filter(
      p => Boolean(p.hiddenAt) === hidden && matchesStatus(p, status)
    )
    .sort((a, b) => {
      const diff = toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
      return sort === 'newest' ? diff : -diff
    })
}

const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/

/**
 * A yyyy-mm-dd value that names a real day. "2026-02-31" has the right shape
 * but rolls over to March, and the date input shows it as blank, so a link
 * carrying it would empty the queue for a reason nobody can see.
 */
function realDay(value: string): string {
  if (!DAY_PARAM.test(value)) return ''
  const [year, month, day] = value.split('-').map(Number)
  const date = dayStart(value)
  return date &&
    date.getFullYear() === year &&
    date.getMonth() === month! - 1 &&
    date.getDate() === day
    ? value
    : ''
}

/**
 * The filters live in the URL (?status=&hidden=&from=&to=&sort=&view=&q=) so
 * they survive a reload and can be shared as a link. Unknown or malformed
 * values fall back to the defaults, which are left out of the URL. An older
 * link's ?status=hidden is read as ?hidden=1.
 */
function filtersFromParams(params: URLSearchParams) {
  const rawStatus = params.get('status')
  const status = STATUS_FILTERS.find(s => s === rawStatus) ?? 'all'
  let from = realDay(params.get('from') ?? '')
  let to = realDay(params.get('to') ?? '')
  // A reversed range matches nothing; the popover never writes one.
  if (from && to && from > to) from = to = ''
  return {
    status,
    hidden: params.get('hidden') === '1' || rawStatus === 'hidden',
    from,
    to,
    sort: (params.get('sort') === 'oldest' ? 'oldest' : 'newest') as SortOrder,
    view: (params.get('view') === 'list' ? 'list' : 'grid') as ViewMode
  }
}

/**
 * Writes URL params through the native History API, which Next.js keeps in
 * sync with useSearchParams without a server round trip. Empty values are
 * removed. Reads the live URL so back-to-back writes don't undo each other.
 */
function writeParams(
  changes: Record<string, string | null>,
  mode: 'push' | 'replace'
) {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(changes)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  const query = params.toString()
  const url = query ? `?${query}` : window.location.pathname
  if (mode === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
}

/** A date as a date input's yyyy-mm-dd value, in local time. */
function toDayInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Stable grouping key. Group boundaries are derived from this rather than from
 * the display label. The server's time zone is not the viewer's, so until the
 * page is mounted (`local` false) days are UTC days, the same on both sides.
 */
function dayKey(value: Date | string, local = true): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return local
    ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    : `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
}

/** "6h ago", "1d ago", "3d ago", then the date. Call only once mounted. */
function shortAgo(value: Date | string): string {
  return formatRelativeDate(value).replace(/^yesterday$/, '1d ago')
}

/** "21 Nov, 09:00", short enough for a card's footer. Call only once mounted. */
function shortDateTime(value: Date | string): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `${formatAbsoluteDate(date)}, ${time}`
}

/**
 * A day's heading: "Today · Nov 11", "Yesterday · Nov 10", "Wed · Nov 5".
 * The viewer's own calendar is only known once mounted; before that, none
 * (the server's would not match it).
 */
function dayHeading(value: Date | string, mounted: boolean): string {
  if (!mounted) return ''
  const date = toDate(value)
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
  const today = new Date()
  if (dayKey(date) === dayKey(today)) return `Today · ${day}`
  if (dayKey(date) === dayKey(new Date(today.getTime() - DAY_MS))) {
    return `Yesterday · ${day}`
  }
  return `${date.toLocaleDateString(undefined, { weekday: 'short' })} · ${day}`
}

/** Posts on one page of the list: the app's page size, 10 like every list. */
const LIST_PAGE_SIZE = PAGE_SIZE
/** Posts per deleteDrafts call; within its DELETE_DRAFTS_MAX. */
const DELETE_CHUNK = 20

/** The post's text as it is pasted on its platform, for Copy text. */
function postTextOf(post: PostDetail): string {
  const format = formatOf(post.formatId)
  return format === 'linkedin.post'
    ? platformPostText(post, getPlatform(post.platform))
    : copyText(format, post)
}

/**
 * Every post, as a list (/posts), laid out as cards or rows. Platform tabs,
 * status chips, search, Filters (dates, hidden posts) and Sort narrow and
 * order it; opening a post goes to its own page (/posts/[id]), where it is
 * reviewed, given an image and published. All of it lives in the URL, so the
 * post's "All posts" link and Back return to the list as it was.
 */
export function PostsClientInner({
  initialPosts,
  initialNextCursor,
  totalCount,
  identity,
  enabledFormats = ['linkedin.post']
}: {
  initialPosts: PostDetail[]
  /** Where the next batch starts; null when every post is already loaded. */
  initialNextCursor: string | null
  totalCount: number
  identity: IdentitySummary
  /** The formats the identity has turned on: their platforms get a tab. */
  enabledFormats?: FormatId[]
}) {
  const searchParams = useSearchParams()
  const filterRunId = searchParams.get('runId')
  const hasMounted = useHasMounted()

  const [posts, setPosts] = useState<PostDetail[]>(initialPosts)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  // Posts deleted here, taken off the server's total.
  const [deletedCount, setDeletedCount] = useState(0)

  // Older posts come in a batch at a time; the newest are shown first.
  // nextCursor: null when every post is loaded; '' when the post it named was
  // deleted with none loaded before it, so the next batch starts from the newest
  // (posts already loaded are skipped).
  const loadMore = async () => {
    if (nextCursor === null || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await loadMorePosts(nextCursor || null)
      if (res.success) {
        setPosts(prev => {
          const have = new Set(prev.map(p => p.id))
          return [...prev, ...res.posts.filter(p => !have.has(p.id))]
        })
        setNextCursor(res.nextCursor)
      } else {
        showToast({ type: 'error', title: 'Could not load more', message: res.error })
      }
    } finally {
      setIsLoadingMore(false)
    }
  }

  const {
    status: statusFilter,
    hidden: showHidden,
    from: dateFrom,
    to: dateTo,
    sort: sortOrder,
    view
  } = filtersFromParams(searchParams)
  // One platform's posts only (?platform=x); null shows every platform.
  const platformParam = searchParams.get('platform')
  const platformFilter = PLATFORM_IDS.find(id => id === platformParam) ?? null
  const page = parsePage(searchParams.get('page') ?? undefined)

  // Typed into on every keystroke, so it is local state that is copied into
  // the URL (replace, not push: each letter is not a Back step).
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '')
  // The list is filtered against this copy, which React catches up in the
  // background, so typing never waits on the list.
  const deferredQuery = useDeferredValue(searchQuery)
  const changeSearch = (value: string) => {
    setSearchQuery(value)
    writeParams({ q: value.trim() ? value : null, page: null }, 'replace')
  }
  // Back and Forward change the URL without typing, so the box follows it.
  useEffect(() => {
    const onPopState = () =>
      setSearchQuery(new URLSearchParams(window.location.search).get('q') ?? '')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // ⌘K (Ctrl+K elsewhere) jumps to the search box.
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  const isMac =
    hasMounted && /Mac|iPhone|iPad/.test(window.navigator.userAgent)

  // A filter change starts the list again from its first page.
  const setFilters = (changes: Record<string, string | null>) =>
    writeParams({ ...changes, page: null }, 'push')

  // Posts matching the run, the dates and the search: what the platform tabs
  // and status chips then narrow. All posts here already belong to the
  // active identity (scoped server-side).
  const basePosts = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase()
    return posts.filter(p => {
      if (filterRunId && p.runId !== filterRunId) return false
      if (!inDateRange(p.createdAt, dateFrom, dateTo)) return false
      if (query) {
        // Tags are searched as shown in the preview (#tag), whether or not they
        // were stored with the #, so "#tag" and "tag" both find them.
        const tags = (p.hashtags || []).map(t => `#${t.replace(/^#+/, '')}`)
        const haystack =
          `${p.hook} ${p.body} ${p.accountName} ${tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [posts, filterRunId, dateFrom, dateTo, deferredQuery])

  const platformPosts = useMemo(
    () =>
      platformFilter
        ? basePosts.filter(p => p.platform === platformFilter)
        : basePosts,
    [basePosts, platformFilter]
  )

  // Each tile's, chip's and tab's count has the other row's choice applied,
  // so it says what picking it would show. The tiles' hints come from the
  // same posts: the oldest one waiting for review, the next one going out.
  const {
    counts: statusCounts,
    oldestAwaiting,
    nextQueuedAt
  } = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: 0,
      awaiting_review: 0,
      approved: 0,
      scheduled: 0,
      published: 0,
      rejected: 0,
      draft: 0
    }
    let oldestAwaiting: Date | string | null = null
    let nextQueuedAt: string | null = null
    for (const p of platformPosts) {
      if (Boolean(p.hiddenAt) !== showHidden) continue
      counts.all++
      const status = statusOf(p)
      counts[status]++
      if (
        status === 'awaiting_review' &&
        (!oldestAwaiting || toDate(p.createdAt) < toDate(oldestAwaiting))
      ) {
        oldestAwaiting = p.createdAt
      }
      if (isQueued(p)) {
        counts.scheduled++
        const at = p.publication?.status === 'scheduled' ? queuedAt(p.publication) : null
        if (at && (!nextQueuedAt || at < nextQueuedAt)) nextQueuedAt = at
      }
    }
    return { counts, oldestAwaiting, nextQueuedAt }
  }, [platformPosts, showHidden])

  const platformCounts = useMemo(() => {
    const shown = queueOf(basePosts, statusFilter, showHidden, sortOrder)
    const counts = new Map<PlatformId, number>()
    for (const p of shown) counts.set(p.platform, (counts.get(p.platform) ?? 0) + 1)
    return { all: shown.length, counts }
  }, [basePosts, statusFilter, showHidden, sortOrder])

  // A tab for every platform with posts, or turned on for this identity.
  const platformOptions = useMemo(() => {
    const have = new Set<PlatformId>([
      ...posts.map(p => p.platform),
      ...enabledFormats.map(f => FORMATS[f].platform)
    ])
    return PLATFORM_IDS.filter(id => have.has(id))
  }, [posts, enabledFormats])

  const filteredPosts = useMemo(
    () => queueOf(platformPosts, statusFilter, showHidden, sortOrder),
    [platformPosts, statusFilter, showHidden, sortOrder]
  )
  const { rows: pagePosts, pageInfo } = paginate(
    filteredPosts,
    page,
    LIST_PAGE_SIZE
  )
  // The page's posts under their day: Today, Yesterday, Wed · Nov 5…
  const dayGroups: { key: string; date: Date | string; posts: PostDetail[] }[] = []
  for (const post of pagePosts) {
    const key = dayKey(post.createdAt, hasMounted)
    const last = dayGroups[dayGroups.length - 1]
    if (last && last.key === key) last.posts.push(post)
    else dayGroups.push({ key, date: post.createdAt, posts: [post] })
  }

  const hasActiveFilters =
    Boolean(dateFrom || dateTo) ||
    showHidden ||
    sortOrder !== 'newest' ||
    statusFilter !== 'all' ||
    platformFilter !== null ||
    searchQuery.trim().length > 0

  // Also leaves a run's posts (?runId=), back to every post. The view stays.
  const clearFilters = () => {
    setSearchQuery('')
    writeParams(
      Object.fromEntries(
        LIST_PARAMS.filter(key => key !== 'view').map(key => [key, null])
      ),
      'push'
    )
  }

  // A post's page carries the list's params, so its "All posts" link comes
  // back to the list as it is now.
  const listQuery = searchParams.toString()
  const postHref = (id: string) =>
    `/posts/${id}${listQuery ? `?${listQuery}` : ''}`

  // ---- Acting on posts from the list: the card menu ----

  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set())
  const markBusy = (ids: string[], busy: boolean) =>
    setBusyIds(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (busy) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const removePosts = (ids: string[]) => {
    const gone = new Set(ids)
    // Older posts load from after the cursor post, which must still exist:
    // the nearest earlier post still loaded takes its place.
    if (nextCursor && gone.has(nextCursor)) {
      const index = posts.findIndex(p => p.id === nextCursor)
      const before = posts.slice(0, index).reverse().find(p => !gone.has(p.id))
      setNextCursor(before?.id ?? '')
    }
    setPosts(list => list.filter(p => !gone.has(p.id)))
    setDeletedCount(n => n + ids.length)
  }

  const copyPostText = async (post: PostDetail) => {
    try {
      await navigator.clipboard.writeText(postTextOf(post))
      showToast({ type: 'success', title: 'Post copied' })
    } catch {
      showToast({
        type: 'error',
        title: 'Copy failed',
        message: 'Open the post and copy it from there.'
      })
    }
  }

  const toggleHidden = async (post: PostDetail) => {
    const hide = !post.hiddenAt
    markBusy([post.id], true)
    try {
      markDataChanged()
      const res = await setDraftHidden(post.id, hide)
      if (!res.success) throw new Error(res.error)
      setPosts(list =>
        list.map(p => (p.id === post.id ? { ...p, hiddenAt: res.hiddenAt } : p))
      )
      showToast({
        type: 'success',
        title: hide ? 'Post hidden' : 'Post unhidden',
        message: hide ? 'Turn on Hidden posts in Filters to see it.' : undefined
      })
    } catch (err: any) {
      showToast({
        type: 'error',
        title: hide ? 'Post not hidden' : 'Post not unhidden',
        message: err?.message || 'Failed to update the post'
      })
    } finally {
      markBusy([post.id], false)
    }
  }

  // ---- Select: tick posts, or every post shown, and delete them together ----

  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  // Only the posts the list shows count, so a filter changed meanwhile never
  // deletes posts out of sight. With none shown there is nothing to select.
  const canSelect = filteredPosts.length > 0
  const inSelectMode = selecting && canSelect
  const selectedIds = filteredPosts.filter(p => selected.has(p.id)).map(p => p.id)
  const allSelected = canSelect && selectedIds.length === filteredPosts.length

  // Select all has to mean every post, so the older batches not loaded yet
  // come in first.
  const startSelecting = async () => {
    let cursor = nextCursor
    if (cursor !== null) {
      setIsLoadingAll(true)
      const more: PostDetail[] = []
      try {
        while (cursor !== null) {
          const res = await loadMorePosts(cursor || null)
          if (!res.success) {
            showToast({ type: 'error', title: 'Could not load every post', message: res.error })
            break
          }
          more.push(...res.posts)
          cursor = res.nextCursor
        }
      } finally {
        setIsLoadingAll(false)
      }
      setPosts(prev => {
        const have = new Set(prev.map(p => p.id))
        const added = more.filter(p => !have.has(p.id) && have.add(p.id))
        return [...prev, ...added]
      })
      setNextCursor(cursor)
    }
    setSelecting(true)
  }

  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const setPostSelected = (id: string, on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // Delete (card menu, or the selection bar) asks first.
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  // How many of the posts being deleted are done, for the dialog's button.
  const [deleteProgress, setDeleteProgress] = useState(0)
  const confirmDelete = async () => {
    if (!pendingDelete) return
    const ids = pendingDelete
    setIsDeleting(true)
    setDeleteProgress(0)
    markBusy(ids, true)
    markDataChanged()
    const deleted: string[] = []
    const failures: string[] = []
    // In chunks, so a long selection shows progress and no one request runs long.
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const chunk = ids.slice(i, i + DELETE_CHUNK)
      const res = await deleteDrafts(chunk).catch((err: any) => ({
        success: false as const,
        error: err?.message as string
      }))
      if (res.success) {
        deleted.push(...res.deleted)
        failures.push(...res.failures)
      } else {
        failures.push(...chunk.map(() => res.error || 'Failed to delete the post'))
      }
      setDeleteProgress(i + chunk.length)
    }
    removePosts(deleted)
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of deleted) next.delete(id)
      return next
    })
    markBusy(ids, false)
    setIsDeleting(false)
    setPendingDelete(null)
    if (deleted.length > 0) {
      showToast({
        type: 'success',
        title:
          deleted.length === 1 ? 'Post deleted' : `${deleted.length} posts deleted`
      })
    }
    if (failures.length > 0) {
      showToast({
        type: 'error',
        title:
          failures.length === 1
            ? 'A post was not deleted'
            : `${failures.length} posts were not deleted`,
        message: failures[0]
      })
    }
  }

  // ---- Quick review: Approve and Reject on a card awaiting review, with
  // the post page's actions and messages. The post then moves to its new
  // status here, out of an Awaiting review list. ----

  // Shows the spinner on that card's Approve.
  const [approvingIds, setApprovingIds] = useState<ReadonlySet<string>>(new Set())
  const approvePost = async (post: PostDetail) => {
    if (post.status === 'approved') return
    markBusy([post.id], true)
    setApprovingIds(prev => new Set(prev).add(post.id))
    try {
      markDataChanged()
      // Refused for an X post over X's limit; the reason comes back as the error.
      const res = await approveDraft(post.id)
      if (!res.success) throw new Error(res.error)
      setPosts(list =>
        list.map(p => (p.id === post.id ? withReviewStatus(p, 'approved') : p))
      )
      showToast({ type: 'success', title: 'Post approved' })
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Post not approved',
        message: err?.message || 'Failed to approve draft'
      })
    } finally {
      markBusy([post.id], false)
      setApprovingIds(prev => {
        const next = new Set(prev)
        next.delete(post.id)
        return next
      })
    }
  }

  // Reject asks why first (optionally), in a dialog.
  const [pendingReject, setPendingReject] = useState<PostDetail | null>(null)
  const [isRejecting, setIsRejecting] = useState(false)
  const rejectPost = async (reason: string) => {
    const post = pendingReject
    if (!post) return
    // As on the post page: not once it is out, or a second time.
    if (
      post.status === 'rejected' ||
      isOnPlatform(post.publication) ||
      post.publication?.status === 'publishing'
    ) {
      setPendingReject(null)
      return
    }
    setIsRejecting(true)
    markBusy([post.id], true)
    try {
      markDataChanged()
      const res = await rejectDraft(post.id, reason.trim() || undefined)
      if (!res.success) throw new Error(res.error)
      setPosts(list =>
        list.map(p => (p.id === post.id ? withReviewStatus(p, 'rejected') : p))
      )
      // Closed only once it worked: a failure keeps the reason to try again.
      setPendingReject(null)
      showToast({
        type: 'success',
        title: 'Post rejected',
        message: reason.trim()
          ? 'Your reason was saved to shape future drafts.'
          : undefined
      })
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Post not rejected',
        message: err?.message || 'Failed to reject draft'
      })
    } finally {
      setIsRejecting(false)
      markBusy([post.id], false)
    }
  }

  const cardProps = (post: PostDetail) => ({
    post,
    href: postHref(post.id),
    mounted: hasMounted,
    busy: busyIds.has(post.id),
    approving: approvingIds.has(post.id),
    reviewable: isReviewable(post),
    onCopy: () => void copyPostText(post),
    onToggleHidden: () => void toggleHidden(post),
    onDelete: () => setPendingDelete([post.id]),
    onApprove: () => void approvePost(post),
    onReject: () => setPendingReject(post),
    selecting: inSelectMode,
    selected: selected.has(post.id),
    onSelectChange: (on: boolean) => setPostSelected(post.id, on)
  })

  // A status picked from a tile or a chip. An older link's ?status=hidden
  // stays in hidden mode.
  const pickStatus = (status: StatusFilter) =>
    setFilters({
      status: status === 'all' ? null : status,
      ...(searchParams.get('status') === 'hidden' ? { hidden: '1' } : {})
    })

  // Only the status narrows the list, so an empty one has a reason to say.
  const onlyStatusFilter =
    !dateFrom &&
    !dateTo &&
    !showHidden &&
    !filterRunId &&
    searchQuery.trim().length === 0

  const shownFrom = pageInfo.total === 0 ? 0 : (pageInfo.page - 1) * LIST_PAGE_SIZE + 1
  const shownTo = Math.min(pageInfo.page * LIST_PAGE_SIZE, pageInfo.total)
  const goToPage = (next: number) => {
    writeParams({ page: next > 1 ? String(next) : null }, 'push')
    scrollRef.current?.scrollTo({ top: 0 })
  }
  const scrollRef = useRef<HTMLDivElement>(null)

  // Older posts load where they will show: after the last page newest-first,
  // before the first page oldest-first.
  const loadOlder =
    nextCursor !== null &&
    (sortOrder === 'oldest'
      ? pageInfo.page === 1
      : pageInfo.page === pageInfo.pageCount) ? (
      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={isLoadingMore}
          title="Search and filters cover the posts loaded so far"
          className={buttonClassName({
            variant: 'secondary',
            size: 'sm',
            className: FOCUS_RING
          })}
        >
          {isLoadingMore && (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          )}
          Load older posts
        </button>
      </div>
    ) : null

  // A tile's second line is a time or nothing: how long the oldest post has
  // waited, when the next one goes out. Only once mounted (TimeAgo).
  const tileHint = (status: (typeof PIPELINE)[number]['status']) => {
    if (status === 'awaiting_review' && oldestAwaiting) {
      return <TimeAgo value={oldestAwaiting} prefix="Oldest" />
    }
    if (status === 'scheduled' && nextQueuedAt) {
      return <TimeAgo value={nextQueuedAt} prefix="Next" absolute />
    }
    return undefined
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.length === 1
              ? 'Delete this post?'
              : `Delete ${pendingDelete.length} posts?`
          }
          description="This can’t be undone. Scheduled publishing stops; published posts stay up."
          confirmLabel={pendingDelete.length === 1 ? 'Delete post' : 'Delete posts'}
          pendingLabel={
            pendingDelete.length > DELETE_CHUNK
              ? `Deleting… ${deleteProgress} of ${pendingDelete.length}`
              : 'Deleting…'
          }
          pending={isDeleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}

      {pendingReject && (
        <RejectPostDialog
          hook={pendingReject.hook}
          pending={isRejecting}
          onCancel={() => setPendingReject(null)}
          onConfirm={reason => void rejectPost(reason)}
        />
      )}

      {/* Full width, 16px in from each side (24px from sm), like the bar. Sized by its own width (the
          sidebar takes part of the screen), so the rows use @-variants. */}
      <div
        ref={scrollRef}
        // Thumbnails find this as their scroll root (see Thumbnail).
        data-posts-scroll
        className="bg-background @container min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6 sm:px-6"
      >
        <div className="space-y-4">
          {/* TITLE: in the page itself (not the shared top bar), with the
              mobile menu and theme buttons the bar would have drawn. */}
          <div className="flex flex-col gap-4 pt-2 @3xl:flex-row @3xl:items-center @3xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <MobileNavButton />
                <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-3xl">
                  Posts
                </h1>
                <span
                  title={`${totalCount - deletedCount} posts in total`}
                  className="border-border bg-surface-hover text-muted rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums"
                >
                  {totalCount - deletedCount}
                </span>
              </div>
              <p className="text-muted mt-1 text-sm">@{identity.handle}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {SIMILAR_POST_ENABLED && (
                <Link
                  href="/ideas?similar=1"
                  title="Create a post like a public post, reel or video, from its link"
                  aria-label="Create a post like one you saw, from its link"
                  className={buttonClassName({
                    variant: 'secondary',
                    size: 'sm',
                    className: cn('h-9', FOCUS_RING)
                  })}
                >
                  <Link2 aria-hidden className="text-accent h-4 w-4" />
                  <span className="hidden sm:inline">From a link</span>
                </Link>
              )}
              <Link
                href="/ideas"
                title="Posts are drafted from ideas: approve one to draft its post"
                // Secondary: on this page the accent is kept for Approve.
                className={buttonClassName({
                  variant: 'secondary',
                  size: 'sm',
                  className: cn('h-9', FOCUS_RING)
                })}
              >
                <Plus aria-hidden className="h-4 w-4" />
                <span className="hidden sm:inline">Create Post</span>
                <span className="sr-only sm:hidden">Create Post</span>
              </Link>
              <ThemeToggle />
            </div>
          </div>

          {/* PLATFORM TABS: one platform's posts, or every platform's */}
          <div className="border-border border-b pb-3">
            <PlatformTabs
              label="Show posts for one platform"
              options={platformOptions}
              value={platformFilter}
              onChange={option => setFilters({ platform: option })}
              counts={{
                all: platformCounts.all,
                byPlatform: Object.fromEntries(platformCounts.counts)
              }}
            />
          </div>

          {/* THE WAY OUT: how many posts wait for review, are approved, are
              scheduled and are out. Each tile is also that status's filter;
              picked again, it goes back to every status. */}
          <div
            role="group"
            aria-label="Show posts by stage"
            className="grid grid-cols-2 gap-3 @3xl:grid-cols-4"
          >
            {PIPELINE.map(({ status, icon }) => {
              const active = statusFilter === status
              return (
                <StatTile
                  key={status}
                  label={STATUS_META[status].label}
                  value={statusCounts[status]}
                  hint={tileHint(status)}
                  icon={icon}
                  tone={STATUS_META[status].tone}
                  active={active}
                  onClick={() => pickStatus(active ? 'all' : status)}
                  className="p-3 @lg:p-4"
                />
              )
            })}
          </div>

          {/* ALL, REJECTED, DRAFTS, then search, Filters, Sort and the view */}
          <div className="flex flex-col gap-3 @min-[60rem]:flex-row @min-[60rem]:items-center @min-[60rem]:justify-between">
            <FilterChips<StatusFilter>
              label="Show posts by status"
              value={statusFilter}
              onChange={pickStatus}
              // All has no count: the number by the title is the total.
              options={OTHER_STATUSES.map(status => ({
                value: status,
                label: STATUS_META[status].label,
                count: status === 'all' ? undefined : statusCounts[status],
                tone: STATUS_META[status].tone
              }))}
              className="self-start @min-[60rem]:self-auto"
            />

            <div className="flex flex-wrap items-center gap-2 @min-[60rem]:shrink-0 @min-[60rem]:flex-nowrap">
              <div className="relative min-w-48 flex-1 @min-[60rem]:w-56 @min-[60rem]:flex-none">
                <Search
                  aria-hidden
                  className="text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={searchQuery}
                  onChange={e => changeSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && e.currentTarget.blur()}
                  placeholder="Search posts..."
                  aria-label="Search posts"
                  title={`Search posts (${isMac ? '⌘K' : 'Ctrl+K'})`}
                  className="border-border bg-surface text-foreground placeholder:text-muted focus:border-accent focus-visible:ring-foreground/15 h-9 w-full rounded-lg border pr-3 pl-9 text-[13px] outline-none focus-visible:ring-2"
                />
              </div>
              <PostFiltersMenu
                value={{ from: dateFrom, to: dateTo, hidden: showHidden }}
                today={hasMounted ? toDayInput(new Date()) : undefined}
                onApply={next =>
                  setFilters({
                    from: next.from || null,
                    to: next.to || null,
                    hidden: next.hidden ? '1' : null,
                    // An older link's ?status=hidden goes with it.
                    ...(searchParams.get('status') === 'hidden' ? { status: null } : {})
                  })
                }
              />
              <label className="border-border bg-surface text-muted focus-within:border-accent focus-within:ring-foreground/15 relative flex h-9 items-center gap-2 rounded-lg border pr-2.5 pl-3 text-[13px] focus-within:ring-2">
                <ArrowUpDown aria-hidden className="h-4 w-4" />
                <select
                  aria-label="Sort"
                  value={sortOrder}
                  onChange={e =>
                    setFilters({ sort: e.target.value === 'oldest' ? 'oldest' : null })
                  }
                  className="text-foreground cursor-pointer appearance-none bg-transparent pr-6 font-medium outline-none"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                </select>
                <ChevronDown
                  aria-hidden
                  className="text-muted pointer-events-none absolute right-2.5 h-4 w-4"
                />
              </label>
              <div
                role="group"
                aria-label="View"
                className="border-border bg-surface flex h-9 items-center rounded-lg border p-0.5"
              >
                {VIEW_OPTIONS.map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    aria-label={`${label} view`}
                    title={`${label} view`}
                    onClick={() =>
                      writeParams({ view: value === 'list' ? 'list' : null }, 'replace')
                    }
                    className={cn(
                      'flex h-full w-8 cursor-pointer items-center justify-center rounded-md transition-colors',
                      FOCUS_RING,
                      view === value
                        ? 'bg-surface-hover text-foreground'
                        : 'text-muted hover:text-foreground'
                    )}
                  >
                    <Icon aria-hidden className="h-4 w-4" />
                  </button>
                ))}
              </div>
              {/* Ticks posts to delete them together; the bar below the list
                  has Select all and Delete. */}
              {canSelect && (
                <button
                  type="button"
                  aria-pressed={inSelectMode}
                  onClick={() => (inSelectMode ? stopSelecting() : void startSelecting())}
                  disabled={isLoadingAll}
                  className={buttonClassName({
                    variant: 'secondary',
                    size: 'sm',
                    className: cn('h-9', FOCUS_RING)
                  })}
                >
                  {isLoadingAll ? (
                    <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                  ) : inSelectMode ? (
                    <X aria-hidden className="h-4 w-4" />
                  ) : (
                    <SquareCheck aria-hidden className="h-4 w-4" />
                  )}
                  {inSelectMode ? 'Cancel' : 'Select'}
                </button>
              )}
            </div>
          </div>

          {/* What else narrows the list, and the way back to all of it */}
          {(hasActiveFilters || filterRunId) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {showHidden && (
                <span className="border-border bg-surface text-foreground inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-medium">
                  <EyeOff aria-hidden className="text-muted h-3 w-3" />
                  Hidden posts
                </span>
              )}
              {filterRunId && (
                <span className="border-border bg-surface text-foreground inline-flex h-6 items-center rounded-full border px-2.5 font-medium">
                  One run
                </span>
              )}
              <button
                type="button"
                onClick={clearFilters}
                className={cn(
                  'text-muted hover:text-foreground inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 font-medium transition-colors',
                  FOCUS_RING
                )}
              >
                <X aria-hidden className="h-3.5 w-3.5" />
                {filterRunId ? 'Show all posts' : 'Clear filters'}
              </button>
            </div>
          )}

          {sortOrder === 'oldest' && loadOlder}

          {filteredPosts.length === 0 ? (
            posts.length === 0 ? (
              <EmptyState
                icon={FileText}
                tone="brand"
                title="No posts yet"
                description="Approve an idea to draft its post."
                action={
                  <Link
                    href="/ideas"
                    className={buttonClassName({ size: 'sm', className: FOCUS_RING })}
                  >
                    Go to Ideas
                    <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                  </Link>
                }
              />
            ) : statusFilter === 'awaiting_review' && onlyStatusFilter ? (
              // Reviewed everything: the queue's own good news, not a dead end.
              <EmptyState
                icon={CheckCircle2}
                tone="success"
                title="Nothing to review"
                action={
                  <button
                    type="button"
                    onClick={() => pickStatus('all')}
                    className={buttonClassName({
                      variant: 'secondary',
                      size: 'sm',
                      className: FOCUS_RING
                    })}
                  >
                    Show all posts
                  </button>
                }
              />
            ) : (
              <EmptyState
                icon={Search}
                title="No matching posts"
                action={
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={buttonClassName({
                      variant: 'secondary',
                      size: 'sm',
                      className: FOCUS_RING
                    })}
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                    Clear filters
                  </button>
                }
              />
            )
          ) : (
            <div className="space-y-7 pt-1">
              {dayGroups.map((group, i) => {
                return (
                  <section key={`${group.key}-${i}`} className="space-y-3">
                    {/* The day, and how many of the page's posts are from it
                        (each card shows its own status). */}
                    <h2 className="flex items-center gap-3">
                      <span className="text-foreground/80 text-xs font-semibold tracking-wider uppercase">
                        {dayHeading(group.date, hasMounted)}
                      </span>
                      <span aria-hidden className="bg-border h-px flex-1" />
                      <span className="text-muted text-xs font-normal tabular-nums">
                        {group.posts.length}
                      </span>
                    </h2>
                    {view === 'grid' ? (
                      // 1 to 5 columns by the list's own width
                      <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2 @min-[54rem]:grid-cols-3 @min-[68rem]:grid-cols-4 @min-[92rem]:grid-cols-5">
                        {group.posts.map(post => (
                          <PostCard key={post.id} {...cardProps(post)} />
                        ))}
                      </div>
                    ) : (
                      <div className="border-border bg-surface divide-border divide-y rounded-2xl border shadow-xs">
                        {group.posts.map(post => (
                          <PostRow key={post.id} {...cardProps(post)} />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}

          {sortOrder !== 'oldest' && loadOlder}

          {/* PAGINATION */}
          {filteredPosts.length > 0 && (
            <nav
              aria-label="Pagination"
              className="border-border mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-6"
            >
              <p className="text-muted text-[13px] tabular-nums">
                <span className="text-foreground font-semibold">
                  {shownFrom}–{shownTo}
                </span>{' '}
                of {pageInfo.total}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <button
                  type="button"
                  disabled={pageInfo.page <= 1}
                  onClick={() => goToPage(pageInfo.page - 1)}
                  aria-label="Previous page"
                  className={cn(
                    'border-border bg-surface text-foreground hover:bg-surface-hover disabled:text-muted flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    FOCUS_RING
                  )}
                >
                  <ChevronLeft aria-hidden className="h-4 w-4" />
                </button>
                {pageNumbers(pageInfo.page, pageInfo.pageCount).map((n, i) =>
                  n === null ? (
                    <span key={`gap-${i}`} aria-hidden className="text-muted w-5 text-center text-xs">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      aria-current={n === pageInfo.page ? 'page' : undefined}
                      onClick={() => goToPage(n)}
                      className={cn(
                        'h-8 min-w-8 cursor-pointer rounded-lg px-2 text-[13px] font-semibold tabular-nums transition-colors',
                        FOCUS_RING,
                        n === pageInfo.page
                          ? 'border-foreground/20 bg-surface-hover text-foreground border'
                          : 'border-border bg-surface text-muted hover:text-foreground hover:bg-surface-hover border'
                      )}
                    >
                      {n}
                    </button>
                  )
                )}
                <button
                  type="button"
                  disabled={pageInfo.page >= pageInfo.pageCount}
                  onClick={() => goToPage(pageInfo.page + 1)}
                  aria-label="Next page"
                  className={cn(
                    'border-border bg-surface text-foreground hover:bg-surface-hover disabled:text-muted flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    FOCUS_RING
                  )}
                >
                  <ChevronRight aria-hidden className="h-4 w-4" />
                </button>
              </div>
            </nav>
          )}

          {/* While selecting: how many are ticked, Select all (every post
              the filters show, on every page), and Delete. */}
          {inSelectMode && (
            <div className="pointer-events-none sticky bottom-0 z-20 pt-2">
              <div
                role="region"
                aria-label="Selected posts"
                className="border-border bg-surface pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border p-2 pl-4 shadow-lg"
              >
                <p className="text-foreground text-sm font-medium tabular-nums">
                  {selectedIds.length} selected
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        allSelected ? new Set() : new Set(filteredPosts.map(p => p.id))
                      )
                    }
                    className={buttonClassName({
                      variant: 'secondary',
                      size: 'sm',
                      className: FOCUS_RING
                    })}
                  >
                    <SquareCheck aria-hidden className="h-3.5 w-3.5" />
                    {allSelected ? 'Unselect all' : `Select all ${filteredPosts.length}`}
                  </button>
                  <button
                    type="button"
                    disabled={selectedIds.length === 0}
                    onClick={() => setPendingDelete(selectedIds)}
                    className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500/50 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-[#1b1b1f]"
                  >
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    {allSelected && selectedIds.length > 1
                      ? `Delete all ${selectedIds.length}`
                      : `Delete ${selectedIds.length}`}
                  </button>
                  <button
                    type="button"
                    onClick={stopSelecting}
                    aria-label="Stop selecting"
                    title="Stop selecting"
                    className={cn(
                      'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg',
                      FOCUS_RING
                    )}
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

/** What a card or row can do; the list passes the same to both. */
type PostItemProps = {
  post: PostDetail
  href: string
  /** Relative wording ("6h ago") only once mounted, as it depends on now. */
  mounted: boolean
  busy: boolean
  /** Its Approve is on its way to the server. */
  approving: boolean
  /** Awaiting review: Approve and Reject are offered on it. */
  reviewable: boolean
  onCopy: () => void
  onToggleHidden: () => void
  onDelete: () => void
  onApprove: () => void
  onReject: () => void
  /** Select mode: it shows a checkbox, and a click ticks it instead of opening the post. */
  selecting: boolean
  selected: boolean
  onSelectChange: (selected: boolean) => void
}

/**
 * A post image, loaded once the card scrolls near the screen. The list ships
 * without image bytes (they can be large), so each comes from the media
 * route, once per image for the whole visit.
 */
const thumbnailCache = new Map<string, { at: number; url: Promise<string | null> }>()
/** Signed image links expire; one is reused for this long. */
const THUMBNAIL_TTL_MS = 45 * 60_000
function loadThumbnail(endpoint: string): Promise<string | null> {
  const cached = thumbnailCache.get(endpoint)
  let pending =
    cached && Date.now() - cached.at < THUMBNAIL_TTL_MS ? cached.url : null
  if (!pending) {
    pending = fetch(endpoint)
      .then(res => res.json())
      .then(body =>
        body?.success && typeof body.imageUrl === 'string' ? body.imageUrl : null
      )
      .catch(() => null)
      .then(url => {
        // A failure is tried again next time the image is shown.
        if (!url) thumbnailCache.delete(endpoint)
        return url
      })
    thumbnailCache.set(endpoint, { at: Date.now(), url: pending })
  }
  return pending
}

/**
 * Where a post's card picture comes from: its first slide when it goes out as
 * a carousel, else its image; null when it has neither.
 */
function thumbnailSourceOf(
  post: PostDetail
): { endpoint: string; whole: boolean } | null {
  const media = resolveMediaFormat(formatOf(post.formatId), post.mediaFormat, {
    image: Boolean(post.media)
  })
  if (media === 'carousel' && (post.slideCount ?? 0) > 0) {
    return { endpoint: `/api/posts/${post.id}/slides?cover`, whole: true }
  }
  if (post.media?.id) return { endpoint: `/api/media/${post.media.id}`, whole: false }
  return null
}

function Thumbnail({
  endpoint,
  alt,
  className,
  whole = false
}: {
  /** The route answering { success, imageUrl } for the picture. */
  endpoint: string
  alt: string
  className?: string
  /**
   * Show all of it (a 4:5 slide in a wide frame) over a blurred copy of
   * itself, instead of cropping it to fill.
   */
  whole?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // A link that no longer loads (expired) is fetched again, once.
  const [retried, setRetried] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let cancelled = false
    // The list scrolls inside its own box, which is the root to measure
    // against for the margin to start loading just before a card shows.
    const root = element.closest<HTMLElement>('[data-posts-scroll]')
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return
        observer.disconnect()
        void loadThumbnail(endpoint).then(loaded => {
          if (cancelled) return
          if (loaded) setUrl(loaded)
          else setFailed(true)
        })
      },
      { root, rootMargin: '300px' }
    )
    observer.observe(element)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [endpoint])
  return (
    <div ref={ref} className={`bg-surface-hover relative overflow-hidden ${className ?? ''}`}>
      {url && whole && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl"
        />
      )}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          className={`relative h-full w-full ${whole ? 'object-contain' : 'object-cover'}`}
          onError={() => {
            thumbnailCache.delete(endpoint)
            setUrl(null)
            if (retried) {
              setFailed(true)
              return
            }
            setRetried(true)
            void loadThumbnail(endpoint).then(loaded =>
              loaded ? setUrl(loaded) : setFailed(true)
            )
          }}
        />
      ) : (
        <div className="text-muted flex h-full w-full items-center justify-center">
          {failed ? (
            <ImageOff className="h-5 w-5" />
          ) : (
            <ImageIcon className="h-5 w-5 animate-pulse" />
          )}
        </div>
      )}
    </div>
  )
}

/** The badge on a card's picture: what kind of media the post carries. */
function mediaBadge(post: PostDetail): { label: string; video: boolean } | null {
  const spec = FORMATS[formatOf(post.formatId)]
  if (spec.structure === 'script') {
    const seconds = videoScriptOf(post).seconds
    const kind = spec.platform === 'youtube' ? 'Short' : 'Reel'
    const length = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    return { label: `${length} ${kind}`, video: true }
  }
  // What goes out with the text (resolveMediaFormat): only a carousel's
  // slides need saying.
  const media = resolveMediaFormat(formatOf(post.formatId), post.mediaFormat, {
    image: Boolean(post.media)
  })
  if (media === 'carousel') {
    const count = post.slideCount ?? 0
    return { label: count ? `${count} slides` : 'Carousel', video: false }
  }
  // A single image says so itself.
  return null
}

/** What a card with no picture says in its place: what it goes out with. */
function placeholderLabel(post: PostDetail): string {
  const format = formatOf(post.formatId)
  if (FORMATS[format].structure === 'script') return 'Video script'
  const media = resolveMediaFormat(format, post.mediaFormat, {
    image: Boolean(post.media)
  })
  if (media === 'text') return 'Text only'
  return media === 'carousel' ? 'No slides yet' : 'No image yet'
}

/**
 * Where the post goes next, as the card's footer action: live (with its
 * link), when it goes out, or what to do — publish, edit, revisit. A post
 * awaiting review has ReviewButtons instead, and one publishing right now
 * nothing (its status says so).
 */
function PostAction({
  post,
  href,
  mounted
}: {
  post: PostDetail
  href: string
  mounted: boolean
}) {
  const publication = post.publication
  const platform = getPlatform(post.platform)
  const live = Boolean(post.postedAt) || isOnPlatform(publication)
  const action = cn(
    'relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors',
    FOCUS_RING
  )
  const outlined = cn(
    action,
    'border-border bg-surface text-foreground hover:bg-surface-hover border'
  )
  if (live) {
    const label = `Live on ${LIVE_ON[post.platform] ?? platform.name}`
    return publication?.postUrl && !publication.deletedAt ? (
      <a
        href={publication.postUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open it on ${platform.name}`}
        className={cn(action, TONES.success.text, 'hover:bg-emerald-500/10')}
      >
        {label}
        <ExternalLink aria-hidden className="h-3 w-3" />
      </a>
    ) : (
      <span className={cn(action, TONES.success.text)}>{label}</span>
    )
  }
  if (publication?.status === 'publishing') return null
  if (publication?.status === 'scheduled') {
    const at = queuedAt(publication)
    return (
      <span
        className={cn(action, TONES.brand.text, 'px-1 font-medium tabular-nums')}
        title={mounted ? `Publishes ${formatAbsoluteDateTime(at)}` : undefined}
      >
        <CalendarClock aria-hidden className="h-3.5 w-3.5" />
        {mounted ? shortDateTime(at) : ''}
      </span>
    )
  }
  if (post.status === 'approved') {
    const failed = publication?.status === 'failed'
    return (
      <Link
        href={href}
        className={
          failed
            ? cn(
                action,
                'border border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400'
              )
            : outlined
        }
      >
        {failed
          ? 'Retry publish'
          : canPublishFormat(post.platform, formatOf(post.formatId))
            ? 'Publish Now'
            : 'Copy & post'}
        <ArrowRight aria-hidden className="h-3.5 w-3.5" />
      </Link>
    )
  }
  if (post.status === 'draft') {
    return (
      <Link href={href} className={outlined}>
        Continue Edit
      </Link>
    )
  }
  if (post.status === 'rejected') {
    return (
      <Link
        href={href}
        className={cn(action, 'text-muted hover:text-foreground hover:bg-surface-hover')}
      >
        Revisit
      </Link>
    )
  }
  return (
    <Link href={href} className={cn(action, 'border', TONES.warning.chip)}>
      Review
      <ArrowRight aria-hidden className="h-3.5 w-3.5" />
    </Link>
  )
}

/**
 * Approve on a post awaiting review, without opening it: the post page's
 * action, with its messages. The card's one accent button; Reject, which asks
 * for an optional reason, is in the ⋮ menu. Named after its post for screen
 * readers, as many cards have one.
 */
function ApproveButton({
  post,
  busy,
  approving,
  onApprove,
  size = 'md'
}: Pick<PostItemProps, 'post' | 'busy' | 'approving' | 'onApprove'> & {
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      onClick={onApprove}
      disabled={busy}
      aria-label={`Approve: ${post.hook}`}
      className={cn(
        'bg-accent text-background hover:bg-accent-hover pointer-events-auto relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS_RING,
        size === 'sm' ? 'h-7 px-2.5' : 'h-8 px-3'
      )}
    >
      {approving ? (
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Check aria-hidden className="h-3.5 w-3.5" />
      )}
      Approve
    </button>
  )
}

/**
 * The card's one figure (length), with what the post cost in AI in its
 * tooltip: the post page has the breakdown.
 */
/**
 * The format without its platform's name ("Post", "Thread", "Reel"), for a
 * card's header: the platform's mark beside it already names the platform,
 * and the full label did not fit beside the status.
 */
function formatKind(post: PostDetail): string {
  const label = FORMATS[formatOf(post.formatId)].label
  const platform = getPlatform(post.platform).name
  const kind = label.startsWith(`${platform} `)
    ? label.slice(platform.length + 1)
    : label
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

function postFigure(post: PostDetail): { text: string; title: string } {
  const spec = FORMATS[formatOf(post.formatId)]
  const text =
    spec.structure === 'script'
      ? `~${videoScriptOf(post).seconds}s`
      : `${post.charCount.toLocaleString('en-US')} chars`
  const usage = post.usage
  const cost = usage
    ? ` · AI cost ${formatPostCost(usage.costUsd)}${usage.estimated ? ' (partly estimated)' : ''}, ${formatTokens(usage.totalTokens)} tokens`
    : ''
  return {
    text,
    title: `${spec.structure === 'script' ? 'Script length' : 'Length'}${cost}`
  }
}

/** The ⋮ menu on a card or row: open, approve or reject one awaiting review, copy, hide, delete. */
function PostMenu({
  post,
  href,
  busy,
  reviewable,
  onCopy,
  onToggleHidden,
  onDelete,
  onApprove,
  onReject
}: Pick<
  PostItemProps,
  | 'post'
  | 'href'
  | 'busy'
  | 'reviewable'
  | 'onCopy'
  | 'onToggleHidden'
  | 'onDelete'
  | 'onApprove'
  | 'onReject'
>) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])
  const item =
    'hover:bg-surface-hover focus-visible:bg-surface-hover flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40'
  const run = (action: () => void, refocus = true) => () => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
    action()
  }
  return (
    <div
      ref={wrapper}
      // Above the cards and rows after it while open.
      className={`relative ${open ? 'z-20' : 'z-10'}`}
      onBlur={e => {
        if (!wrapper.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={`More actions for: ${post.hook}`}
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'text-muted hover:text-foreground hover:bg-surface-hover flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:opacity-40',
          FOCUS_RING
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        ) : (
          <MoreVertical aria-hidden className="h-4 w-4" />
        )}
      </button>
      {open && (
        <div className="border-border bg-surface text-foreground absolute top-full right-0 z-30 mt-1 w-44 rounded-xl border p-1 shadow-lg">
          <Link href={href} className={item}>
            <ArrowRight aria-hidden className="text-muted h-3.5 w-3.5" />
            Open post
          </Link>
          {reviewable && (
            <>
              <button type="button" onClick={run(onApprove)} className={item}>
                <CheckCircle2 aria-hidden className="text-muted h-3.5 w-3.5" />
                Approve
              </button>
              {/* The reason dialog takes focus, and hands it back to ⋮. */}
              <button type="button" onClick={run(onReject)} className={item}>
                <XCircle aria-hidden className="text-muted h-3.5 w-3.5" />
                Reject…
              </button>
              <div role="separator" className="bg-border mx-1.5 my-1 h-px" />
            </>
          )}
          <button type="button" onClick={run(onCopy)} className={item}>
            <Copy aria-hidden className="text-muted h-3.5 w-3.5" />
            Copy text
          </button>
          <button type="button" onClick={run(onToggleHidden)} className={item}>
            {post.hiddenAt ? (
              <Eye aria-hidden className="text-muted h-3.5 w-3.5" />
            ) : (
              <EyeOff aria-hidden className="text-muted h-3.5 w-3.5" />
            )}
            {post.hiddenAt ? 'Unhide' : 'Hide'}
          </button>
          <button
            type="button"
            // The server refuses too: it may be on its platform any moment.
            disabled={post.publication?.status === 'publishing'}
            // The confirm dialog takes focus.
            onClick={run(onDelete, false)}
            className={`${item} text-rose-600 hover:bg-rose-500/10 focus-visible:bg-rose-500/10 dark:text-rose-400`}
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The whole card opens the post: a link stretched over it, with the menu and
 * footer action above it. While selecting, a click ticks the card instead; its
 * checkbox is the control keyboards and screen readers use.
 */
function CardCover({
  post,
  href,
  selecting,
  selected,
  onSelectChange
}: Pick<PostItemProps, 'post' | 'href' | 'selecting' | 'selected' | 'onSelectChange'>) {
  if (selecting) {
    return (
      <div
        aria-hidden
        onClick={() => onSelectChange(!selected)}
        className="absolute inset-0 z-0 cursor-pointer rounded-[inherit]"
      />
    )
  }
  return (
    <Link
      href={href}
      aria-label={`Open: ${post.hook}`}
      className={cn('absolute inset-0 z-0 rounded-[inherit]', FOCUS_RING)}
    />
  )
}

/** A card's or row's checkbox while selecting. */
function SelectBox({
  post,
  selected,
  onSelectChange,
  className
}: Pick<PostItemProps, 'post' | 'selected' | 'onSelectChange'> & { className?: string }) {
  return (
    <input
      type="checkbox"
      checked={selected}
      onChange={e => onSelectChange(e.target.checked)}
      aria-label={`Select: ${post.hook}`}
      className={cn(
        'accent-accent pointer-events-auto h-4 w-4 shrink-0 cursor-pointer',
        FOCUS_RING,
        className
      )}
    />
  )
}

/**
 * One post as a card: platform and status, picture, opening, tags, then a
 * footer of three things: when it was drafted, its length, and what comes
 * next (Approve while it awaits review).
 */
function PostCard(props: PostItemProps) {
  const { post, href, mounted, reviewable, selecting, selected } = props
  const format = formatOf(post.formatId)
  const spec = FORMATS[format]
  const badge = mediaBadge(post)
  const picture = thumbnailSourceOf(post)
  const figure = postFigure(post)
  return (
    <article
      className={cn(
        'group bg-surface relative flex flex-col rounded-2xl border shadow-xs transition-[border-color,box-shadow] hover:shadow-sm motion-reduce:transition-none',
        selecting && selected
          ? 'border-brand/60 ring-brand/20 ring-2'
          : 'border-border hover:border-foreground/20'
      )}
    >
      <CardCover {...props} />

      <div className="pointer-events-none relative flex items-center gap-2 px-4 pt-4">
        {selecting && <SelectBox {...props} />}
        <PlatformMark platform={post.platform} colored className="h-5 w-5 shrink-0" />
        <span
          className="text-foreground min-w-0 truncate text-[13px] font-semibold"
          title={spec.label}
        >
          <span className="sr-only">{getPlatform(post.platform).name} </span>
          {formatKind(post)}
        </span>
        <PostStatusPill post={post} className="ml-auto" />
        <span className="pointer-events-auto -mr-1.5">
          <PostMenu {...props} />
        </span>
      </div>

      <div className="pointer-events-none px-4 pt-3">
       <div className="relative">
        {/* Deleted from its platform: a red tag on the picture's top right. */}
        <DeletedFromPlatformTag
          post={post}
          className="absolute top-2 right-2 z-10 bg-white/95 shadow-sm dark:bg-neutral-900/90"
        />
        {picture ? (
          <Thumbnail
            endpoint={picture.endpoint}
            whole={picture.whole}
            alt={post.media?.altText || post.hook}
            className="aspect-5/2 w-full rounded-lg"
          />
        ) : (
          <div className="bg-surface-hover text-muted flex aspect-5/2 w-full flex-col items-center justify-center gap-1.5 rounded-lg">
            {spec.structure === 'script' ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
                <Play aria-hidden className="ml-0.5 h-4 w-4 fill-current" />
              </span>
            ) : (
              <PlatformMark platform={post.platform} className="h-6 w-6 opacity-40" />
            )}
            <span className="text-xs">{placeholderLabel(post)}</span>
          </div>
        )}
        {badge && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {!badge.video && <Layers aria-hidden className="h-3 w-3" />}
            {badge.label}
          </span>
        )}
        {badge?.video && picture && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
              <Play aria-hidden className="ml-0.5 h-4 w-4 fill-current" />
            </span>
          </span>
        )}
       </div>
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col px-4 pt-3 pb-4">
        <h3 className="text-foreground line-clamp-2 text-sm leading-snug font-semibold">
          {post.hook}
        </h3>
        {post.body && (
          <p className="text-muted mt-1 line-clamp-2 text-[13px] leading-relaxed">
            {post.body}
          </p>
        )}
      </div>

      {/* Footer: when, and what next. Its length and AI cost are on the
          time's hover; beside the action they were cut short. */}
      <div className="border-border pointer-events-none relative mt-auto flex items-center gap-3 border-t px-4 py-3">
        <div className="text-muted flex min-w-0 flex-1 items-center gap-3 text-xs whitespace-nowrap tabular-nums">
          {/* Times only once mounted, in the viewer's own time zone; the
              exact one on hover. */}
          <span
            className="pointer-events-auto flex items-center gap-1.5"
            title={
              mounted
                ? `${formatAbsoluteDateTime(post.createdAt)} · ${figure.text} · ${figure.title}`
                : undefined
            }
          >
            <Clock aria-hidden className="h-3.5 w-3.5" />
            {mounted ? shortAgo(post.createdAt) : ''}
          </span>
        </div>
        <span className="pointer-events-auto shrink-0">
          {reviewable ? (
            <ApproveButton {...props} />
          ) : (
            <PostAction post={post} href={href} mounted={mounted} />
          )}
        </span>
      </div>
    </article>
  )
}

/** One post as a row, for the list view: the card's facts in a line. */
function PostRow(props: PostItemProps) {
  const { post, href, mounted, reviewable, selecting, selected } = props
  const spec = FORMATS[formatOf(post.formatId)]
  const picture = thumbnailSourceOf(post)
  const figure = postFigure(post)
  return (
    <div
      className={cn(
        'group relative flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-2xl last:rounded-b-2xl motion-reduce:transition-none',
        selecting && selected ? 'bg-brand/5' : 'hover:bg-surface-hover/50'
      )}
    >
      <CardCover {...props} />
      {selecting && <SelectBox {...props} className="relative" />}
      <div className="pointer-events-none relative shrink-0">
        {picture ? (
          <Thumbnail
            endpoint={picture.endpoint}
            whole={picture.whole}
            alt={post.media?.altText || post.hook}
            className="h-12 w-20 rounded-lg"
          />
        ) : (
          <div className="bg-surface-hover flex h-12 w-20 items-center justify-center rounded-lg">
            <PlatformMark platform={post.platform} className="text-muted h-4 w-4 opacity-50" />
          </div>
        )}
      </div>
      <div className="pointer-events-none relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PlatformMark platform={post.platform} colored className="h-4 w-4 shrink-0" />
          <span className="text-muted shrink-0 text-xs font-medium">{spec.label}</span>
          <span className="text-foreground truncate text-[13px] font-semibold">
            {post.hook}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {/* Its own column from @2xl; on a narrow list, here. */}
          <PostStatusPill post={post} size="xs" className="@2xl:hidden" />
          <p className="text-muted truncate text-[13px]">{post.body}</p>
        </div>
      </div>
      <span className="pointer-events-none relative hidden shrink-0 @2xl:flex">
        <PostStatusPill post={post} />
      </span>
      <span
        className="text-muted pointer-events-auto relative hidden w-20 shrink-0 text-right text-xs tabular-nums @3xl:block"
        title={
          mounted
            ? `${formatAbsoluteDateTime(post.createdAt)} · ${figure.text} · ${figure.title}`
            : undefined
        }
      >
        {mounted ? shortAgo(post.createdAt) : ''}
      </span>
      <span className="relative hidden shrink-0 @4xl:block">
        {reviewable ? (
          <ApproveButton {...props} size="sm" />
        ) : (
          <PostAction post={post} href={href} mounted={mounted} />
        )}
      </span>
      <PostMenu {...props} />
    </div>
  )
}

/** What the Filters menu sets; status, platform and sort have their own controls. */
type PostFilters = {
  /** yyyy-mm-dd; empty means that end is open. */
  from: string
  to: string
  /** Only the posts hidden from the list. */
  hidden: boolean
}

const DEFAULT_FILTERS: PostFilters = {
  from: '',
  to: '',
  hidden: false
}

const filterFieldClass =
  'border-border bg-surface text-foreground focus:border-accent w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs outline-none'

/**
 * The Filters button and its panel. Choices are only a draft until Apply, so
 * the list does not jump around while they are being set.
 *
 * The toolbar can scroll sideways, which would clip an absolutely placed
 * panel, so the panel is portalled to the body and placed against the window.
 */
function PostFiltersMenu({
  value,
  today,
  onApply
}: {
  value: PostFilters
  /** Latest pickable day; unset until mounted, as "today" differs by timezone. */
  today?: string
  onApply: (next: PostFilters) => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<PostFilters>(value)
  const [dateError, setDateError] = useState<string | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const activeCount = (value.from || value.to ? 1 : 0) + (value.hidden ? 1 : 0)

  const place = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(320, window.innerWidth - 32)
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
    })
  }

  const openMenu = () => {
    setDraft(value)
    setDateError(null)
    place()
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [open])

  const set = (next: Partial<PostFilters>) => {
    setDraft(prev => ({ ...prev, ...next }))
    setDateError(null)
  }

  // The browser's own checks would block Apply silently for a half-typed
  // date, so the form skips them and explains the problem here instead.
  const apply = () => {
    if (fromRef.current?.validity.badInput || toRef.current?.validity.badInput) {
      setDateError('Finish typing the date, or clear it.')
      return
    }
    if (draft.from && draft.to && draft.from > draft.to) {
      setDateError('From must be on or before To.')
      return
    }
    if (today && (draft.from > today || draft.to > today)) {
      setDateError('Dates can’t be in the future.')
      return
    }
    onApply(draft)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors',
          FOCUS_RING,
          activeCount > 0
            ? 'border-accent/60 bg-surface text-foreground'
            : 'border-border bg-surface text-foreground hover:bg-surface-hover'
        )}
      >
        <Funnel aria-hidden className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="bg-foreground/10 text-foreground flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums">
            {activeCount}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <>
            <div
              aria-hidden
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <form
              role="dialog"
              aria-label="Filter posts"
              style={{ top: position.top, left: position.left }}
              // Escape closes the panel, and keys typed here go no further.
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Escape') setOpen(false)
              }}
              noValidate
              onSubmit={e => {
                e.preventDefault()
                apply()
              }}
              className="border-border bg-surface fixed z-50 w-[min(20rem,calc(100vw-2rem))] space-y-4 rounded-xl border p-4 shadow-lg"
            >
              {/* Each end limits the other, so From can never be after To. */}
              <fieldset className="space-y-1.5">
                <legend className="text-foreground mb-1.5 text-xs font-semibold">
                  Date range
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="filter-from" className="text-muted block text-xs">
                      From
                    </label>
                    <input
                      ref={fromRef}
                      id="filter-from"
                      type="date"
                      autoFocus
                      value={draft.from}
                      max={draft.to || today}
                      onChange={e => set({ from: e.target.value })}
                      className={filterFieldClass}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="filter-to" className="text-muted block text-xs">
                      To
                    </label>
                    <input
                      ref={toRef}
                      id="filter-to"
                      type="date"
                      value={draft.to}
                      min={draft.from || undefined}
                      max={today}
                      onChange={e => set({ to: e.target.value })}
                      className={filterFieldClass}
                    />
                  </div>
                </div>
                {dateError && (
                  <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                    {dateError}
                  </p>
                )}
              </fieldset>

              <label className="text-foreground flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={draft.hidden}
                  onChange={e => set({ hidden: e.target.checked })}
                  className="accent-accent mt-0.5"
                />
                <span className="font-semibold" title="Only the posts hidden from the list">
                  Hidden posts
                </span>
              </label>

              <div className="border-border flex items-center justify-between gap-2 border-t pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setDraft(DEFAULT_FILTERS)
                    setDateError(null)
                  }}
                  className="text-muted hover:text-foreground cursor-pointer text-xs font-medium"
                >
                  Reset
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="border-border text-foreground hover:bg-surface-hover cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="bg-accent hover:bg-accent-hover text-background cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold shadow-xs"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </form>
          </>,
          document.body
        )}
    </>
  )
}

export function PostsClient({
  initialPosts,
  initialNextCursor,
  totalCount,
  identity,
  enabledFormats
}: {
  initialPosts: PostDetail[]
  initialNextCursor: string | null
  totalCount: number
  identity: IdentitySummary
  enabledFormats?: FormatId[]
}) {
  return (
    <Suspense
      fallback={
        <div className="bg-background flex min-h-0 flex-1 items-center justify-center">
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="text-accent h-8 w-8 animate-spin" />
            <p className="text-muted text-sm font-medium">Loading posts...</p>
          </div>
        </div>
      }
    >
      <PostsClientInner
        initialPosts={initialPosts}
        initialNextCursor={initialNextCursor}
        totalCount={totalCount}
        identity={identity}
        enabledFormats={enabledFormats}
      />
    </Suspense>
  )
}
