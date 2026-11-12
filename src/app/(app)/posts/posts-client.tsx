'use client'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  copyText,
  FORMATS,
  formatOf,
  videoScriptOf,
  type FormatId
} from '@/lib/formats'
import { MobileNavButton } from '@/components/mobile-nav'
import { PlatformMark } from '@/components/platform-mark'
import { markDataChanged } from '@/components/refresh-on-back'
import { ThemeToggle } from '@/components/theme-toggle'
import { showToast } from '@/components/toast-notification'
import type { LintFinding } from '@/lib/lint/run-linter'
import type { IdentitySummary } from '@/lib/identity'
import { PAGE_SIZE, pageNumbers, paginate, parsePage } from '@/lib/pagination'
import { getPlatform, PLATFORM_IDS, type PlatformId } from '@/lib/platforms'
import { platformPostText } from '@/lib/post-text'
import { canPublishFormat } from '@/lib/publishing/platform'
import type { BackgroundPattern } from '@/lib/brand/theme'
import Link from 'next/link'
import {
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Eye,
  EyeOff,
  FileCheck,
  Funnel,
  Image as ImageIcon,
  ImageOff,
  LayoutGrid,
  List,
  Loader2,
  MoreVertical,
  Play,
  Plus,
  Search,
  Trash2,
  X
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
  deleteDraft,
  loadMorePosts,
  setDraftHidden
} from './actions'
import type { PublicationSummary } from '@/lib/publishing/engine'
import { formatAbsoluteDateTime, formatRelativeDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { LIST_PARAMS } from './list-params'
import { PostStatusPill } from './post-status'

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
 * The status chips. Each post is in exactly one, so they add up to All:
 * Published is live on its platform; Approved is approved and not live yet
 * (waiting, scheduled or publishing).
 */
type StatusFilter =
  | 'all'
  | 'awaiting_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'draft'
type SortOrder = 'newest' | 'oldest'
type ViewMode = 'grid' | 'list'

const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'awaiting_review',
  'approved',
  'published',
  'rejected',
  'draft'
]

/** Each status chip's label, dot, and look when picked (as on PostStatusPill). */
const STATUS_CHIPS: Record<
  StatusFilter,
  { label: string; dot: string | null; active: string }
