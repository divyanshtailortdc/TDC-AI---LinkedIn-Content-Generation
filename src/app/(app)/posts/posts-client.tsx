'use client'

import { ImageLightbox } from '@/components/image-lightbox'
import { LinkedInPreview } from '@/components/linkedin-preview'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { showToast } from '@/components/toast-notification'
import type { LintFinding } from '@/lib/lint/run-linter'
import type { IdentitySummary } from '@/lib/identity'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import { linkedInPostText, toLinkedInText } from '@/lib/post-text'
import {
  IMAGE_PROMPT_MAX_WORDS,
  IMAGE_TYPE_CHOICES,
  countWords,
  type ImageTypeChoice,
  validateImagePrompt,
  validateImageUrl,
  validateReferenceDimensions,
  validateReferenceFile,
  validateStockQuery
} from '@/lib/media/image-input'
import {
  isReviewerChosenSource,
  reviewerSourceLabel
} from '@/lib/media/media-source'
import { getUserFacingRelevance } from '@/lib/media/relevance-label'
import {
  BACKGROUND_PATTERNS,
  BRAND_THEME_PATH,
  FOOTER_MAX_LENGTH,
  type BackgroundPattern
} from '@/lib/brand/theme'
import Link from 'next/link'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleStop,
  Columns2,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  FileCheck,
  FileText,
  Image as ImageIcon,
  Info,
  Layers,
  LayoutGrid,
  ListFilter,
  Loader2,
  MessageSquare,
  Network,
  Palette,
  Paperclip,
  PenTool,
  Quote,
  Search,
  Sparkles,
  Trash2,
  Workflow,
  X,
  ZoomIn
} from 'lucide-react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Suspense,
  useEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import {
  approveDraft,
  fetchPostMediaImage,
  loadMorePosts,
  regeneratePostMediaAction,
  rejectDraft,
  removePostMediaAction,
  saveImageSettings,
  updateDraft,
  updatePostMediaAction
} from './actions'
import { initialsOf } from '@/lib/initials'
import {
  currentMediaJob,
  startMediaJob,
  trackPostsPage,
  type MediaJobOutcome
} from './media-jobs'
import { formatAbsoluteDate, formatAbsoluteDateTime } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'

export interface PostDetail {
  id: string
  accountId: string
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
  hook_fold: 'LinkedIn hook & fold',
  no_markdown_leakage: 'Plain text formatting',
  link_placement: 'Link placement strategy',
  banned_words: 'Tone & banned language',
  engagement_bait: 'Algorithmic engagement',
  grounded_citations: 'Citation grounding coverage',
  citations_coverage: 'Citation grounding coverage',
  unsupported_figures: 'Figures backed by evidence',
  generic_cta: 'Call to action fits the post',
  CHAR_LIMIT: 'Character limit',
  HOOK_FOLD: 'LinkedIn hook & fold',
  NO_MARKDOWN_LEAKAGE: 'Plain text formatting',
  LINK_PLACEMENT: 'Link placement strategy',
  BANNED_WORDS: 'Tone & banned language',
  ENGAGEMENT_BAIT: 'Algorithmic engagement',
  GROUNDED_CITATIONS: 'Citation grounding coverage',
  CITATIONS_COVERAGE: 'Citation grounding coverage'
}

function getHumanRuleLabel(rule: string): string {
  if (LINT_RULE_LABELS[rule]) return LINT_RULE_LABELS[rule]
  return rule
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// The image type picker: Auto (null) lets the art director choose per post.
const IMAGE_TYPE_OPTIONS = [
  {
    value: null,
    label: 'Auto',
    description: 'Picks the type that fits the post best.',
    icon: Sparkles
  },
  ...IMAGE_TYPE_CHOICES.map(choice => ({
    ...choice,
    icon: {
      hub_spoke: Network,
      flow: Workflow,
      stack: Layers,
      cards: LayoutGrid,
      comparison: Columns2,
      illustration: PenTool
    }[choice.value]
  }))
]

type StatusFilter = 'all' | 'awaiting_review' | 'approved' | 'rejected'
type SortOrder = 'newest' | 'oldest'

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All statuses',
  awaiting_review: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected'
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

const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'awaiting_review',
  'approved',
  'rejected'
]
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
 * The filters live in the URL (?status=&from=&to=&sort=&q=) so they survive a
 * reload and can be shared as a link. Unknown or malformed values fall back
 * to the defaults, which are left out of the URL.
 */