> = {
  all: {
    label: 'All',
    dot: null,
    active: 'border-foreground/25 bg-surface-hover text-foreground'
  },
  awaiting_review: {
    label: 'Awaiting review',
    dot: 'bg-amber-500',
    active:
      'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400'
  },
  approved: {
    label: 'Approved',
    dot: 'bg-indigo-500',
    active:
      'border-indigo-500/50 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
  },
  published: {
    label: 'Published',
    dot: 'bg-emerald-500',
    active:
      'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  },
  rejected: {
    label: 'Rejected',
    dot: 'bg-rose-500',
    active: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400'
  },
  draft: {
    label: 'Drafts',
    dot: 'bg-zinc-400',
    active: 'border-zinc-400/50 bg-zinc-400/10 text-foreground'
  }
}

/** Which status chip a post is under. */
function statusOf(post: PostDetail): Exclude<StatusFilter, 'all'> {
  if (post.postedAt || post.publication?.status === 'published') {
    return 'published'
  }
  if (post.status === 'approved') return 'approved'
  if (post.status === 'rejected') return 'rejected'
  if (post.status === 'draft') return 'draft'
  return 'awaiting_review'
}

/** A platform's own colour on its tab when picked. */
const PLATFORM_TINTS: Partial<Record<PlatformId, { tab: string; count: string }>> = {
  linkedin: {
    tab: 'border-[#0a66c2]/60 bg-[#0a66c2]/10',
    count: 'bg-[#0a66c2]/20 text-foreground'
  },
  instagram: {
    tab: 'border-[#e1306c]/60 bg-[#e1306c]/10',
    count: 'bg-[#e1306c]/20 text-foreground'
  },
  facebook: {
    tab: 'border-[#1877f2]/60 bg-[#1877f2]/10',
    count: 'bg-[#1877f2]/20 text-foreground'
  },
  youtube: {
    tab: 'border-[#ff0033]/60 bg-[#ff0033]/10',
    count: 'bg-[#ff0033]/20 text-foreground'
  }
}
const NEUTRAL_TINT = {
  tab: 'border-foreground/30 bg-surface-hover',
  count: 'bg-foreground/10 text-foreground'
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
      p =>
        Boolean(p.hiddenAt) === hidden &&
        (status === 'all' || statusOf(p) === status)
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

  // Each chip's and tab's count has the other row's choice applied, so it
  // says what picking it would show.
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: 0,
      awaiting_review: 0,
      approved: 0,
      published: 0,
      rejected: 0,
      draft: 0
    }
    for (const p of platformPosts) {
      if (Boolean(p.hiddenAt) !== showHidden) continue
      counts.all++
      counts[statusOf(p)]++
    }
    return counts
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

  // Delete (card menu) asks first.
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const confirmDelete = async () => {
    if (!pendingDelete) return
    const ids = pendingDelete
    setIsDeleting(true)
    markBusy(ids, true)
    markDataChanged()
    const deleted: string[] = []
    const failures: string[] = []
    for (const id of ids) {
      const res = await deleteDraft(id, { alsoFromPlatform: false }).catch(
        (err: any) => ({ success: false as const, error: err?.message as string })
      )
      if (res.success) deleted.push(id)
      else failures.push(res.error || 'Failed to delete the post')
    }
    removePosts(deleted)
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

  const cardProps = (post: PostDetail) => ({
    post,
    href: postHref(post.id),
    mounted: hasMounted,
    busy: busyIds.has(post.id),
    onCopy: () => void copyPostText(post),
    onToggleHidden: () => void toggleHidden(post),
    onDelete: () => setPendingDelete([post.id])
  })

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
            <div className="flex flex-col items-center gap-2 pt-2 text-center">
              <p className="text-muted text-[11px] leading-relaxed">
                Search and filters cover the posts loaded so far.
              </p>
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
                className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 text-[12px] font-medium transition-colors disabled:opacity-60"
              >
                {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Load older posts
              </button>
            </div>
    ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.length === 1
              ? 'Delete this post?'
              : `Delete ${pendingDelete.length} posts?`
          }
          description={
            <>
              {pendingDelete.length === 1 ? 'It is' : 'They are'} removed from
              the app for good, with images and alternates. This cannot be
              undone. Scheduled publishing is cancelled; anything already
              published stays on its platform.
            </>
          }
          confirmLabel={pendingDelete.length === 1 ? 'Delete post' : 'Delete posts'}
          pendingLabel="Deleting…"
          pending={isDeleting}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
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
                <span className="border-border bg-surface-hover text-foreground rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums">
                  {totalCount - deletedCount} total
                </span>
              </div>
              <p className="text-muted mt-1.5 max-w-3xl text-[15px] leading-relaxed">
                Posts drafted for 
                <span className="text-foreground font-medium">
                  {''} @{identity.handle}
                </span>
                . Review, add media, and publish to your channels.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              href="/ideas"
              title="Posts are drafted from ideas: approve one to draft its post"
              className="bg-accent text-background hover:bg-accent-hover flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold shadow-xs transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Create Post</span>
            </Link>
              <ThemeToggle />
            </div>
          </div>

          {/* PLATFORM TABS: one platform's posts, or every platform's */}
          <div
            role="group"
            aria-label="Show posts for one platform"
            className="border-border flex flex-wrap gap-2 border-b pb-3"
          >
            {[null, ...platformOptions].map(option => {
              const active = platformFilter === option
              const tint = option ? (PLATFORM_TINTS[option] ?? NEUTRAL_TINT) : NEUTRAL_TINT
              const count = option
                ? (platformCounts.counts.get(option) ?? 0)
                : platformCounts.all
              return (
                <button
                  key={option ?? 'all'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilters({ platform: option })}
                  className={`flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
                    active
                      ? `${tint.tab} text-foreground font-semibold`
                      : 'border-border bg-surface text-muted hover:text-foreground hover:bg-surface-hover'
                  }`}
                >
                  {option ? (
                    <PlatformMark platform={option} colored className="h-4 w-4 shrink-0" />
                  ) : (
                    <LayoutGrid className="h-4 w-4 shrink-0" />
                  )}
                  {option
                    ? option === 'x'
                      ? 'Twitter/X'
                      : getPlatform(option).name
                    : 'All platforms'}
                  <span
                    className={`rounded-md px-1.5 text-[11px] leading-5 font-medium tabular-nums ${
                      active ? tint.count : 'bg-surface-hover text-muted'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* STATUS CHIPS, then search, Filters, Sort and the view */}
          <div className="flex flex-col gap-3 @min-[60rem]:flex-row @min-[60rem]:items-center @min-[60rem]:justify-between">
            <div
              role="group"
              aria-label="Show posts by status"
              className="border-border bg-surface flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border p-1.5 @min-[60rem]:min-w-0"
            >
              {STATUS_FILTERS.map(status => {
                const chip = STATUS_CHIPS[status]
                const active = statusFilter === status
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setFilters({
                        status: status === 'all' ? null : status,
                        // An older link's ?status=hidden stays in hidden mode.
                        ...(searchParams.get('status') === 'hidden'
                          ? { hidden: '1' }
                          : {})
                      })
                    }
                    className={`flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
                      active
                        ? chip.active
                        : 'text-muted hover:text-foreground border-transparent'
                    }`}
                  >
                    {chip.dot && (
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} />
                    )}
                    {chip.label}
                    <span
                      className={`text-[11px] tabular-nums ${active ? 'opacity-80' : 'text-muted'}`}
                    >
                      {statusCounts[status]}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 @min-[60rem]:shrink-0 @min-[60rem]:flex-nowrap">
              <div className="relative min-w-48 flex-1 @min-[60rem]:w-56 @min-[60rem]:flex-none">
                <Search className="text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  ref={searchRef}
                  type="search"
                  value={searchQuery}
                  onChange={e => changeSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && e.currentTarget.blur()}
                  placeholder="Search posts..."
                  aria-label="Search posts"
                  className="border-border bg-surface text-foreground placeholder:text-muted focus:border-accent h-9 w-full rounded-lg border pr-14 pl-9 text-[13px] outline-none"
                />
                <kbd className="text-muted pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 font-sans text-[11px] @lg:block">
                  {isMac ? '⌘K' : 'Ctrl K'}
                </kbd>
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
              <label className="border-border bg-surface text-muted focus-within:border-accent relative flex h-9 items-center gap-2 rounded-lg border pr-2.5 pl-3 text-[13px]">
                Sort:
                <select
                  value={sortOrder}
                  onChange={e =>
                    setFilters({ sort: e.target.value === 'oldest' ? 'oldest' : null })
                  }
                  className="text-foreground cursor-pointer appearance-none bg-transparent pr-6 font-medium outline-none"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
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
                {(
                  [
                    { value: 'grid', label: 'Cards', Icon: LayoutGrid },
                    { value: 'list', label: 'List', Icon: List }
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    aria-label={`${label} view`}
                    title={`${label} view`}
                    onClick={() =>
                      writeParams({ view: value === 'list' ? 'list' : null }, 'replace')
                    }
                    className={`flex h-full w-8 cursor-pointer items-center justify-center rounded-md transition-colors ${
                      view === value
                        ? 'bg-surface-hover text-foreground'
                        : 'text-muted hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* What is showing, and what is loaded */}
          <div className="text-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {showHidden && (
                <>
                  <span aria-hidden>•</span>
                  <span className="text-foreground font-medium">Hidden posts</span>
                </>
              )}
              {filterRunId && (
                <>
                  <span aria-hidden>•</span>
                  <span className="text-foreground font-medium">One run</span>
                </>
              )}
              {(hasActiveFilters || filterRunId) && (
                <>
                  <span aria-hidden>•</span>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="hover:text-foreground flex cursor-pointer items-center gap-1"
                  >
                    <X className="h-3.5 w-3.5" />
                    {filterRunId ? 'Show all posts' : 'Clear filters'}
                  </button>
                </>
              )}
            </div>
          </div>

          {sortOrder === 'oldest' && loadOlder}

          {filteredPosts.length === 0 ? (
            <div className="border-border bg-surface rounded-2xl border-2 border-dashed px-4 py-14 text-center">
              {posts.length === 0 ? (
                <>
                  <FileCheck className="text-muted mx-auto mb-3 h-10 w-10" />
                  <h3 className="text-foreground text-sm font-semibold">
                    No drafted posts yet
                  </h3>
                  <p className="text-muted mx-auto mt-1 max-w-sm text-xs">
                    Approve concepts on the Ideas page to draft grounded posts.
                  </p>
                  <Link
                    href="/ideas"
                    className="bg-accent text-background mt-4 inline-flex h-8 items-center rounded-lg px-3.5 text-[13px] font-semibold transition-opacity hover:opacity-90"
                  >
                    Go to Ideas
                  </Link>
                </>
              ) : (
                <>
                  <Search className="text-muted mx-auto mb-3 h-10 w-10" />
                  <h3 className="text-foreground text-sm font-semibold">
                    No posts match these filters
                  </h3>
                  <p className="text-muted mx-auto mt-1 max-w-sm text-xs">
                    {posts.length} post{posts.length === 1 ? '' : 's'} exist in
                    total. Pick another platform or status, or clear the
                    filters to see them.
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="bg-surface-hover border-border text-foreground hover:bg-surface-hover/80 mt-4 h-8 cursor-pointer rounded-lg border px-3.5 text-[13px] font-semibold transition-colors"
                  >
                    Clear all filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-7 pt-1">
              {dayGroups.map((group, i) => {
                const scheduled = group.posts.filter(
                  p => p.publication?.status === 'scheduled'
                ).length
                return (
                  <section key={`${group.key}-${i}`} className="space-y-3">
                    <h2 className="flex items-center gap-3">
                      <span className="text-foreground/80 text-[13px] font-semibold tracking-wider uppercase">
                        {dayHeading(group.date, hasMounted)}
                      </span>
                      <span aria-hidden className="bg-border h-px flex-1" />
                      <span className="text-muted text-xs font-normal">
                        {group.posts.length} post{group.posts.length === 1 ? '' : 's'}
                        {scheduled > 0 && ` · ${scheduled} scheduled`}
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
                      <div className="border-border bg-surface divide-border divide-y rounded-2xl border">
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
              <p className="text-muted text-[13px]">
                Showing{' '}
                <span className="text-foreground font-semibold tabular-nums">
                  {shownFrom} to {shownTo}
                </span>{' '}
                of {pageInfo.total} total drafts &amp; posts
              </p>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <button
                  type="button"
                  disabled={pageInfo.page <= 1}
                  onClick={() => goToPage(pageInfo.page - 1)}
                  aria-label="Previous page"
                  className="border-border bg-surface text-foreground hover:bg-surface-hover disabled:text-muted flex h-8 cursor-pointer items-center rounded-lg border px-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
                >
                  <ChevronLeft className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">Previous</span>
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
                      className={`h-8 min-w-8 cursor-pointer rounded-lg px-2 text-[13px] font-semibold tabular-nums transition-colors ${
                        n === pageInfo.page
                          ? 'bg-accent text-background'
                          : 'border-border bg-surface text-foreground hover:bg-surface-hover border'
                      }`}
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
                  className="border-border bg-surface text-foreground hover:bg-surface-hover disabled:text-muted flex h-8 cursor-pointer items-center rounded-lg border px-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:px-3"
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="h-4 w-4 sm:hidden" />
                </button>
              </div>
            </nav>
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
  onCopy: () => void
  onToggleHidden: () => void
  onDelete: () => void
}

/**
 * A post image, loaded once the card scrolls near the screen. The list ships
 * without image bytes (they can be large), so each comes from the media
 * route, once per image for the whole visit.
 */
const thumbnailCache = new Map<string, { at: number; url: Promise<string | null> }>()
/** Signed image links expire; one is reused for this long. */
const THUMBNAIL_TTL_MS = 45 * 60_000
function loadThumbnail(mediaId: string): Promise<string | null> {
  const cached = thumbnailCache.get(mediaId)
  let pending =
    cached && Date.now() - cached.at < THUMBNAIL_TTL_MS ? cached.url : null
  if (!pending) {
    pending = fetch(`/api/media/${mediaId}`)
      .then(res => res.json())
      .then(body =>
        body?.success && typeof body.imageUrl === 'string' ? body.imageUrl : null
      )
      .catch(() => null)
      .then(url => {
        // A failure is tried again next time the image is shown.
        if (!url) thumbnailCache.delete(mediaId)
        return url
      })
    thumbnailCache.set(mediaId, { at: Date.now(), url: pending })
  }
  return pending
}

function Thumbnail({
  mediaId,
  alt,
  className
}: {
  mediaId: string
  alt: string
  className?: string
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
        void loadThumbnail(mediaId).then(loaded => {
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
  }, [mediaId])
  return (
    <div ref={ref} className={`bg-surface-hover relative overflow-hidden ${className ?? ''}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          className="h-full w-full object-cover"
          onError={() => {
            thumbnailCache.delete(mediaId)
            setUrl(null)
            if (retried) {
              setFailed(true)
              return
            }
            setRetried(true)
            void loadThumbnail(mediaId).then(loaded =>
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
  if (post.media) return { label: '1 image', video: false }
  return null
}

/**
 * Where the post goes next, as the card's footer action: live (with its
 * link), on its way, or what to do — publish, review, edit.
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
  const live = Boolean(post.postedAt) || publication?.status === 'published'
  const chip = 'relative z-10 inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium'
  const button =
    'relative z-10 inline-flex h-7 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors'
  if (live) {
    const label = `Live on ${LIVE_ON[post.platform] ?? platform.name}`
    return publication?.postUrl && !publication.deletedAt ? (
      <a
        href={publication.postUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open it on ${platform.name}`}
        className={`${chip} bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400`}
      >
        {label}
      </a>
    ) : (
      <span className={`${chip} bg-emerald-500/10 text-emerald-700 dark:text-emerald-400`}>
        {label}
      </span>
    )
  }
  if (publication?.status === 'publishing') {
    return (
      <span className={`${chip} text-muted bg-surface-hover`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Publishing
      </span>
    )
  }
  if (publication?.status === 'scheduled') {
    return (
      <span
        className={`${chip} bg-indigo-500/10 text-indigo-700 dark:text-indigo-300`}
        title={
          mounted
            ? `Publishes ${formatAbsoluteDateTime(publication.scheduledAt)}`
            : undefined
        }
      >
        <Clock className="h-3 w-3" />
        Scheduled
      </span>
    )
  }
  if (post.status === 'approved') {
    const failed = publication?.status === 'failed'
    return (
      <Link
        href={href}
        className={`${button} ${
          failed
            ? 'border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400'
            : 'border-border text-foreground hover:bg-surface-hover'
        }`}
      >
        {failed
          ? 'Retry publish'
          : canPublishFormat(post.platform, formatOf(post.formatId))
            ? 'Publish Now'
            : 'Copy & post'}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    )
  }
  if (post.status === 'draft') {
    return (
      <Link href={href} className={`${button} border-border text-foreground hover:bg-surface-hover`}>
        Continue Edit
      </Link>
    )
  }
  if (post.status === 'rejected') {
    return (
      <Link href={href} className={`${button} border-border text-muted hover:text-foreground hover:bg-surface-hover`}>
        Revisit
      </Link>
    )
  }
  return (
    <Link
      href={href}
      className={`${button} border-amber-500/50 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400`}
    >
      Review Draft
    </Link>
  )
}

/** The ⋮ menu on a card or row: open, copy, hide, delete. */
function PostMenu({
  post,
  href,
  busy,
  onCopy,
  onToggleHidden,
  onDelete
}: Pick<PostItemProps, 'post' | 'href' | 'busy' | 'onCopy' | 'onToggleHidden' | 'onDelete'>) {
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
    'hover:bg-surface-hover flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-40'
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
        className="text-muted hover:text-foreground hover:bg-surface-hover flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
      </button>
      {open && (
        <div className="border-border bg-surface text-foreground absolute top-full right-0 z-30 mt-1 w-44 rounded-xl border p-1 shadow-lg">
          <Link href={href} className={item}>
            <ArrowRight className="text-muted h-3.5 w-3.5" />
            Open post
          </Link>
          <button type="button" onClick={run(onCopy)} className={item}>
            <Copy className="text-muted h-3.5 w-3.5" />
            Copy text
          </button>
          <button type="button" onClick={run(onToggleHidden)} className={item}>
            {post.hiddenAt ? (
              <Eye className="text-muted h-3.5 w-3.5" />
            ) : (
              <EyeOff className="text-muted h-3.5 w-3.5" />
            )}
            {post.hiddenAt ? 'Unhide' : 'Hide'}
          </button>
          <button
            type="button"
            // The server refuses too: it may be on its platform any moment.
            disabled={post.publication?.status === 'publishing'}
            // The confirm dialog takes focus.
            onClick={run(onDelete, false)}
            className={`${item} text-rose-600 hover:bg-rose-500/10 dark:text-rose-400`}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The whole card opens the post: a link stretched over it, with the menu and
 * footer action above it.
 */
function CardCover({ post, href }: Pick<PostItemProps, 'post' | 'href'>) {
  return (
    <Link
      href={href}
      aria-label={`Open: ${post.hook}`}
      className="absolute inset-0 z-0 rounded-[inherit]"
    />
  )
}

/** One post as a card: platform and status, picture, opening, tags, action. */
function PostCard(props: PostItemProps) {
  const { post, href, mounted } = props
  const format = formatOf(post.formatId)
  const spec = FORMATS[format]
  const badge = mediaBadge(post)
  const tags = (post.hashtags || []).slice(0, 2)
  return (
    <article
      className="group border-border hover:border-foreground/20 bg-surface relative flex flex-col rounded-2xl border shadow-xs transition-colors"
    >
      <CardCover post={post} href={href} />

      <div className="pointer-events-none relative flex items-center gap-2 px-3.5 pt-3.5">
        <PlatformMark platform={post.platform} colored className="h-5 w-5 shrink-0" />
        <span className="text-foreground min-w-0 truncate text-[13px] font-semibold">
          {spec.label}
        </span>
        <PostStatusPill post={post} className="ml-auto" />
        <span className="pointer-events-auto">
          <PostMenu {...props} />
        </span>
      </div>

      <div className="pointer-events-none px-3.5 pt-3">
       <div className="relative">
        {post.media?.id ? (
          <Thumbnail
            mediaId={post.media.id}
            alt={post.media.altText || post.hook}
            className="aspect-5/2 w-full rounded-lg"
          />
        ) : (
          <div className="bg-surface-hover text-muted flex aspect-5/2 w-full flex-col items-center justify-center gap-1.5 rounded-lg">
            {spec.structure === 'script' ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white">
                <Play className="ml-0.5 h-4 w-4 fill-current" />
              </span>
            ) : (
              <PlatformMark platform={post.platform} className="h-6 w-6 opacity-40" />
            )}
            <span className="text-xs">
              {spec.structure === 'script' ? 'Video script' : 'No image yet'}
            </span>
          </div>
        )}
        {badge && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
            {!badge.video && <ImageIcon className="h-3 w-3" />}
            {badge.label}
          </span>
        )}
        {badge?.video && post.media?.id && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </span>
          </span>
        )}
       </div>
      </div>

      <div className="pointer-events-none relative flex flex-1 flex-col px-3.5 pt-3 pb-3.5">
        <h3 className="text-foreground line-clamp-2 text-sm leading-snug font-bold">
          {post.hook}
        </h3>
        {post.body && (
          <p className="text-muted mt-1 line-clamp-2 text-xs leading-relaxed">
            {post.body}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.map(tag => (
              <span
                key={tag}
                className="border-border bg-background text-muted rounded border px-1.5 py-0.5 font-mono text-[10px]"
              >
                #{tag.replace(/^#+/, '')}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="border-border pointer-events-none relative mt-auto flex items-center gap-2.5 border-t px-3.5 py-2.5">
        {/* The exact time on hover; dates only once mounted, in the viewer's
            own time zone. */}
        <span
          className="text-muted pointer-events-auto flex items-center gap-1.5 text-xs"
          title={mounted ? formatAbsoluteDateTime(post.createdAt) : undefined}
        >
          <Clock className="h-3.5 w-3.5" />
          {mounted ? shortAgo(post.createdAt) : ''}
        </span>
        <span className="text-muted text-xs tabular-nums">
          {spec.structure === 'script'
            ? `~${videoScriptOf(post).seconds}s script`
            : `${post.charCount.toLocaleString('en-US')} chars`}
        </span>
        {post.hiddenAt && (
          <span className="text-muted flex items-center gap-1 text-xs">
            <EyeOff className="h-3 w-3" />
            Hidden
          </span>
        )}
        <span className="pointer-events-auto ml-auto">
          <PostAction post={post} href={href} mounted={mounted} />
        </span>
      </div>
    </article>
  )
}

/** One post as a row, for the list view. */
function PostRow(props: PostItemProps) {
  const { post, href, mounted } = props
  const spec = FORMATS[formatOf(post.formatId)]
  return (
    <div className="group hover:bg-surface-hover/50 relative flex items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-2xl last:rounded-b-2xl">
      <CardCover post={post} href={href} />
      <div className="pointer-events-none relative shrink-0">
        {post.media?.id ? (
          <Thumbnail
            mediaId={post.media.id}
            alt={post.media.altText || post.hook}
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
        <p className="text-muted mt-0.5 truncate text-xs">{post.body}</p>
      </div>
      <span className="pointer-events-none relative hidden shrink-0 @2xl:flex">
        <PostStatusPill post={post} />
      </span>
      <span
        className="text-muted pointer-events-auto relative hidden w-20 shrink-0 text-right text-xs @3xl:block"
        title={mounted ? formatAbsoluteDateTime(post.createdAt) : undefined}
      >
        {mounted ? shortAgo(post.createdAt) : ''}
      </span>
      <span className="relative hidden shrink-0 @4xl:block">
        <PostAction post={post} href={href} mounted={mounted} />
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
        className={`flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
          activeCount > 0
            ? 'border-accent/60 bg-surface text-foreground'
            : 'border-border bg-surface text-foreground hover:bg-surface-hover'
        }`}
      >
        <Funnel className="h-4 w-4" />
        Filters
        {activeCount > 0 && (
          <span className="bg-accent text-background flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums">
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
                    <label htmlFor="filter-from" className="text-muted block text-[11px]">
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
                    <label htmlFor="filter-to" className="text-muted block text-[11px]">
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
                  <p role="alert" className="text-[11px] text-red-500">
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
                <span>
                  <span className="font-semibold">Hidden posts</span>
                  <span className="text-muted block text-[11px]">
                    Show only the posts hidden from the list.
                  </span>
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