function filtersFromParams(params: URLSearchParams) {
  const status = params.get('status') as StatusFilter | null
  let from = realDay(params.get('from') ?? '')
  let to = realDay(params.get('to') ?? '')
  // A reversed range matches nothing; the popover never writes one.
  if (from && to && from > to) from = to = ''
  return {
    status: status && STATUS_FILTERS.includes(status) ? status : 'all',
    from,
    to,
    sort: params.get('sort') === 'oldest' ? 'oldest' : 'newest'
  } satisfies { status: StatusFilter; from: string; to: string; sort: SortOrder }
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
 * the display label, so swapping "16 Sep" for "Today" after mount never
 * reshuffles the list.
 */
function dayKey(value: Date | string): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return 'unknown'
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/** Short, scannable timestamp for a dense queue list. Depends on "now". */
function formatRelativeDate(value: Date | string): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''

  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`

  return formatAbsoluteDate(date)
}

/** Day header text. Relative wording is only used once mounted. */
function bucketLabel(value: Date | string, relative: boolean): string {
  const absolute = formatAbsoluteDate(value)
  if (!relative) return absolute

  const today = new Date()
  if (dayKey(value) === dayKey(today)) return 'Today'
  if (dayKey(value) === dayKey(new Date(today.getTime() - DAY_MS))) {
    return 'Yesterday'
  }
  return absolute
}

function countLintErrors(findings: LintFinding[] | undefined): number {
  return (findings || []).filter(f => f.severity === 'error' && !f.passed).length
}

export function PostsClientInner({
  initialPosts,
  initialNextCursor,
  totalCount,
  identity,
  brand
}: {
  initialPosts: PostDetail[]
  /** Where the next page starts; null when every post is already loaded. */
  initialNextCursor: string | null
  totalCount: number
  identity: IdentitySummary
  brand: BrandSummary
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filterRunId = searchParams.get('runId')
  const hasMounted = useHasMounted()

  const [posts, setPosts] = useState<PostDetail[]>(initialPosts)
  const [nextCursor, setNextCursor] = useState(initialNextCursor)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Older posts come in a page at a time; the newest are shown first.
  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await loadMorePosts(nextCursor)
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
  const [selectedPostId, setSelectedPostId] = useState<string>(
    initialPosts.find(p => !filterRunId || p.runId === filterRunId)?.id ||
      initialPosts[0]?.id ||
      ''
  )
  // yyyy-mm-dd from the date inputs; empty means that end is open.
  const {
    status: statusFilter,
    from: dateFrom,
    to: dateTo,
    sort: sortOrder
  } = filtersFromParams(searchParams)
  // Typed into on every keystroke, so it is local state that is copied into
  // the URL (replace, not push: each letter is not a Back step).
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '')
  const changeSearch = (value: string) => {
    setSearchQuery(value)
    writeParams({ q: value.trim() ? value : null }, 'replace')
  }
  // Back and Forward change the URL without typing, so the box follows it.
  useEffect(() => {
    const onPopState = () =>
      setSearchQuery(new URLSearchParams(window.location.search).get('q') ?? '')
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Active post editing state
  // Posts matching everything except the status facet, so the status counts can
  // show what switching to another status would actually reveal. All posts
  // here already belong to the active account (scoped server-side), so there
  // is no identity facet to filter on.
  const matchesScope = (p: PostDetail) => {
    if (filterRunId && p.runId !== filterRunId) return false

    if (!inDateRange(p.createdAt, dateFrom, dateTo)) return false

    const query = searchQuery.trim().toLowerCase()
    if (query) {
      // Tags are searched as shown in the preview (#tag), whether or not they
      // were stored with the #, so "#tag" and "tag" both find them.
      const tags = (p.hashtags || []).map(t => `#${t.replace(/^#+/, '')}`)
      const haystack =
        `${p.hook} ${p.body} ${p.accountName} ${tags.join(' ')}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }

    return true
  }
  const scopedPosts = posts.filter(matchesScope)

  const statusCounts = {
    all: scopedPosts.length,
    awaiting_review: scopedPosts.filter(p => p.status === 'awaiting_review')
      .length,
    approved: scopedPosts.filter(p => p.status === 'approved').length,
    rejected: scopedPosts.filter(p => p.status === 'rejected').length
  }

  // The queue as shown: every filter applied, in the chosen order.
  const queueOf = (list: PostDetail[]) =>
    list
      .filter(
        p =>
          matchesScope(p) &&
          (statusFilter === 'all' || p.status === statusFilter)
      )
      .sort((a, b) => {
        const diff =
          toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
        return sortOrder === 'newest' ? diff : -diff
      })
  const filteredPosts = queueOf(posts)

  const hasActiveFilters =
    Boolean(dateFrom || dateTo) ||
    sortOrder !== 'newest' ||
    statusFilter !== 'all' ||
    searchQuery.trim().length > 0

  // Also leaves a run's posts (?runId=), back to every post.
  const clearFilters = () => {
    setSearchQuery('')
    writeParams(
      { runId: null, status: null, from: null, to: null, sort: null, q: null },
      'push'
    )
  }

  // Any change to the filters, search or order opens the first post of the
  // new queue, so the post on screen always matches the list beside it.
  // Adjusted during render (not in an effect) so the old post never paints.
  const filterKey = [
    filterRunId,
    dateFrom,
    dateTo,
    statusFilter,
    searchQuery,
    sortOrder
  ].join('|')
  const [shownFilterKey, setShownFilterKey] = useState(filterKey)
  if (filterKey !== shownFilterKey) {
    setShownFilterKey(filterKey)
    setSelectedPostId(filteredPosts[0]?.id ?? '')
  }

  // The open post always comes from the filtered queue, so changing a filter
  // cannot leave a post on screen that is no longer in the list.
  const activePost =
    filteredPosts.find(p => p.id === selectedPostId) || filteredPosts[0]
  const [isEditing, setIsEditing] = useState(false)
  const [editedHook, setEditedHook] = useState(activePost?.hook || '')
  const [editedBody, setEditedBody] = useState(activePost?.body || '')
  const [editedComment, setEditedComment] = useState(
    activePost?.firstComment || ''
  )

  // Copy feedback
  const [copiedPost, setCopiedPost] = useState(false)
  const [copiedComment, setCopiedComment] = useState(false)
  const [copiedImage, setCopiedImage] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Media management state. A generation started before this page opened
  // (the reviewer left the page and came back) is still running: the page
  // starts from it, read once so its state and its outcome agree.
  const [resumedJob] = useState(currentMediaJob)
  const [isMediaLoading, setIsMediaLoading] = useState(() => resumedJob !== null)
  // The post the running media job is for. Only one job runs at a time (they
  // share the Stop button's abort controller), but its progress belongs to
  // that post alone, not to whichever post is open now.
  const [mediaPostId, setMediaPostId] = useState<string | null>(
    () => resumedJob?.postId ?? null
  )
  // Progress and Stop show on the post the media job is for; on any other post
  // the media actions just stay disabled until it finishes.
  const mediaBusyHere = isMediaLoading && mediaPostId === activePost?.id
  const [mediaLoadingText, setMediaLoadingText] = useState(
    () => resumedJob?.loadingText ?? ''
  )
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [showStockInput, setShowStockInput] = useState(false)
  const [stockSearchQuery, setStockSearchQuery] = useState('')
  const [showCustomUrlInput, setShowCustomUrlInput] = useState(false)
  const [customImageUrl, setCustomImageUrl] = useState('')
  const [showPostRejection, setShowPostRejection] = useState(false)
  const [postRejectionReason, setPostRejectionReason] = useState('')
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false)
  const [isImageZoomOpen, setIsImageZoomOpen] = useState(false)
  // A post's image bytes are loaded on demand; see the loader below.
  const [imageLoadFailure, setImageLoadFailure] = useState<{
    mediaId: string
    error: string
  } | null>(null)
  const [imageLoadAttempt, setImageLoadAttempt] = useState(0)

  // Prompt-driven image generation
  const [imagePrompt, setImagePrompt] = useState('')
  const [referenceImage, setReferenceImage] = useState<string | null>(null)
  const [referenceImageName, setReferenceImageName] = useState<string | null>(
    null
  )
  // "Use current image" sends this id, and the server edits that image as it
  // was before its logo went on, so the edit never redraws the logo. Without
  // it, an attached image is a reference: a new image designed from the post
  // copies its structure.
  const [referenceMediaId, setReferenceMediaId] = useState<string | null>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  // Optional, and kept across posts like a preference; null is Auto.
  const [imageType, setImageType] = useState<ImageTypeChoice | null>(null)
  // The background and website on every new image: saved for the identity,
  // so the images made while drafting use them too.
  const [imagePattern, setImagePattern] = useState(brand.pattern)
  const [savedFooter, setSavedFooter] = useState(brand.footerText ?? '')
  const [footerDraft, setFooterDraft] = useState(brand.footerText ?? '')
  // The saves in order (see handleSaveImageSettings), and what the server
  // last confirmed, for a failed one to fall back to.
  const settingsSaveRef = useRef<Promise<void>>(Promise.resolve())
  const settingsSeqRef = useRef(0)
  const confirmedSettingsRef = useRef({
    pattern: brand.pattern,
    footer: brand.footerText ?? ''
  })
  const [isGenerating, setIsGenerating] = useState(() =>
    Boolean(resumedJob?.controller)
  )
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const generationAbortRef = useRef<AbortController | null>(
    resumedJob?.controller ?? null
  )
  // Leaving the page does not stop a generation (see ./media-jobs); a page
  // that has closed just no longer shows its outcome.
  const mountedRef = useRef(false)

  // The editor reads the edit buffer, so it is reset (with the per-post
  // panels) whenever a different post opens, however that happens: a click,
  // J/K, a filter change or a status change.
  const activePostId = activePost?.id
  const [bufferPostId, setBufferPostId] = useState(activePostId)
  if (activePostId !== bufferPostId) {
    setBufferPostId(activePostId)
    setEditedHook(activePost?.hook || '')
    setEditedBody(activePost?.body || '')
    setEditedComment(activePost?.firstComment || '')
    setIsEditing(false)
    setShowStockInput(false)
    setShowCustomUrlInput(false)
    setShowPostRejection(false)
    setPostRejectionReason('')
    setMediaMenuOpen(false)
    setMediaError(null)
    setMediaNotice(null)
    setImagePrompt('')
    setReferenceImage(null)
    setReferenceImageName(null)
    setReferenceMediaId(null)
    setImageLoadFailure(null)
  }

  // A media job outlives the post it started on: the user can open another
  // post while it runs. The error, notice and input resets below are the open
  // post's panel, so a job's outcome only goes there while its post is open.
  const activePostIdRef = useRef(activePostId)
  useEffect(() => {
    activePostIdRef.current = activePostId
  })
  const isPostOpen = (postId: string) => activePostIdRef.current === postId
  const reportMediaError = (postId: string, message: string) => {
    if (isPostOpen(postId)) setMediaError(message)
    else showToast({ type: 'error', title: 'Media update failed', message })
  }

  // A generation's outcome, applied on whichever page is open when it lands,
  // and once: the page that started it and a remounted one both wait on it.
  const appliedOutcomeRef = useRef<MediaJobOutcome | null>(null)
  const finishMediaJob = (outcome: MediaJobOutcome) => {
    if (appliedOutcomeRef.current === outcome) return
    appliedOutcomeRef.current = outcome
    const { postId } = outcome
    if (outcome.status === 'created') {
      setPosts(prev =>
        prev.map(p => (p.id === postId ? { ...p, media: outcome.media } : p))
      )
    } else if (outcome.status === 'failed') {
      reportMediaError(postId, outcome.error)
    } else if (isPostOpen(postId)) {
      setMediaNotice('Generation stopped. Edit your prompt and try again.')
    }
    generationAbortRef.current = null
    setIsGenerating(false)
    setIsMediaLoading(false)
    setMediaPostId(null)
    setMediaLoadingText('')
  }

  useEffect(() => {
    mountedRef.current = true
    const untrack = trackPostsPage()
    // A generation started before this page opened lands here when it ends,
    // even if it ended between the first render and now.
    void resumedJob?.done.then(outcome => {
      if (mountedRef.current) finishMediaJob(outcome)
    })
    return () => {
      mountedRef.current = false
      untrack()
    }
    // Once per page: the job and its outcome outlive any one render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The preview and Copy show the saved post, which is what Approve saves; the
  // edit buffer only while the editor is open. Showing unsaved edits there
  // meant copying or approving one text while another was stored.
  const shownHook = isEditing ? editedHook : activePost?.hook || ''
  const shownBody = isEditing ? editedBody : activePost?.body || ''
  const shownComment = isEditing
    ? editedComment
    : activePost?.firstComment || ''
  // Copy, like Approve, takes the saved comment, in the form the preview shows.
  const copyableComment = toLinkedInText(activePost?.firstComment)
  // Compared whether or not the editor is open: closing it to look at the
  // preview keeps the edits in the buffer, and they are still unsaved.
  const hasUnsavedEdits =
    editedHook !== (activePost?.hook || '') ||
    editedBody !== (activePost?.body || '') ||
    editedComment !== (activePost?.firstComment || '')

  // Asks before unsaved edits are thrown away. True when it is fine to go on.
  const confirmDiscardEdits = (what: string) =>
    !hasUnsavedEdits ||
    window.confirm(
      `You have unsaved changes to this post. ${what} will discard them. Continue?`
    )

  // Closing or reloading the tab, and following a link to another page, would
  // drop the edits without a word.
  useEffect(() => {
    if (!hasUnsavedEdits) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const onLinkClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      if (link.target === '_blank' || event.metaKey || event.ctrlKey) return
      const url = new URL(link.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return
      if (!window.confirm('You have unsaved changes to this post. Leave this page and discard them?')) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onLinkClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onLinkClick, true)
    }
  }, [hasUnsavedEdits])

  const discardEdits = () => {
    setEditedHook(activePost?.hook || '')
    setEditedBody(activePost?.body || '')
    setEditedComment(activePost?.firstComment || '')
    setIsEditing(false)
  }

  // The file input's own value is DOM state, so it is cleared after render.
  useEffect(() => {
    if (referenceInputRef.current) referenceInputRef.current.value = ''
  }, [activePostId])

  // The page ships media metadata without the image bytes; load them for the
  // post being viewed. Only a successful load is kept: a failure is recorded
  // separately (the media record still exists, so it is not "Text only") and
  // is retried when the post is reopened or Retry is pressed.
  const activeMediaId = activePost?.media?.id
  const activeMediaHasImage = Boolean(activePost?.media?.imageUrl)
  const activeImageLoadError =
    activeMediaId && imageLoadFailure?.mediaId === activeMediaId
      ? imageLoadFailure.error
      : null
  const isActiveImageLoading =
    Boolean(activeMediaId) && !activeMediaHasImage && !activeImageLoadError

  useEffect(() => {
    if (!activeMediaId || activeMediaHasImage) return

    let cancelled = false
    void fetchPostMediaImage(activeMediaId)
      .catch((err: any) => ({
        success: false as const,
        error: err?.message || 'Failed to load image'
      }))
      .then(res => {
        if (res.success) {
          // Keyed by media id, so a load that finishes after the reviewer moved
          // on still fills in the right post, and never a replaced image.
          setPosts(prev =>
            prev.map(p =>
              p.media && p.media.id === activeMediaId && !p.media.imageUrl
                ? { ...p, media: { ...p.media, imageUrl: res.imageUrl } }
                : p
            )
          )
        } else if (!cancelled) {
          setImageLoadFailure({ mediaId: activeMediaId, error: res.error })
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeMediaId, activeMediaHasImage, imageLoadAttempt])

  const retryImageLoad = () => {
    setImageLoadFailure(null)
    setImageLoadAttempt(n => n + 1)
  }

  // Collapsible drawers (all collapsed by default as requested)
  const [showQualityChecks, setShowQualityChecks] = useState(false)
  const [showAdvancedMedia, setShowAdvancedMedia] = useState(false)

  const currentIndex = filteredPosts.findIndex(p => p.id === activePost?.id)
  const totalPosts = filteredPosts.length

  const clearReferenceImage = () => {
    setReferenceImage(null)
    setReferenceImageName(null)
    setReferenceMediaId(null)
    if (referenceInputRef.current) referenceInputRef.current.value = ''
  }

  // Opening a post is all it takes: the buffer resets above.
  const handleSelectPost = (post: PostDetail) => {
    if (post.id !== activePost?.id && !confirmDiscardEdits('Opening another post')) {
      return
    }
    setSelectedPostId(post.id)
  }

  const handlePrevPost = () => {
    const prev = filteredPosts[currentIndex - 1]
    if (currentIndex > 0 && prev) {
      handleSelectPost(prev)
    }
  }

  const handleNextPost = () => {
    const next = filteredPosts[currentIndex + 1]
    if (currentIndex < totalPosts - 1 && next) {
      handleSelectPost(next)
    }
  }

  // The queue rail shows a page at a time: the page holding the open post, so
  // J/K, auto-advance and a new filter carry the page along. Picking a page
  // opens its first post.
  const queuePage =
    currentIndex >= 0 ? Math.floor(currentIndex / PAGE_SIZE) + 1 : 1
  const { rows: queuePagePosts, pageInfo: queuePageInfo } = paginate(
    filteredPosts,
    queuePage,
    PAGE_SIZE
  )
  const openQueuePage = (page: number) => {
    const first = filteredPosts[(page - 1) * PAGE_SIZE]
    if (first) handleSelectPost(first)
  }
  // A new page opens at its top, or at its open post when K stepped back
  // onto its last one.
  const queueListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = queueListRef.current
    if (!list) return
    list.scrollTo({ top: 0 })
    list
      .querySelector<HTMLElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [queuePage])

  // Reviewing a long queue is mostly next/next/next, so keep hands on the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }

      // Letters match with Shift or Caps Lock on too.
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (key === 'j' || key === 'ArrowDown') {
        event.preventDefault()
        handleNextPost()
      } else if (key === 'k' || key === 'ArrowUp') {
        event.preventDefault()
        handlePrevPost()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, totalPosts, filteredPosts])

  const loadReferenceImage = (file: File) => {
    const fileError = validateReferenceFile(file)
    if (fileError) {
      setMediaError(fileError)
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      // The MIME type only says what the file claims to be; decoding proves it is
      // a real image and tells us whether it is large enough to guide an HD edit.
      // `window.Image` because `Image` in this module is next/image.
      const probe = new window.Image()
      probe.onload = () => {
        const sizeError = validateReferenceDimensions(
          probe.naturalWidth,
          probe.naturalHeight
        )
        if (sizeError) {
          setMediaError(sizeError)
          return
        }
        setReferenceImage(dataUrl)
        setReferenceImageName(file.name || 'Pasted image')
        setReferenceMediaId(null)
        setMediaError(null)
      }
      probe.onerror = () =>
        setMediaError('That image could not be read — the file may be corrupt.')
      probe.src = dataUrl
    }
    reader.onerror = () => setMediaError('Could not read that image file.')
    reader.readAsDataURL(file)
  }

  // Lets the user iterate on the image already attached to the post ("make this
  // warmer") without downloading and re-uploading it.
  const useCurrentImageAsReference = () => {
    const current = activePost?.media?.imageUrl
    if (!current) return
    setReferenceImage(current)
    setReferenceImageName(`Current image (v${activePost?.media?.version || 1})`)
    setReferenceMediaId(activePost?.media?.id ?? null)
    setMediaError(null)
  }

  const clearPromptAndReference = () => {
    setImagePrompt('')
    clearReferenceImage()
    setMediaError(null)
  }

  const handleReferencePaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement>
  ) => {
    const image = Array.from(e.clipboardData.files).find(f =>
      f.type.startsWith('image/')
    )
    if (image) {
      e.preventDefault()
      loadReferenceImage(image)
    }
  }

  // Every generation goes through the media route, so the Stop button can
  // end it, and runs as a job, so leaving the page does not.
  const startMediaRequest = async (
    postId: string,
    loadingText: string,
    payload: Record<string, unknown>
  ) => {
    const controller = new AbortController()
    generationAbortRef.current = controller
    setIsMediaLoading(true)
    setMediaPostId(postId)
    setIsGenerating(true)
    setMediaLoadingText(loadingText)
    setMediaError(null)
    setMediaNotice(null)
    setMediaMenuOpen(false)

    // A website or background changed just before is saved first, so the
    // new image already has it.
    const settingsSaved = settingsSaveRef.current
    const body = JSON.stringify(payload)
    const job = startMediaJob(
      { postId, loadingText, controller },
      async (): Promise<MediaJobOutcome> => {
        try {
          await settingsSaved
          const response = await fetch(`/api/posts/${postId}/media`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: controller.signal
          })
          const res = await response.json().catch(() => null)
          return response.ok && res?.success && res.media
            ? { postId, status: 'created', media: res.media }
            : {
                postId,
                status: 'failed',
                error:
                  res?.error ||
                  `Image generation failed (HTTP ${response.status}).`
              }
        } catch (err: any) {
          if (controller.signal.aborted) return { postId, status: 'stopped' }
          return {
            postId,
            status: 'failed',
            error: err?.message
              ? `Could not reach the server: ${err.message}`
              : 'Could not reach the server. Check your connection and try again.'
          }
        }
      }
    )
    const outcome = await job.done
    if (mountedRef.current) finishMediaJob(outcome)
  }

  const handleGenerateFromPrompt = async () => {
    if (!activePost || isMediaLoading) return

    // With a reference image the post supplies the subject, so words are optional.
    const guidedByReference = Boolean(referenceImage) && !referenceMediaId
    const promptProblem =
      guidedByReference && !imagePrompt.trim()
        ? null
        : validateImagePrompt(imagePrompt)
    if (promptProblem) {
      setMediaError(promptProblem)
      return
    }

    await startMediaRequest(
      activePost.id,
      guidedByReference
        ? 'Rebuilding your reference with this post’s words and your brand colours, then checking it against the reference. This takes a minute or two.'
        : referenceMediaId
          ? 'Editing your image in HD...'
          : 'Generating your image in HD...',
      {
        prompt: imagePrompt.trim(),
        ...(referenceMediaId
          ? { referenceMediaId }
          : { referenceImages: referenceImage ? [referenceImage] : undefined })
      }
    )
  }

  // Aborting the fetch closes the request, which cancels generation server-side.
  const handleStopGeneration = () => {
    generationAbortRef.current?.abort()
  }

  // The server reads the saved post, writes an image brief from its text and
  // generates from that. A typed prompt is passed along as direction only.
  const handleGenerateFromPost = async () => {
    if (!activePost || isMediaLoading) return
    await startMediaRequest(
      activePost.id,
      'Designing a visual from the post, then checking its text and branding. This takes about a minute.',
      {
        fromPost: true,
        prompt: imagePrompt.trim(),
        visualType: imageType ?? undefined
      }
    )
  }

  // Shown as chosen at once. Saves run one after another, so the last one
  // wins; a failed one puts back what the server last confirmed, unless a
  // later save has already replaced it.
  const handleSaveImageSettings = (next: {
    pattern: BackgroundPattern
    footer: string
  }) => {
    setImagePattern(next.pattern)
    setSavedFooter(next.footer)
    const seq = ++settingsSeqRef.current
    const save = settingsSaveRef.current.then(async () => {
      const res = await saveImageSettings({
        backgroundPattern: next.pattern,
        footerText: next.footer || null
      }).catch((err: any) => ({
        success: false as const,
        error: err?.message || 'Could not save the image settings.'
      }))
      if (res.success) {
        confirmedSettingsRef.current = next
      } else {
        if (seq === settingsSeqRef.current) {
          setImagePattern(confirmedSettingsRef.current.pattern)
          setSavedFooter(confirmedSettingsRef.current.footer)
        }
        showToast({
          type: 'error',
          title: 'Image settings not saved',
          message: res.error
        })
      }
    })
    settingsSaveRef.current = save
    return save
  }

  const handleDownloadMedia = async () => {
    const imageUrl = activePost?.media?.imageUrl
    if (!imageUrl) return

    const extension =
      imageUrl.startsWith('data:') && imageUrl.includes('/')
        ? imageUrl.slice(imageUrl.indexOf('/') + 1, imageUrl.indexOf(';')) ||
          'png'
        : 'png'
    const fileName = `linkedin-visual-v${activePost?.media?.version || 1}.${extension}`

    let objectUrl: string | null = null
    try {
      let href = imageUrl
      if (!imageUrl.startsWith('data:')) {
        const res = await fetch(imageUrl)
        if (!res.ok) throw new Error(`Image responded with ${res.status}`)
        objectUrl = URL.createObjectURL(await res.blob())
        href = objectUrl
      }

      const link = document.createElement('a')
      link.href = href
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      // Remote hosts can block cross-origin reads; open the asset so it can be saved manually.
      window.open(imageUrl, '_blank', 'noopener,noreferrer')
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }

  const handleSearchStockMedia = async () => {
    if (!activePost || isMediaLoading) return
    const queryProblem = validateStockQuery(stockSearchQuery)
    if (queryProblem) {
      setMediaError(queryProblem)
      return
    }
    const postId = activePost.id
    setIsMediaLoading(true)
    setMediaPostId(postId)
    setMediaLoadingText('Searching royalty-free stock imagery...')
    setMediaError(null)

    try {
      const res = await regeneratePostMediaAction(postId, {
        mode: 'stock',
        customPrompt: stockSearchQuery.trim() || undefined
      })
      if (res.success && res.media) {
        setPosts(prev =>
          prev.map(p => (p.id === postId ? { ...p, media: res.media } : p))
        )
        if (isPostOpen(postId)) {
          setShowStockInput(false)
          setStockSearchQuery('')
        }
      } else {
        reportMediaError(postId, res.error || 'Failed to search stock visual')
      }
    } catch (err: any) {
      reportMediaError(postId, err?.message || 'Failed to search stock visual')
    } finally {
      setIsMediaLoading(false)
      setMediaPostId(null)
      setMediaLoadingText('')
    }
  }

  const handleApplyCustomUrl = async () => {
    if (!activePost || isMediaLoading) return
    const url = customImageUrl.trim()
    const urlProblem = validateImageUrl(url)
    if (urlProblem) {
      setMediaError(urlProblem)
      return
    }

    const postId = activePost.id
    setIsMediaLoading(true)
    setMediaPostId(postId)
    setMediaLoadingText('Attaching custom image...')
    setMediaError(null)

    try {
      const res = await updatePostMediaAction(postId, {
        mode: 'stock',
        imageUrl: url,
        altText: `Custom visual for: ${activePost.hook.slice(0, 50)}`
      })

      if (res.success && res.media) {
        setPosts(prev =>
          prev.map(p => (p.id === postId ? { ...p, media: res.media } : p))
        )
        if (isPostOpen(postId)) {
          setShowCustomUrlInput(false)
          setCustomImageUrl('')
        }
      } else {
        reportMediaError(postId, res.error || 'Failed to update image URL')
      }
    } catch (err: any) {
      reportMediaError(postId, err?.message || 'Failed to update image URL')
    } finally {
      setIsMediaLoading(false)
      setMediaPostId(null)
      setMediaLoadingText('')
    }
  }

  const handleRemoveMedia = async () => {
    if (!activePost) return
    const postId = activePost.id
    setIsMediaLoading(true)
    setMediaPostId(postId)
    setMediaLoadingText('Switching to text-only mode...')
    setMediaError(null)
    setMediaMenuOpen(false)

    try {
      const res = await removePostMediaAction(postId)
      if (res.success) {
        setPosts(prev =>
          prev.map(p => (p.id === postId ? { ...p, media: null } : p))
        )
      } else {
        reportMediaError(postId, res.error || 'Failed to remove media')
      }
    } catch (err: any) {
      reportMediaError(postId, err?.message || 'Failed to remove media')
    } finally {
      setIsMediaLoading(false)
      setMediaPostId(null)
      setMediaLoadingText('')
    }
  }

  const handleSwapHook = async (newHook: string) => {
    const previousHook = editedHook
    setEditedHook(newHook)
    if (!activePost) return
    setIsSaving(true)
    try {
      const res = await updateDraft(activePost.id, { hook: newHook })
      if (!res.success) throw new Error(res.error)
      setPosts(prev =>
        prev.map(p =>
          p.id === activePost.id
            ? {
                ...p,
                hook: newHook,
                charCount: res.charCount ?? p.charCount,
                lintFindings: res.lintFindings ?? p.lintFindings
              }
            : p
        )
      )
    } catch (err: any) {
      // Undo the swap unless another post's buffer has replaced it meanwhile.
      setEditedHook(current => (current === newHook ? previousHook : current))
      showToast({
        type: 'error',
        title: 'Hook not saved',
        message: err?.message || 'Failed to update draft'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveEdits = async () => {
    if (!activePost) return
    setIsSaving(true)
    try {
      const res = await updateDraft(activePost.id, {
        hook: editedHook,
        body: editedBody,
        firstComment: editedComment
      })
      if (!res.success) throw new Error(res.error)
      setPosts(prev =>
        prev.map(p =>
          p.id === activePost.id
            ? {
                ...p,
                hook: editedHook,
                body: editedBody,
                firstComment: editedComment,
                // From the save: counted and checked on the text as stored.
                charCount: res.charCount ?? p.charCount,
                lintFindings: res.lintFindings ?? p.lintFindings
              }
            : p
        )
      )
      setIsEditing(false)
    } catch (err: any) {
      // The editor stays open with the edits, so nothing typed is lost.
      showToast({
        type: 'error',
        title: 'Changes not saved',
        message: err?.message || 'Failed to update draft'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    // 1. Try modern clipboard API (HTTPS or localhost)
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (e) {
        console.warn('navigator.clipboard.writeText failed, using fallback:', e)
      }
    }

    // 2. Fallback using temporary textarea (HTTP / LAN IP / permissions restricted)
    if (typeof document !== 'undefined') {
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.setAttribute('readonly', '')
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        textarea.style.top = '-9999px'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        const successful = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (successful) return true
      } catch (err) {
        console.error('execCommand copy fallback failed:', err)
      }
    }

    return false
  }

  const handleCopyPost = async () => {
    if (!activePost) return
    // Always the saved post: that is the text Approve stores, so what is copied
    // is what is approved. Edits not saved yet are not part of either. It is
    // the text the preview shows, with the hook in Unicode bold; the first
    // comment has its own button, since it is pasted after publishing.
    const success = await copyTextToClipboard(linkedInPostText(activePost))
    if (success) {
      setCopiedPost(true)
      showToast({
        type: 'success',
        title: 'Post Copied!',
        message: hasUnsavedEdits
          ? 'Copied the saved post. Your unsaved edits are not included; save them to copy them.'
          : 'Post copied with a bold hook, ready to paste into LinkedIn.'
      })
      setTimeout(() => setCopiedPost(false), 2500)
    } else {
      showToast({
        type: 'error',
        title: 'Copy Failed',
        message: 'Could not write to clipboard. Please select text manually.'
      })
    }
  }

  const handleCopyComment = async () => {
    if (!copyableComment) return
    const success = await copyTextToClipboard(copyableComment)
    if (success) {
      setCopiedComment(true)
      showToast({
        type: 'success',
        title: 'Comment Copied!',
        message:
          editedComment !== (activePost?.firstComment || '')
            ? 'Copied the saved comment. Your unsaved edits are not included; save them to copy them.'
            : 'First comment copied, ready to paste under the published post.'
      })
      setTimeout(() => setCopiedComment(false), 2500)
    } else {
      showToast({
        type: 'error',
        title: 'Copy Failed',
        message: 'Could not write comment to clipboard.'
      })
    }
  }

  const handleCopyImage = async () => {
    const imageUrl = activePost?.media?.imageUrl
    if (!imageUrl) return

    try {
      let blob: Blob
      if (imageUrl.startsWith('data:')) {
        try {
          const res = await fetch(imageUrl)
          blob = await res.blob()
        } catch {
          const parts = imageUrl.split(',')
          const header = parts[0] || ''
          const base64Data = parts[1] || ''
          const mime = header.match(/:(.*?);/)?.[1] || 'image/png'
          const bstr = atob(base64Data)
          let n = bstr.length
          const u8arr = new Uint8Array(n)
          while (n--) {
            u8arr[n] = bstr.charCodeAt(n)
          }
          blob = new Blob([u8arr], { type: mime })
        }
      } else {
        const res = await fetch(imageUrl)
        blob = await res.blob()
      }

      // ClipboardItem requires PNG format
      let pngBlob = blob
      if (blob.type !== 'image/png') {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          img.src = imageUrl
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || img.width
        canvas.height = img.naturalHeight || img.height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(img, 0, 0)
        pngBlob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            b => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
            'image/png'
          )
        })
      }

      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof ClipboardItem !== 'undefined' &&
        typeof navigator.clipboard.write === 'function'
      ) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': pngBlob })
        ])
        setCopiedImage(true)
        showToast({
          type: 'success',
          title: 'Image Copied!',
          message:
            'Image copied to clipboard! You can paste (Ctrl+V) directly into LinkedIn.'
        })
        setTimeout(() => setCopiedImage(false), 2500)
        return
      }

      // Browser doesn't support direct image clipboard write: download image instead
      await handleDownloadMedia()
      showToast({
        type: 'info',
        title: 'Image Downloaded',
        message:
          'Clipboard image copy is unsupported in this browser. Image downloaded instead.'
      })
    } catch (err) {
      console.warn(
        'Failed to copy image to clipboard, downloading instead:',
        err
      )
      await handleDownloadMedia()
      showToast({
        type: 'info',
        title: 'Image Downloaded',
        message:
          'Direct clipboard image copy unavailable. Image downloaded so you can attach it.'
      })
    }
  }

  /**
   * A status change refreshes the queue: it is filtered again, so a post that
   * no longer matches the status filter leaves the list, and the first post in
   * it opens.
   */
  const refreshQueueAfterStatusChange = (id: string, status: string) => {
    const withStatus = (list: PostDetail[]) =>
      list.map(p => (p.id === id ? { ...p, status } : p))
    setPosts(withStatus)
    const first = queueOf(withStatus(posts))[0]
    if (first) handleSelectPost(first)
    else setSelectedPostId('')
  }

  const handleApprove = async () => {
    if (!activePost || activePost.status === 'approved') return
    if (hasUnsavedEdits) {
      showToast({
        type: 'error',
        title: 'Unsaved changes',
        message:
          'Save or cancel your edits before approving this post. Use Edit Post Text to reopen them.'
      })
      return
    }
    const approvedId = activePost.id
    setIsSaving(true)
    try {
      const res = await approveDraft(approvedId)
      if (!res.success) throw new Error(res.error)
      refreshQueueAfterStatusChange(approvedId, 'approved')
      showToast({
        type: 'success',
        title: 'Post approved',
        message: 'Opened the first post in the queue.'
      })
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Post not approved',
        message: err?.message || 'Failed to approve draft'
      })
    } finally {
      setIsSaving(false)
    }
  }

  const cancelPostRejection = () => {
    setShowPostRejection(false)
    setPostRejectionReason('')
  }

  const handleReject = async (reason?: string) => {
    if (!activePost) return
    if (!confirmDiscardEdits('Rejecting this post')) return
    const rejectedId = activePost.id

    setIsSaving(true)
    try {
      const res = await rejectDraft(rejectedId, reason?.trim() || undefined)
      if (!res.success) throw new Error(res.error)
      refreshQueueAfterStatusChange(rejectedId, 'rejected')
      showToast({
        type: 'success',
        title: 'Post rejected',
        message: reason?.trim()
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
      setIsSaving(false)
    }
  }

  // Decision shortcuts, alongside J/K navigation. Declared after the handlers
  // they call.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }
      if (!activePost || isSaving) return

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      if (key === 'a') {
        event.preventDefault()
        void handleApprove()
      } else if (key === 'r') {
        // A rejected post has no Reject button; R would reject it again and
        // store a second feedback row.
        if (activePost.status === 'rejected') return
        event.preventDefault()
        setShowPostRejection(true)
      } else if (key === 'c') {
        event.preventDefault()
        void handleCopyPost()
      } else if (event.key === 'Escape' && showPostRejection) {
        cancelPostRejection()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePost?.id, activePost?.status, isSaving, showPostRejection, shownHook, shownBody, hasUnsavedEdits])

  const authorInitials = activePost?.accountName
    ? initialsOf(activePost.accountName)
    : 'IN'

  // Offered beside the hook in the preview: the AI's own opening first, so a
  // swap can always be undone, then the alternates. Duplicates are dropped.
  const hookOptions = [
    ...(activePost?.originalHook
      ? [{ label: 'Original', content: activePost.originalHook }]
      : []),
    ...(activePost?.variants || [])
      .filter(v => v.variantType === 'hook')
      .map((v, i) => ({ label: `Alternate ${i + 1}`, content: v.content }))
  ].filter(
    (option, i, all) =>
      all.findIndex(o => o.content.trim() === option.content.trim()) === i
  )
  const lintFindings = activePost?.lintFindings || []
  const passedLintCount = lintFindings.filter(f => f.passed).length
  const totalLintCount = lintFindings.length
  const hasLintIssues = totalLintCount > 0 && passedLintCount < totalLintCount

  // Buttons stay disabled until their input is valid; messages only appear once the
  // user has typed something, so an untouched field is not shown as an error.
  const promptError = validateImagePrompt(imagePrompt)
  const showPromptError = imagePrompt.trim().length > 0 && promptError !== null
  // With nothing typed, the main button designs an image from the post text
  // (a new concept each time) instead of sitting disabled waiting for a prompt.
  const regenerateFromPost = !imagePrompt.trim() && !referenceImage
  // An uploaded reference also designs from the post, so a prompt is optional
  // and unsaved edits would make the image miss the post.
  const guidedByReference = Boolean(referenceImage) && !referenceMediaId
  const mainButtonBlocked = regenerateFromPost
    ? isEditing
    : guidedByReference
      ? isEditing || showPromptError
      : promptError !== null
  const stockQueryError = validateStockQuery(stockSearchQuery)
  const customUrlError = validateImageUrl(customImageUrl)

  // Relevance is scored against the post thesis, which only makes sense for media
  // the pipeline derived itself. An image the reviewer asked for, searched for or
  // supplied was never scored, so it gets a badge saying so instead of a verdict.
  const isUserPromptedMedia = isReviewerChosenSource(activePost?.media?.source)
  const reviewerMediaLabel = reviewerSourceLabel(activePost?.media?.source)

  const relevanceInfo = getUserFacingRelevance(
    activePost?.media?.imageUrl && !isUserPromptedMedia
      ? {
          relevanceScore: activePost.media.relevanceScore,
          issues: activePost.media.issues
        }
      : null
  )

  const mediaHeadline =
    activePost?.media?.mediaBrief?.textOverlay?.headline ||
    activePost?.media?.mediaBrief?.primaryConcept ||
    activePost?.media?.altText ||
    'Editorial visual asset'

  // Search and filters sit in the queue card on wide screens; below lg the
  // queue is hidden, so they are shown above the post instead.
  const filterControls = (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Search className="text-muted pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
        <input
          type="search"
          value={searchQuery}
          onChange={e => changeSearch(e.target.value)}
          placeholder="Search posts…"
          className="border-border bg-surface text-foreground placeholder:text-muted focus:border-accent w-full rounded-lg border py-1.5 pr-3 pl-8 text-xs outline-none"
        />
      </div>

      <PostFiltersMenu
        value={{
          status: statusFilter,
          from: dateFrom,
          to: dateTo,
          sort: sortOrder
        }}
        statusCounts={statusCounts}
        today={hasMounted ? toDayInput(new Date()) : undefined}
        onApply={next =>
          writeParams(
            {
              status: next.status === 'all' ? null : next.status,
              from: next.from || null,
              to: next.to || null,
              sort: next.sort === 'newest' ? null : next.sort
            },
            'push'
          )
        }
      />
    </div>
  )

  // The decision bar: where you are in the queue, approve / reject, then
  // previous / next. It sits in the page header's strip, so it is always in
  // view while the post scrolls.
  const reviewBar = activePost ? (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-3">
      {/* One row: where you are in the queue, the decision, then
          previous / next. The two wrappers below are `contents`, so
          their children sit directly in this row. */}
      <div className="contents">
        <div className="flex min-w-0 flex-1 items-center gap-x-3 overflow-hidden whitespace-nowrap sm:min-w-fit">
          <span className="text-foreground text-xs font-semibold tabular-nums">
            Post {currentIndex + 1} of {totalPosts}
          </span>
          <span className="text-muted text-xs">•</span>
          <span className="text-muted truncate text-xs font-medium">
            {activePost.accountName}
          </span>
          <span className="text-muted text-xs">•</span>
          <span
            className="text-muted text-xs"
            title={formatAbsoluteDateTime(activePost.createdAt)}
          >
            Drafted{' '}
            {hasMounted
              ? formatRelativeDate(activePost.createdAt)
              : formatAbsoluteDate(activePost.createdAt)}
          </span>
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              activePost.status === 'approved'
                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : activePost.status === 'rejected'
                  ? 'border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : 'border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }`}
          >
            {activePost.status === 'approved'
              ? '✓ Approved'
              : activePost.status === 'rejected'
                ? 'Rejected'
                : 'Awaiting review'}
          </span>
        </div>

        <div className="order-last flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={currentIndex <= 0}
            onClick={handlePrevPost}
            aria-label="Previous post"
            title="Previous post (K)"
            className="border-border text-foreground hover:bg-surface-hover flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={currentIndex >= totalPosts - 1}
            onClick={handleNextPost}
            aria-label="Next post"
            title="Next post (J)"
            className="border-border text-foreground hover:bg-surface-hover flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* The one thing to do next, which depends on the post's state */}
      <div className="contents">
        {showPostRejection ? (
          <form
            onSubmit={e => {
              e.preventDefault()
              void handleReject(postRejectionReason)
            }}
            // The review shortcuts listen on window and skip text fields, so
            // Escape in the reason never reached them; it is handled here, and
            // keys pressed on the form's buttons must not approve or move on.
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') cancelPostRejection()
            }}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <input
              type="text"
              autoFocus
              value={postRejectionReason}
              onChange={e => setPostRejectionReason(e.target.value)}
              placeholder="Why reject? Optional, helps future drafts"
              className="border-border bg-surface text-foreground placeholder:text-muted w-72 max-w-full min-w-0 rounded-lg border px-3 py-2 text-xs outline-none focus:border-rose-500"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelPostRejection}
                className="text-muted hover:text-foreground h-8 cursor-pointer rounded-lg px-3.5 text-[13px] font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="h-8 cursor-pointer rounded-lg bg-rose-600 px-3.5 text-[13px] font-semibold text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-50"
              >
                {isSaving ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </form>
        ) : activePost.status === 'approved' ? (
          <div className="flex shrink-0 items-center gap-3">
            
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyPost}
                className="bg-accent text-background flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-xs transition-opacity hover:opacity-90"
              >
                {copiedPost ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedPost ? 'Post copied' : '1. Copy post'}
                <kbd className="ml-1.5 rounded border border-white/30 px-1 py-px font-mono text-[10px] font-normal opacity-80">
                  C
                </kbd>
              </button>
              {copyableComment ? (
                <button
                  type="button"
                  onClick={handleCopyComment}
                  className="border-border text-foreground hover:bg-surface-hover flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-semibold transition-colors"
                >
                  {copiedComment ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5" />
                  )}
                  {copiedComment
                    ? 'Comment copied'
                    : '2. Copy first comment'}
                </button>
              ) : (
                <span className="text-muted text-[11px]">
                  No first comment
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowPostRejection(true)}
                className="text-muted h-8 cursor-pointer px-2 text-[11px] hover:text-rose-600 dark:hover:text-rose-400"
              >
                Reject instead
              </button>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-3">
           
            <div className="flex items-center gap-2">
              {activePost.status !== 'rejected' && (
                <button
                  type="button"
                  onClick={() => setShowPostRejection(true)}
                  disabled={isSaving}
                  className="border-border text-muted flex h-8 cursor-pointer items-center rounded-lg border px-3.5 text-[13px] font-semibold transition-colors hover:border-rose-500/40 hover:text-rose-600 disabled:opacity-50 dark:hover:text-rose-400"
                >
                  Reject
                </button>
              )}
              <button
                type="button"
                onClick={handleApprove}
                disabled={isSaving}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-[13px] font-semibold text-white shadow-xs transition-colors hover:bg-emerald-800 disabled:opacity-60"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isSaving
                  ? 'Saving…'
                  : activePost.status === 'rejected'
                    ? 'Approve instead'
                    : 'Approve'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Post Review & Approval"
        description={`Reviewing drafts for ${identity.name} · @${identity.handle}`}
        bottomContent={reviewBar}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* QUEUE RAIL — replaces a strip of "Post #1…#90" pills that carried no
            information about the posts they pointed at. */}
        <aside className="border-border bg-surface hidden w-[320px] shrink-0 flex-col border-r lg:flex">
          <div className="border-border space-y-3 border-b px-4 pt-4 pb-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="text-foreground text-sm font-semibold tracking-tight">
                  Queue
                </span>
                <span className="bg-surface-hover text-muted rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                  {totalPosts}
                </span>
              </span>
              {(hasActiveFilters || filterRunId) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-muted hover:text-foreground flex cursor-pointer items-center gap-1 text-[11px] font-medium transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear filters
                </button>
              )}
            </div>
            {filterControls}
          </div>

          <div ref={queueListRef} className="flex-1 overflow-y-auto px-2 pb-3">
            {filteredPosts.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <Search className="text-muted/60 mb-2 h-5 w-5" />
                <p className="text-muted text-xs leading-relaxed">
                  No posts match these filters.
                </p>
              </div>
            ) : (
              queuePagePosts.map((post, idx) => {
                const isActive = post.id === activePost?.id
                // Each page opens with its day, even one carried over.
                const showBucket =
                  idx === 0 ||
                  dayKey(queuePagePosts[idx - 1]!.createdAt) !==
                    dayKey(post.createdAt)
                const errors = countLintErrors(post.lintFindings)
                const status =
                  post.status === 'approved'
                    ? {
                        label: 'Approved',
                        dot: 'bg-emerald-500',
                        text: 'text-emerald-700 dark:text-emerald-400'
                      }
                    : post.status === 'rejected'
                      ? {
                          label: 'Rejected',
                          dot: 'bg-rose-500',
                          text: 'text-rose-700 dark:text-rose-400'
                        }
                      : {
                          label: 'In review',
                          dot: 'bg-amber-500',
                          text: 'text-amber-700 dark:text-amber-400'
                        }

                return (
                  <div key={post.id}>
                    {showBucket && (
                      <div className="bg-surface/95 text-muted sticky top-0 z-10 flex items-center gap-2 px-2 pt-4 pb-2 text-[10px] font-semibold tracking-wider uppercase backdrop-blur">
                        {bucketLabel(post.createdAt, hasMounted)}
                        <span className="bg-border/70 h-px flex-1" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectPost(post)}
                      aria-current={isActive ? 'true' : undefined}
                      title={post.accountName}
                      className={`group relative mb-1 w-full cursor-pointer rounded-xl border px-3.5 py-3 text-left transition-all duration-150 ${
                        isActive
                          ? 'border-border bg-surface-hover/70 shadow-xs'
                          : 'hover:bg-surface-hover/50 border-transparent'
                      }`}
                    >
                      {isActive && (
                        <span
                          className="bg-accent absolute top-3 bottom-3 left-0 w-0.5 rounded-full"
                          aria-hidden
                        />
                      )}

                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${status.text}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`}
                            aria-hidden
                          />
                          {status.label}
                        </span>
                        <span
                          className="text-muted ml-auto shrink-0 text-[10px] tabular-nums"
                          title={formatAbsoluteDateTime(post.createdAt)}
                        >
                          {hasMounted
                            ? formatRelativeDate(post.createdAt)
                            : formatAbsoluteDate(post.createdAt)}
                        </span>
                      </div>

                      {/* The hook is what actually identifies a post. */}
                      <p
                        className={`line-clamp-2 text-[13px] leading-snug tracking-tight ${
                          isActive
                            ? 'text-foreground font-medium'
                            : 'text-foreground/75 group-hover:text-foreground'
                        }`}
                      >
                        {post.hook}
                      </p>

                      <div className="text-muted mt-2 flex items-center gap-1.5 text-[10px]">
                        <span className="tabular-nums">
                          {post.charCount.toLocaleString()} chars
                        </span>
                        {post.media && (
                          <span className="bg-surface-hover inline-flex items-center gap-1 rounded-md px-1.5 py-0.5">
                            <ImageIcon className="h-2.5 w-2.5" />
                            Media
                          </span>
                        )}
                        {post.citationCount > 0 && (
                          <span
                            className="bg-surface-hover inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums"
                            title={`${post.citationCount} source${post.citationCount === 1 ? '' : 's'}`}
                          >
                            <Quote className="h-2.5 w-2.5" />
                            {post.citationCount}
                          </span>
                        )}
                        {errors > 0 && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-1.5 py-0.5 font-medium text-rose-600 tabular-nums dark:text-rose-400"
                            title={`${errors} lint error${errors === 1 ? '' : 's'}`}
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {errors}
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                )
              })
            )}

            {/* Older posts load after the last page of the ones loaded. */}
            {nextCursor && queuePageInfo.page === queuePageInfo.pageCount && (
              <div className="flex flex-col items-center gap-2 px-2 pt-4 pb-2 text-center">
                <p className="text-muted text-[11px] leading-relaxed">
                  Showing the newest {posts.length} of {totalCount} posts. Search
                  and filters cover the posts loaded so far.
                </p>
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  className="border-border text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 text-[12px] font-medium transition-colors disabled:opacity-60"
                >
                  {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Load older posts
                </button>
              </div>
            )}
          </div>
          {queuePageInfo.pageCount > 1 && (
            <div className="border-border border-t px-3 py-2.5">
              <Pagination
                {...queuePageInfo}
                noun="posts"
                onPageChange={openQueuePage}
              />
            </div>
          )}
        </aside>

        <div className="bg-surface-hover/30 flex-1 overflow-y-auto p-4 sm:p-6 lg:py-8 lg:pr-2 lg:pl-8">
          <div className="mx-auto max-w-6xl space-y-6 lg:mr-0 lg:max-w-none">
          <div className="space-y-2 lg:hidden">
            {filterControls}
            {(hasActiveFilters || filterRunId) && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-muted hover:text-foreground flex cursor-pointer items-center gap-1 text-xs font-medium"
              >
                <X className="h-3 w-3" />
                Clear filters
              </button>
            )}
          </div>
          {filteredPosts.length === 0 || !activePost ? (
            <div className="border-border bg-surface rounded-2xl border-2 border-dashed p-16 text-center">
              {posts.length === 0 ? (
                <>
                  <FileCheck className="text-muted mx-auto mb-3 h-10 w-10" />
                  <h3 className="text-foreground text-sm font-semibold">
                    No drafted posts yet
                  </h3>
                  <p className="text-muted mx-auto mt-1 max-w-sm text-xs">
                    Approve concepts on the Ideas page to draft grounded posts.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push('/ideas')}
                    className="bg-accent text-background mt-4 h-8 cursor-pointer rounded-lg px-3.5 text-[13px] font-semibold transition-opacity hover:opacity-90"
                  >
                    Go to Ideas
                  </button>
                </>
              ) : (
                <>
                  <Search className="text-muted mx-auto mb-3 h-10 w-10" />
                  <h3 className="text-foreground text-sm font-semibold">
                    No posts match these filters
                  </h3>
                  <p className="text-muted mx-auto mt-1 max-w-sm text-xs">
                    {posts.length} post{posts.length === 1 ? '' : 's'} exist in
                    total. Widen the date range or clear the filters to see them.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      clearFilters()
                    }}
                    className="bg-surface-hover border-border text-foreground hover:bg-surface-hover/80 mt-4 h-8 cursor-pointer rounded-lg border px-3.5 text-[13px] font-semibold transition-colors"
                  >
                    Clear all filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* TWO-COLUMN REVIEW WORKSPACE (Left: LinkedIn Preview; Right: Compact Review Panel) */}
              <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
                {/* ============================================================ */}
                {/* LEFT COLUMN: PRIMARY VISUAL AREA (LinkedIn Feed Preview)     */}
                {/* ============================================================ */}
                <div className="space-y-4 lg:col-span-7">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-muted text-xs font-semibold tracking-wider uppercase">
                      LinkedIn Feed Appearance
                    </span>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={handleCopyPost}
                        className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium"
                      >
                        {copiedPost ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedPost ? 'Copied' : 'Copy text'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditing(!isEditing)}
                        className="text-accent inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        <span>
                          {isEditing ? 'View Feed Preview' : 'Edit Post Text'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* IN-PLACE TEXT EDITOR OR REALISTIC FEED PREVIEW */}
                  {isEditing ? (
                    <div className="border-border bg-surface space-y-4 rounded-2xl border p-6 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-foreground text-xs font-semibold">
                          Edit Draft Copy
                        </span>
                        <span className="text-muted font-mono text-xs">
                          Hook: {editedHook.length} chars (fold ~200)
                        </span>
                      </div>
                      <div>
                        <label className="text-muted mb-1 block text-xs font-medium">
                          Opening Hook
                        </label>
                        <textarea
                          value={editedHook}
                          onChange={e => setEditedHook(e.target.value)}
                          rows={3}
                          className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-muted mb-1 block text-xs font-medium">
                          Body
                        </label>
                        <textarea
                          value={editedBody}
                          onChange={e => setEditedBody(e.target.value)}
                          rows={8}
                          className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 font-mono text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-muted mb-1 block text-xs font-medium">
                          First Comment
                        </label>
                        <textarea
                          value={editedComment}
                          onChange={e => setEditedComment(e.target.value)}
                          rows={2}
                          className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 text-xs outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={discardEdits}
                          className="text-muted hover:text-foreground h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEdits}
                          disabled={isSaving}
                          className="bg-accent text-background hover:bg-accent-hover h-7 cursor-pointer rounded-lg px-2.5 text-xs font-semibold disabled:opacity-50"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full justify-center">
                      <LinkedInPreview
                        key={activePost.id}
                        authorName={activePost.accountName}
                        authorHeadline={activePost.accountHeadline}
                        authorInitials={authorInitials}
                        hook={shownHook}
                        body={shownBody}
                        cta={activePost.cta}
                        hashtags={activePost.hashtags}
                        mediaUrl={activePost.media?.imageUrl}
                        mediaAltText={activePost.media?.altText}
                        foldCharLimit={200}
                        onMediaClick={
                          activePost.media?.imageUrl
                            ? () => setIsImageZoomOpen(true)
                            : undefined
                        }
                        // Swapping the hook edits the post, so it's offered only while active.
                        hookOptions={hookOptions.length > 1 ? hookOptions : []}
                        onSelectHook={handleSwapHook}
                        hookSwapDisabled={isSaving}
                        firstComment={shownComment}
                        onCopyFirstComment={handleCopyComment}
                        firstCommentCopied={copiedComment}
                      />
                    </div>
                  )}
                </div>

                {/* ============================================================ */}
                {/* RIGHT COLUMN: COMPACT REVIEW & CONTROL PANEL                 */}
                {/* ============================================================ */}
                <div className="space-y-4 lg:sticky lg:top-4 lg:col-span-5 lg:self-start">
                  {/* Zoom viewer — portals to <body>, so its position here is irrelevant */}
                  {isImageZoomOpen && activePost.media?.imageUrl && (
                    <ImageLightbox
                      src={activePost.media.imageUrl}
                      alt={activePost.media.altText || 'Post image'}
                      width={activePost.media.width || 2048}
                      height={activePost.media.height || 1072}
                      onClose={() => setIsImageZoomOpen(false)}
                    />
                  )}

                  {/* ERROR BANNER */}
                  {mediaError && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
                      <span>{mediaError}</span>
                      <button
                        type="button"
                        onClick={() => setMediaError(null)}
                        className="cursor-pointer p-1 hover:text-rose-700 dark:hover:text-rose-300"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* NEUTRAL NOTICE (e.g. generation stopped) */}
                  {mediaNotice && (
                    <div className="border-border bg-surface-hover text-muted flex items-center justify-between gap-2 rounded-xl border p-3 text-xs">
                      <span className="flex items-center gap-1.5">
                        <Info className="h-3.5 w-3.5 shrink-0" />
                        {mediaNotice}
                      </span>
                      <button
                        type="button"
                        onClick={() => setMediaNotice(null)}
                        className="hover:text-foreground cursor-pointer p-1"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* MEDIA RELEVANCE WARNING (if weak or unrelated). An image the
                      reviewer described is not scored, but its lettering is. */}
                  {activePost.media?.imageUrl &&
                    (isUserPromptedMedia
                      ? Boolean(activePost.media.issues?.length)
                      : !relevanceInfo.isPass) && (
                      <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs">
                        <div className="flex items-start gap-2 font-medium text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <div>
                            <p className="font-semibold">
                              {activePost.media.issues?.length
                                ? 'Check this image before posting'
                                : 'Media may not match this post'}
                            </p>
                            {/* Every problem the checks found, not just the first: a
                                misspelt label and a covered headline need different fixes. */}
                            {activePost.media.issues?.length ? (
                              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300/80">
                                {activePost.media.issues.map(issue => (
                                  <li key={issue}>{issue}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300/80">
                                {relevanceInfo.warningMessage ||
                                  'Generated media appears to introduce a different topic.'}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isMediaLoading}
                            onClick={() => {
                              setShowStockInput(true)
                              setShowCustomUrlInput(false)
                            }}
                            className="border-border bg-surface hover:bg-surface-hover h-7 cursor-pointer rounded-lg border px-2.5 text-xs font-medium transition-colors"
                          >
                            Change media
                          </button>
                          <button
                            type="button"
                            disabled={isMediaLoading}
                            onClick={handleRemoveMedia}
                            className="h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
                          >
                            Use text only
                          </button>
                        </div>
                      </div>
                    )}

                  {/* 1. COMPACT MEDIA REVIEW CARD (No duplicate large image) */}
                  <div className="border-border bg-surface space-y-2 rounded-2xl border p-5 shadow-xs mt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                        <ImageIcon className="text-accent h-3.5 w-3.5" />
                        Media Attachment
                      </span>
                      {activePost.media?.imageUrl && isUserPromptedMedia ? (
                        <span className="border-accent/20 bg-accent/10 text-accent inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                          <Sparkles className="h-3 w-3" />
                          {reviewerMediaLabel}
                        </span>
                      ) : activePost.media?.imageUrl ? null : activePost.media ? (
                        <span className="text-muted bg-surface-hover rounded-full px-2 py-0.5 text-[10px] font-medium">
                          {activeImageLoadError
                            ? 'Image not loaded'
                            : 'Loading image'}
                        </span>
                      ) : (
                        <span className="text-muted bg-surface-hover rounded-full px-2 py-0.5 text-[10px] font-medium">
                          Text Only
                        </span>
                      )}
                    </div>

                    {isMediaLoading && !mediaBusyHere && (
                      <p className="text-muted text-[11px]">
                        An image for another post is still being processed.
                        Media actions here unlock when it finishes.
                      </p>
                    )}

                    {mediaBusyHere ? (
                      <div className="border-border bg-surface-hover/50 text-muted flex animate-pulse flex-col items-center justify-center space-y-2 rounded-xl border py-6 text-xs">
                        <Loader2 className="text-accent h-5 w-5 animate-spin" />
                        <p className="text-foreground font-medium">
                          {mediaLoadingText || 'Processing media asset...'}
                        </p>
                      </div>
                    ) : activePost.media?.imageUrl ? (
                      <div className="space-y-2">
                        <div className="bg-surface-hover/40 border-border/60 flex items-start gap-3 rounded-xl border p-2.5">
                          {/* Compact 64x64 thumbnail */}
                          <button
                            type="button"
                            onClick={() => setIsImageZoomOpen(true)}
                            title="Zoom image"
                            className="border-border relative h-16 w-16 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border bg-neutral-900"
                          >
                            <Image
                              src={activePost.media.imageUrl}
                              alt={
                                activePost.media.altText || 'Media thumbnail'
                              }
                              width={64}
                              height={64}
                              className="h-full w-full object-cover"
                              unoptimized
                            />
                          </button>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-foreground line-clamp-2 text-xs leading-snug font-medium">
                              &quot;{mediaHeadline}&quot;
                            </p>
                            <div className="text-muted flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                              <span>
                                Media v{activePost.media.version || 1}
                              </span>
                              <span>•</span>
                              {activePost.media.width &&
                              activePost.media.height ? (
                                <span className="text-foreground font-medium">
                                  {activePost.media.width} ×{' '}
                                  {activePost.media.height} HD
                                </span>
                              ) : (
                                <span className="capitalize">
                                  {activePost.media.mode.replace('_', ' ')}
                                </span>
                              )}
                              {activePost.media.workflow === 'edit' && (
                                <>
                                  <span>•</span>
                                  <span>edited</span>
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-2.5 pt-0.5">
                              <button
                                type="button"
                                onClick={handleDownloadMedia}
                                className="text-accent inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium hover:underline"
                              >
                                <Download className="h-3 w-3" />
                                Download image
                              </button>
                              <button
                                type="button"
                                disabled={isMediaLoading}
                                onClick={handleRemoveMedia}
                                className="text-muted inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium hover:text-rose-600 dark:hover:text-rose-400"
                              >
                                <Trash2 className="h-3 w-3" />
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsImageZoomOpen(true)}
                          aria-label="Zoom image"
                          className="group border-border relative block w-full cursor-zoom-in overflow-hidden rounded-xl border bg-neutral-900"
                        >
                          <Image
                            src={activePost.media.imageUrl}
                            alt={activePost.media.altText || 'Generated visual'}
                            width={2048}
                            height={1072}
                            className="h-auto w-full object-contain"
                            unoptimized
                          />
                          <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            <ZoomIn className="h-3 w-3" />
                            Zoom
                          </span>
                        </button>
                      </div>
                    ) : isActiveImageLoading ? (
                      <div className="border-border bg-surface-hover/50 text-muted flex items-center justify-center gap-2 rounded-xl border py-6 text-xs">
                        <Loader2 className="text-accent h-4 w-4 animate-spin" />
                        <span>Loading image...</span>
                      </div>
                    ) : activeImageLoadError ? (
                      // The image is still attached; only this load failed.
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          Couldn&apos;t load this post&apos;s image:{' '}
                          {activeImageLoadError}
                        </span>
                        <button
                          type="button"
                          onClick={retryImageLoad}
                          className="border-border bg-surface hover:bg-surface-hover text-foreground h-7 shrink-0 cursor-pointer rounded-lg border px-2.5 text-xs font-medium transition-colors"
                        >
                          Retry
                        </button>
                      </div>
                    ) : activePost.mediaFailure ? (
                      // Drafting tried to make an image for this post and could not.
                      <div className="flex items-start gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          The image for this post could not be made during
                          drafting: {activePost.mediaFailure} Generate one below.
                        </span>
                      </div>
                    ) : null}

                    {/* Stock search input */}
                    {showStockInput && !mediaBusyHere && (
                      <div className="border-border bg-surface-hover space-y-2 rounded-xl border p-3">
                        <label className="text-foreground block text-[11px] font-semibold">
                          Search Stock Imagery
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={stockSearchQuery}
                            onChange={e => setStockSearchQuery(e.target.value)}
                            placeholder={`e.g. ${activePost.hook.slice(0, 35)}...`}
                            className="border-border bg-surface text-foreground focus:border-accent flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                            aria-invalid={
                              stockSearchQuery.trim().length > 0 &&
                              stockQueryError !== null
                            }
                            onKeyDown={e =>
                              e.key === 'Enter' &&
                              !stockQueryError &&
                              handleSearchStockMedia()
                            }
                          />
                          <button
                            type="button"
                            disabled={
                              isMediaLoading || stockQueryError !== null
                            }
                            onClick={handleSearchStockMedia}
                            className="bg-accent text-background hover:bg-accent-hover cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Search
                          </button>
                        </div>
                        {stockSearchQuery.trim().length > 0 &&
                          stockQueryError && (
                            <p className="text-[11px] text-rose-600 dark:text-rose-400">
                              {stockQueryError}
                            </p>
                          )}
                      </div>
                    )}

                    {/* Custom URL input */}
                    {showCustomUrlInput && !mediaBusyHere && (
                      <div className="border-border bg-surface-hover space-y-2 rounded-xl border p-3">
                        <label className="text-foreground block text-[11px] font-semibold">
                          Direct Image URL
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            value={customImageUrl}
                            onChange={e => setCustomImageUrl(e.target.value)}
                            placeholder="https://images.unsplash.com/..."
                            className="border-border bg-surface text-foreground focus:border-accent flex-1 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                            aria-invalid={
                              customImageUrl.trim().length > 0 &&
                              customUrlError !== null
                            }
                            onKeyDown={e =>
                              e.key === 'Enter' &&
                              !customUrlError &&
                              handleApplyCustomUrl()
                            }
                          />
                          <button
                            type="button"
                            disabled={isMediaLoading || customUrlError !== null}
                            onClick={handleApplyCustomUrl}
                            className="bg-accent text-background hover:bg-accent-hover cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Apply
                          </button>
                        </div>
                        {customImageUrl.trim().length > 0 && customUrlError && (
                          <p className="text-[11px] text-rose-600 dark:text-rose-400">
                            {customUrlError}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Optional image type for a design from the post; an
                        edit of the current image keeps its own. */}
                    {!mediaBusyHere && !referenceMediaId && (
                      <div className="border-border bg-surface-hover/50 space-y-2 rounded-xl border p-3">
                        <div className="flex items-baseline justify-between">
                          <span
                            id="image-type-label"
                            className="text-foreground text-[11px] font-semibold"
                          >
                            Image type
                          </span>
                          <span className="text-muted text-[10px]">
                            Optional
                          </span>
                        </div>
                        <div
                          role="radiogroup"
                          aria-labelledby="image-type-label"
                          className="flex flex-wrap gap-1.5"
                        >
                          {IMAGE_TYPE_OPTIONS.map(option => {
                            const active = imageType === option.value
                            const Icon = option.icon
                            return (
                              <button
                                key={option.label}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                title={option.description}
                                // A reference image sets the structure itself.
                                disabled={Boolean(referenceImage)}
                                onClick={() => setImageType(option.value)}
                                className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                  active
                                    ? 'border-accent bg-accent/10 text-foreground font-semibold'
                                    : 'border-border bg-surface text-muted hover:text-foreground'
                                }`}
                              >
                                <Icon
                                  className={`h-3 w-3 ${active ? 'text-accent' : ''}`}
                                />
                                {option.label}
                              </button>
                            )
                          })}
                        </div>
                        <p className="text-muted text-[10px]">
                          {referenceImage
                            ? null
                            : imagePrompt.trim()
                              ? 'Generate image follows your description below. The type is used by "Generate from post text".'
                              : IMAGE_TYPE_OPTIONS.find(o => o.value === imageType)
                                  ?.description}
                        </p>

                        <div className="border-border space-y-2 border-t pt-2">
                          <div className="flex items-center justify-between gap-2">
                            <span
                              id="image-background-label"
                              className="text-foreground text-[11px] font-semibold"
                            >
                              Background
                            </span>
                            <div
                              role="radiogroup"
                              aria-labelledby="image-background-label"
                              className="flex gap-1.5"
                            >
                              {BACKGROUND_PATTERNS.map(pattern => {
                                const active = imagePattern === pattern.value
                                return (
                                  <button
                                    key={pattern.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    // A reference image brings its own background.
                                    disabled={Boolean(referenceImage)}
                                    onClick={() =>
                                      !active &&
                                      handleSaveImageSettings({
                                        pattern: pattern.value,
                                        footer: savedFooter
                                      })
                                    }
                                    className={`inline-flex h-6 cursor-pointer items-center rounded-full border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                      active
                                        ? 'border-accent bg-accent/10 text-foreground font-semibold'
                                        : 'border-border bg-surface text-muted hover:text-foreground'
                                    }`}
                                  >
                                    {pattern.label}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <label
                              htmlFor="image-footer"
                              className="text-foreground shrink-0 text-[11px] font-semibold"
                            >
                              Website
                            </label>
                            <input
                              id="image-footer"
                              value={footerDraft}
                              maxLength={FOOTER_MAX_LENGTH}
                              placeholder={`e.g. ${brand.website || 'yourcompany.com'}`}
                              onChange={e => setFooterDraft(e.target.value)}
                              onBlur={() => {
                                const footer = footerDraft.trim()
                                setFooterDraft(footer)
                                if (footer !== savedFooter)
                                  handleSaveImageSettings({
                                    pattern: imagePattern,
                                    footer
                                  })
                              }}
                              onKeyDown={e =>
                                e.key === 'Enter' && e.currentTarget.blur()
                              }
                              className="border-border bg-surface text-foreground placeholder:text-muted focus:border-accent w-44 min-w-0 rounded-lg border px-2 py-1 text-[11px] outline-none"
                            />
                          </div>
                         
                        </div>
                      </div>
                    )}

                    {/* Prompt-driven generation */}
                    {!mediaBusyHere && (
                      <div className="border-border bg-surface-hover/50 space-y-2 rounded-xl border p-3">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="image-prompt"
                            className="text-foreground block text-[11px] font-semibold"
                          >
                            {referenceMediaId
                              ? 'Describe the change you want'
                              : referenceImage
                                ? 'Add direction (optional)'
                                : 'Describe the image you want'}
                          </label>
                          {(imagePrompt || referenceImage) && (
                            <button
                              type="button"
                              onClick={clearPromptAndReference}
                              className="text-muted hover:text-foreground cursor-pointer text-[11px] font-medium"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <textarea
                          id="image-prompt"
                          value={imagePrompt}
                          onChange={e => setImagePrompt(e.target.value)}
                          onPaste={handleReferencePaste}
                          // Enter does what the main button does; Shift+Enter
                          // starts a new line.
                          onKeyDown={e => {
                            if (
                              e.key !== 'Enter' ||
                              e.shiftKey ||
                              e.nativeEvent.isComposing
                            ) {
                              return
                            }
                            e.preventDefault()
                            if (isMediaLoading || mainButtonBlocked) return
                            void (regenerateFromPost
                              ? handleGenerateFromPost()
                              : handleGenerateFromPrompt())
                          }}
                          rows={5}
                          placeholder={
                            referenceMediaId
                              ? 'e.g. Replace the headline with "Ship it", or make the background warmer'
                              : referenceImage
                                ? 'e.g. Show the moment the team first sees the results'
                                : 'e.g. A minimal isometric illustration of two paths splitting, lots of negative space'
                          }
                          aria-invalid={showPromptError}
                          aria-describedby="image-prompt-hint"
                          className="border-border bg-surface text-foreground focus:border-accent w-full resize-y rounded-lg border px-2.5 py-2 text-xs outline-none aria-invalid:border-rose-500"
                        />
                        <div
                          id="image-prompt-hint"
                          className="flex items-start justify-between gap-2 text-[11px]"
                        >
                          {showPromptError ? (
                            <span className="text-rose-600 dark:text-rose-400">
                              {promptError}
                            </span>
                          ) : null}
                          <span
                            className={`shrink-0 tabular-nums ${
                              countWords(imagePrompt) > IMAGE_PROMPT_MAX_WORDS
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-muted'
                            }`}
                          >
                            {countWords(imagePrompt)}/{IMAGE_PROMPT_MAX_WORDS}{' '}
                            words
                          </span>
                        </div>

                        {referenceImage ? (
                          <div className="border-border bg-surface flex items-center gap-2.5 rounded-lg border p-2">
                            <Image
                              src={referenceImage}
                              alt="Reference"
                              width={40}
                              height={40}
                              className="border-border h-10 w-10 shrink-0 rounded border object-cover"
                              unoptimized
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-foreground truncate text-[11px] font-medium">
                                {referenceImageName}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={clearReferenceImage}
                              title="Remove reference image"
                              className="text-muted hover:text-foreground cursor-pointer p-1"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <button
                              type="button"
                              onClick={() => referenceInputRef.current?.click()}
                              className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium"
                            >
                              <Paperclip className="h-3 w-3" />
                              Attach a reference image to copy its layout
                            </button>
                            {activePost.media?.imageUrl && (
                              <button
                                type="button"
                                onClick={useCurrentImageAsReference}
                                className="text-accent inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-medium hover:underline"
                              >
                                <ImageIcon className="h-3 w-3" />
                                Use current image
                              </button>
                            )}
                          </div>
                        )}

                        <input
                          ref={referenceInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (file) loadReferenceImage(file)
                            // Reset so choosing the same file again still fires onChange.
                            e.target.value = ''
                          }}
                        />
                      </div>
                    )}

                    {/* Generation from the post's own text; with a reference
                        attached, the main button already does this. */}
                    {!mediaBusyHere && !guidedByReference && (
                      <div className="space-y-1">
                        <button
                          type="button"
                          disabled={isEditing || isMediaLoading}
                          onClick={handleGenerateFromPost}
                          title={
                            isEditing
                              ? 'Save your edits first so the image matches the post'
                              : undefined
                          }
                          className="border-accent/40 text-accent hover:bg-accent/10 flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>Generate from post text</span>
                        </button>
                        <p className="text-muted text-[10px]">
                          {isEditing
                            ? 'Save your edits first so the image matches the post.'
                            : null}
                        </p>
                      </div>
                    )}

                    {/* Every generated image gets these; set on the Brand Theme page */}
                    {!mediaBusyHere && (
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        {brand.hasLogo || brand.colors.length > 0 ? (
                          <span className="text-muted inline-flex min-w-0 items-center gap-1.5">
                            {brand.colors.map(color => (
                              <span
                                key={color}
                                aria-hidden
                                className="border-border h-3 w-3 shrink-0 rounded-full border"
                                style={{ background: color }}
                              />
                            ))}
                            <span className="truncate">
                              {brand.hasLogo && brand.colors.length > 0
                                ? 'Your logo and brand colours go on every image.'
                                : brand.hasLogo
                                  ? 'Your logo goes on every image.'
                                  : 'Your brand colours go into every image.'}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">
                            No logo or brand colours yet.
                          </span>
                        )}
                        <Link
                          href={BRAND_THEME_PATH}
                          className="text-accent inline-flex shrink-0 items-center gap-1 font-medium hover:underline"
                        >
                          <Palette className="h-3 w-3" />
                          Brand Theme
                        </Link>
                      </div>
                    )}

                    {/* Primary & Secondary Media Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {isGenerating && mediaBusyHere ? (
                        <button
                          type="button"
                          onClick={handleStopGeneration}
                          className="flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400"
                        >
                          <CircleStop className="h-3.5 w-3.5" />
                          <span>Stop generating</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isMediaLoading || mainButtonBlocked}
                          onClick={
                            regenerateFromPost
                              ? handleGenerateFromPost
                              : handleGenerateFromPrompt
                          }
                          title={
                            (regenerateFromPost || guidedByReference) &&
                            isEditing
                              ? 'Save your edits first so the image matches the post'
                              : undefined
                          }
                          className="bg-accent hover:bg-accent-hover text-background flex h-7 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {mediaBusyHere ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {activePost.media?.imageUrl
                              ? 'Regenerate image'
                              : 'Generate image'}
                          </span>
                        </button>
                      )}

                      <div className="relative">
                        <button
                          type="button"
                          disabled={isMediaLoading}
                          onClick={() => setMediaMenuOpen(!mediaMenuOpen)}
                          className="border-border hover:bg-surface-hover text-foreground flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>Change media</span>
                          <ChevronDown className="text-muted h-3.5 w-3.5" />
                        </button>

                        {mediaMenuOpen && (
                          <div className="border-border bg-surface animate-in fade-in zoom-in-95 absolute right-0 z-20 mt-1 w-52 rounded-xl border py-1.5 text-xs shadow-xl duration-100">
                            <button
                              type="button"
                              onClick={() => {
                                setMediaMenuOpen(false)
                                setShowStockInput(true)
                                setShowCustomUrlInput(false)
                              }}
                              className="hover:bg-surface-hover text-foreground flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left"
                            >
                              <Search className="h-3.5 w-3.5 text-blue-500" />
                              <span>Find stock image</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMediaMenuOpen(false)
                                setShowCustomUrlInput(true)
                                setShowStockInput(false)
                              }}
                              className="hover:bg-surface-hover text-foreground flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left"
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-emerald-500" />
                              <span>Use custom image URL</span>
                            </button>
                            {activePost.media && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMediaMenuOpen(false)
                                  handleRemoveMedia()
                                }}
                                className="border-border mt-1 flex w-full cursor-pointer items-center gap-2 border-t px-3.5 py-2 text-left text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>Text only (remove media)</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* B. QUALITY CHECKS (Summary by default: "✓ 6 checks passed") */}
                  <div className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs">
                    <button
                      type="button"
                      onClick={() => setShowQualityChecks(!showQualityChecks)}
                      className="text-foreground hover:bg-surface-hover/50 flex w-full cursor-pointer items-center justify-between p-4 text-xs font-semibold transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <FileCheck className="text-accent h-3.5 w-3.5" />
                        Quality Checks
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            hasLintIssues
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {hasLintIssues ? (
                            <>
                              <AlertTriangle className="h-3 w-3" />
                              <span>
                                {totalLintCount - passedLintCount} to review
                              </span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              <span>{passedLintCount} checks passed</span>
                            </>
                          )}
                        </span>
                        {showQualityChecks ? (
                          <ChevronUp className="text-muted h-4 w-4" />
                        ) : (
                          <ChevronDown className="text-muted h-4 w-4" />
                        )}
                      </div>
                    </button>

                    {showQualityChecks && (
                      <div className="divide-border/60 border-border/40 divide-y border-t p-4 pt-0 text-xs">
                        {lintFindings.length === 0 ? (
                          <p className="text-muted py-2 text-xs">
                            All standard LinkedIn checks verified.
                          </p>
                        ) : (
                          lintFindings.map((finding, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2.5 py-2.5"
                            >
                              {finding.passed ? (
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                              ) : finding.severity === 'error' ? (
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                              ) : (
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                              )}
                              <div className="min-w-0 flex-1">
                                <span className="text-foreground block text-xs font-medium">
                                  {getHumanRuleLabel(finding.rule)}
                                </span>
                                <p className="text-muted mt-0.5 text-[11px]">
                                  {finding.message}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>


                </div>
              </div>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

type PostFilters = {
  status: StatusFilter
  /** yyyy-mm-dd; empty means that end is open. */
  from: string
  to: string
  sort: SortOrder
}

const DEFAULT_FILTERS: PostFilters = {
  status: 'all',
  from: '',
  to: '',
  sort: 'newest'
}

const filterFieldClass =
  'border-border bg-surface text-foreground focus:border-accent w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs outline-none'

/**
 * The Filters button and its panel. Choices are only a draft until Apply, so
 * the queue does not jump around while they are being set.
 *
 * The toolbar scrolls sideways, which would clip an absolutely placed panel,
 * so the panel is portalled to the body and placed against the window.
 */
function PostFiltersMenu({
  value,
  statusCounts,
  today,
  onApply
}: {
  value: PostFilters
  statusCounts: Record<StatusFilter, number>
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

  const activeCount =
    (value.status !== 'all' ? 1 : 0) +
    (value.from || value.to ? 1 : 0) +
    (value.sort !== 'newest' ? 1 : 0)

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
        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          activeCount > 0
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border bg-surface text-foreground hover:bg-surface-hover'
        }`}
      >
        <ListFilter className="h-3.5 w-3.5" />
        Filters
        {activeCount > 0 && (
          <span className="bg-accent text-background rounded-full px-1.5 text-[10px] leading-4 font-semibold tabular-nums">
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
              // The page's review shortcuts (A, R, J, K…) listen on window;
              // keys typed here must not reach them.
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
              <div className="space-y-1.5">
                <label
                  htmlFor="filter-status"
                  className="text-foreground block text-xs font-semibold"
                >
                  Status
                </label>
                <select
                  id="filter-status"
                  autoFocus
                  value={draft.status}
                  onChange={e => set({ status: e.target.value as StatusFilter })}
                  className={filterFieldClass}
                >
                  {(
                    ['all', 'awaiting_review', 'approved', 'rejected'] as StatusFilter[]
                  ).map(status => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]} ({statusCounts[status]})
                    </option>
                  ))}
                </select>
              </div>

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

              <div className="space-y-1.5">
                <label
                  htmlFor="filter-sort"
                  className="text-foreground block text-xs font-semibold"
                >
                  Sort
                </label>
                <select
                  id="filter-sort"
                  value={draft.sort}
                  onChange={e => set({ sort: e.target.value as SortOrder })}
                  className={filterFieldClass}
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>

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
  brand
}: {
  initialPosts: PostDetail[]
  initialNextCursor: string | null
  totalCount: number
  identity: IdentitySummary
  brand: BrandSummary
}) {
  return (
    <Suspense
      fallback={
        <div className="bg-background flex h-screen items-center justify-center">
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
        brand={brand}
      />
    </Suspense>
  )
}
