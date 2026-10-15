'use client'

import { ImageLightbox } from '@/components/image-lightbox'
import { LinkedInPreview } from '@/components/linkedin-preview'
import { PageHeader } from '@/components/page-header'
import { showToast } from '@/components/toast-notification'
import type { LintFinding } from '@/lib/lint/run-linter'
import type { ActiveAccount } from '@/lib/active-account'
import {
  IMAGE_PROMPT_MAX_WORDS,
  countWords,
  validateImagePrompt,
  validateImageUrl,
  validateReferenceDimensions,
  validateReferenceFile,
  validateStockQuery
} from '@/lib/media/image-input'
import { getUserFacingRelevance } from '@/lib/media/relevance-label'
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleStop,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  FileCheck,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  Paperclip,
  Quote,
  Search,
  Sparkles,
  Trash2,
  X,
  ZoomIn
} from 'lucide-react'
import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import {
  approveDraft,
  fetchPostMediaImage,
  regeneratePostMediaAction,
  rejectDraft,
  removePostMediaAction,
  updateDraft,
  updatePostMediaAction
} from './actions'

export interface PostDetail {
  id: string
  accountId: string
  accountName: string
  accountHeadline?: string | null
  runId?: string | null
  hook: string
  body: string
  cta?: string | null
  firstComment?: string | null
  hashtags: string[]
  charCount: number
  status: string
  createdAt: Date | string
  variants: Array<{ id: string; variantType: string; content: string }>
  citations: Array<{
    id: string
    claim: string
    quote?: string | null
    sourceUrl?: string | null
    sourceTitle?: string | null
  }>
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
  } | null
  lintFindings: LintFinding[]
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

type DateRange = 'all' | 'today' | '7d' | '30d'
type StatusFilter = 'all' | 'awaiting_review' | 'approved' | 'rejected'
type SortOrder = 'newest' | 'oldest'

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: 'All time',
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days'
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All statuses',
  awaiting_review: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected'
}

const DAY_MS = 86_400_000

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

/** Oldest boundary for a range, or null when unbounded. */
function rangeStart(range: DateRange): Date | null {
  if (range === 'all') return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  if (range === 'today') return start
  return new Date(start.getTime() - (range === '7d' ? 6 : 29) * DAY_MS)
}

/**
 * Dates are formatted by hand rather than through `toLocaleString`, which
 * renders with Node's locale on the server and the browser's locale on the
 * client ("9/16/2026" vs "16/09/2026") and breaks hydration.
 */
function formatAbsoluteDate(value: Date | string): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  const day = date.getDate()
  const month = MONTHS[date.getMonth()]
  const year = date.getFullYear()
  return year === new Date().getFullYear()
    ? `${day} ${month}`
    : `${day} ${month} ${year}`
}

function formatAbsoluteDateTime(value: Date | string): string {
  const date = toDate(value)
  if (Number.isNaN(date.getTime())) return ''
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`
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

/**
 * False during SSR and the hydration render, true afterwards. Lets "now"-relative
 * text render only on the client without tripping a hydration mismatch.
 */
const emptySubscribe = () => () => {}
function useHasMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}

function countLintErrors(findings: LintFinding[] | undefined): number {
  return (findings || []).filter(f => f.severity === 'error' && !f.passed).length
}

export function PostsClientInner({
  initialPosts,
  activeAccount
}: {
  initialPosts: PostDetail[]
  activeAccount: ActiveAccount
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filterRunId = searchParams.get('runId')
  const hasMounted = useHasMounted()

  const [posts, setPosts] = useState<PostDetail[]>(initialPosts)
  const [selectedPostId, setSelectedPostId] = useState<string>(
    initialPosts.find(p => !filterRunId || p.runId === filterRunId)?.id ||
      initialPosts[0]?.id ||
      ''
  )
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  // The post just approved or rejected stays in the queue until you move on.
  // Otherwise filtering to "Awaiting review" and approving a post removed it
  // instantly and jumped to another one before it could be copied.
  const [pinnedPostId, setPinnedPostId] = useState<string | null>(null)

  // Active post editing state
  // Posts matching everything except the status facet, so the status counts can
  // show what switching to another status would actually reveal. All posts
  // here already belong to the active account (scoped server-side), so there
  // is no identity facet to filter on.
  const scopedPosts = posts.filter(p => {
    if (filterRunId && p.runId !== filterRunId) return false

    const start = rangeStart(dateRange)
    if (start && toDate(p.createdAt) < start) return false

    const query = searchQuery.trim().toLowerCase()
    if (query) {
      const haystack =
        `${p.hook} ${p.body} ${p.accountName} ${(p.hashtags || []).join(' ')}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }

    return true
  })

  const statusCounts = {
    all: scopedPosts.length,
    awaiting_review: scopedPosts.filter(p => p.status === 'awaiting_review')
      .length,
    approved: scopedPosts.filter(p => p.status === 'approved').length,
    rejected: scopedPosts.filter(p => p.status === 'rejected').length
  }

  const filteredPosts = scopedPosts
    .filter(
      p =>
        statusFilter === 'all' ||
        p.status === statusFilter ||
        p.id === pinnedPostId
    )
    .sort((a, b) => {
      const diff = toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
      return sortOrder === 'newest' ? diff : -diff
    })

  const hasActiveFilters =
    dateRange !== 'all' ||
    statusFilter !== 'all' ||
    searchQuery.trim().length > 0

  const clearFilters = () => {
    setDateRange('all')
    setStatusFilter('all')
    setSearchQuery('')
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

  // Media management state
  const [isMediaLoading, setIsMediaLoading] = useState(false)
  const [mediaLoadingText, setMediaLoadingText] = useState('')
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [showStockInput, setShowStockInput] = useState(false)
  const [stockSearchQuery, setStockSearchQuery] = useState('')
  const [showCustomUrlInput, setShowCustomUrlInput] = useState(false)
  const [customImageUrl, setCustomImageUrl] = useState('')
  const [showPostRejection, setShowPostRejection] = useState(false)
  const [postRejectionReason, setPostRejectionReason] = useState('')
  const [mediaMenuOpen, setMediaMenuOpen] = useState(false)
  const [isImageZoomOpen, setIsImageZoomOpen] = useState(false)

  // Prompt-driven image generation
  const [imagePrompt, setImagePrompt] = useState('')
  const [referenceImage, setReferenceImage] = useState<string | null>(null)
  const [referenceImageName, setReferenceImageName] = useState<string | null>(
    null
  )
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)

  // Leaving the page must not leave a generation running that would still save.
  useEffect(() => () => generationAbortRef.current?.abort(), [])

  // The page ships media metadata without the image bytes; load them for the
  // post being viewed, once per media record.
  const loadedImageIds = useRef<Set<string>>(new Set())
  const activeMediaId = activePost?.media?.id
  const activeMediaHasImage = Boolean(activePost?.media?.imageUrl)

  useEffect(() => {
    if (!activeMediaId || activeMediaHasImage) return
    if (loadedImageIds.current.has(activeMediaId)) return
    loadedImageIds.current.add(activeMediaId)

    let cancelled = false
    void fetchPostMediaImage(activeMediaId).then(res => {
      if (cancelled || !res.success) return
      setPosts(prev =>
        prev.map(p =>
          p.media && p.media.id === activeMediaId
            ? { ...p, media: { ...p.media, imageUrl: res.imageUrl } }
            : p
        )
      )
    })

    return () => {
      cancelled = true
    }
  }, [activeMediaId, activeMediaHasImage])

  // Collapsible drawers (all collapsed by default as requested)
  const [showAlternateHooks, setShowAlternateHooks] = useState(false)
  const [showQualityChecks, setShowQualityChecks] = useState(false)
  const [showCitations, setShowCitations] = useState(false)
  const [showAdvancedMedia, setShowAdvancedMedia] = useState(false)
  const [showFirstCommentDetail, setShowFirstCommentDetail] = useState(false)

  const currentIndex = filteredPosts.findIndex(p => p.id === activePost?.id)
  const totalPosts = filteredPosts.length

  const clearReferenceImage = () => {
    setReferenceImage(null)
    setReferenceImageName(null)
    if (referenceInputRef.current) referenceInputRef.current.value = ''
  }

  const handleSelectPost = (post: PostDetail) => {
    setSelectedPostId(post.id)
    setPinnedPostId(null)
    setEditedHook(post.hook)
    setEditedBody(post.body)
    setEditedComment(post.firstComment || '')
    setIsEditing(false)
    setShowStockInput(false)
    setShowCustomUrlInput(false)
    setShowPostRejection(false)
    setPostRejectionReason('')
    setMediaMenuOpen(false)
    setMediaError(null)
    setMediaNotice(null)
    setImagePrompt('')
    clearReferenceImage()
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

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        handleNextPost()
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
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

  const handleGenerateFromPrompt = async () => {
    if (!activePost || isMediaLoading) return

    const promptProblem = validateImagePrompt(imagePrompt)
    if (promptProblem) {
      setMediaError(promptProblem)
      return
    }

    const postId = activePost.id
    const controller = new AbortController()
    generationAbortRef.current = controller

    setIsMediaLoading(true)
    setIsGenerating(true)
    setMediaLoadingText(
      referenceImage
        ? 'Editing your reference image in HD...'
        : 'Generating your image in HD...'
    )
    setMediaError(null)
    setMediaNotice(null)
    setMediaMenuOpen(false)

    try {
      const response = await fetch(`/api/posts/${postId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imagePrompt.trim(),
          referenceImages: referenceImage ? [referenceImage] : undefined
        }),
        signal: controller.signal
      })
      const res = await response.json().catch(() => null)

      if (response.ok && res?.success && res.media) {
        setPosts(prev =>
          prev.map(p => (p.id === postId ? { ...p, media: res.media } : p))
        )
      } else {
        setMediaError(
          res?.error || `Image generation failed (HTTP ${response.status}).`
        )
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        setMediaNotice('Generation stopped. Edit your prompt and try again.')
      } else {
        setMediaError(
          err?.message
            ? `Could not reach the server: ${err.message}`
            : 'Could not reach the server. Check your connection and try again.'
        )
      }
    } finally {
      if (generationAbortRef.current === controller)
        generationAbortRef.current = null
      setIsGenerating(false)
      setIsMediaLoading(false)
      setMediaLoadingText('')
    }
  }

  // Aborting the fetch closes the request, which cancels generation server-side.
  const handleStopGeneration = () => {
    generationAbortRef.current?.abort()
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
    setIsMediaLoading(true)
    setMediaLoadingText('Searching royalty-free stock imagery...')
    setMediaError(null)

    try {
      const res = await regeneratePostMediaAction(activePost.id, {
        mode: 'stock',
        customPrompt: stockSearchQuery.trim() || undefined
      })
      if (res.success && res.media) {
        setPosts(prev =>
          prev.map(p =>
            p.id === activePost.id ? { ...p, media: res.media } : p
          )
        )
        setShowStockInput(false)
        setStockSearchQuery('')
      } else {
        setMediaError(res.error || 'Failed to search stock visual')
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to search stock visual')
    } finally {
      setIsMediaLoading(false)
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

    setIsMediaLoading(true)
    setMediaLoadingText('Attaching custom image...')
    setMediaError(null)

    try {
      const res = await updatePostMediaAction(activePost.id, {
        mode: 'stock',
        imageUrl: url,
        altText: `Custom visual for: ${activePost.hook.slice(0, 50)}`
      })

      if (res.success && res.media) {
        setPosts(prev =>
          prev.map(p =>
            p.id === activePost.id ? { ...p, media: res.media } : p
          )
        )
        setShowCustomUrlInput(false)
        setCustomImageUrl('')
      } else {
        setMediaError(res.error || 'Failed to update image URL')
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to update image URL')
    } finally {
      setIsMediaLoading(false)
      setMediaLoadingText('')
    }
  }

  const handleRemoveMedia = async () => {
    if (!activePost) return
    setIsMediaLoading(true)
    setMediaLoadingText('Switching to text-only mode...')
    setMediaError(null)
    setMediaMenuOpen(false)

    try {
      const res = await removePostMediaAction(activePost.id)
      if (res.success) {
        setPosts(prev =>
          prev.map(p => (p.id === activePost.id ? { ...p, media: null } : p))
        )
      } else {
        setMediaError(res.error || 'Failed to remove media')
      }
    } catch (err: any) {
      setMediaError(err?.message || 'Failed to remove media')
    } finally {
      setIsMediaLoading(false)
      setMediaLoadingText('')
    }
  }

  const handleSwapHook = async (newHook: string) => {
    setEditedHook(newHook)
    if (!activePost) return
    setIsSaving(true)
    try {
      await updateDraft(activePost.id, { hook: newHook })
      setPosts(prev =>
        prev.map(p => (p.id === activePost.id ? { ...p, hook: newHook } : p))
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveEdits = async () => {
    if (!activePost) return
    setIsSaving(true)
    try {
      await updateDraft(activePost.id, {
        hook: editedHook,
        body: editedBody,
        firstComment: editedComment
      })
      setPosts(prev =>
        prev.map(p =>
          p.id === activePost.id
            ? {
                ...p,
                hook: editedHook,
                body: editedBody,
                firstComment: editedComment,
                charCount: `${editedHook}\n\n${editedBody}`.length
              }
            : p
        )
      )
      setIsEditing(false)
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
    const tagsString = (activePost.hashtags || [])
      .map(t => (t.startsWith('#') ? t : `#${t}`))
      .join(' ')
    const fullContent = `${editedHook}\n\n${editedBody}${
      activePost.cta ? `\n\n${activePost.cta}` : ''
    }${tagsString ? `\n\n${tagsString}` : ''}`

    const success = await copyTextToClipboard(fullContent)
    if (success) {
      setCopiedPost(true)
      showToast({
        type: 'success',
        title: 'Post Copied!',
        message: 'Post text copied with clean line breaks, CTA, and hashtags.'
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
    if (!editedComment) return
    const success = await copyTextToClipboard(editedComment)
    if (success) {
      setCopiedComment(true)
      showToast({
        type: 'success',
        title: 'Comment Copied!',
        message: 'First comment text copied to clipboard.'
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

  const handleApprove = async () => {
    if (!activePost || activePost.status === 'approved') return
    setIsSaving(true)
    try {
      await approveDraft(activePost.id)
      // Stay on it: approving is followed by copying, not by the next post.
      setPinnedPostId(activePost.id)
      setPosts(prev =>
        prev.map(p =>
          p.id === activePost.id ? { ...p, status: 'approved' } : p
        )
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleReject = async (reason?: string) => {
    if (!activePost) return
    // Chosen before the status changes, while the queue order is still intact.
    const nextPost =
      filteredPosts[currentIndex + 1] || filteredPosts[currentIndex - 1] || null
    const rejectedId = activePost.id

    setIsSaving(true)
    try {
      await rejectDraft(rejectedId, reason?.trim() || undefined)
      setPosts(prev =>
        prev.map(p => (p.id === rejectedId ? { ...p, status: 'rejected' } : p))
      )
      setShowPostRejection(false)
      setPostRejectionReason('')

      // A rejected post needs nothing further, so move straight on.
      if (nextPost) {
        handleSelectPost(nextPost)
        showToast({
          type: 'success',
          title: 'Post rejected',
          message: reason?.trim()
            ? 'Your reason was saved to shape future drafts.'
            : 'Moved to the next post.'
        })
      } else {
        setPinnedPostId(rejectedId)
      }
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

      if (event.key === 'a') {
        event.preventDefault()
        void handleApprove()
      } else if (event.key === 'r') {
        event.preventDefault()
        setShowPostRejection(true)
      } else if (event.key === 'c') {
        event.preventDefault()
        void handleCopyPost()
      } else if (event.key === 'Escape' && showPostRejection) {
        setShowPostRejection(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePost?.id, activePost?.status, isSaving, showPostRejection, editedHook, editedBody])

  const authorInitials = activePost?.accountName
    ? activePost.accountName
        .split(' ')
        .map(w => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'IN'

  const alternateHooks =
    activePost?.variants?.filter(v => v.variantType === 'hook') || []
  const citations = activePost?.citations || []
  const lintFindings = activePost?.lintFindings || []
  const passedLintCount = lintFindings.filter(f => f.passed).length
  const totalLintCount = lintFindings.length
  const hasLintIssues = totalLintCount > 0 && passedLintCount < totalLintCount

  // Buttons stay disabled until their input is valid; messages only appear once the
  // user has typed something, so an untouched field is not shown as an error.
  const promptError = validateImagePrompt(imagePrompt)
  const showPromptError = imagePrompt.trim().length > 0 && promptError !== null
  const stockQueryError = validateStockQuery(stockSearchQuery)
  const customUrlError = validateImageUrl(customImageUrl)

  // Relevance is scored against the post thesis, which only makes sense for media
  // the pipeline derived itself. When the user dictated the image, skip the verdict.
  const isUserPromptedMedia = activePost?.media?.source === 'user_prompt'

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

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Review & Ship Posts"
        badge="Daily Surface"
        description={`Reviewing drafts for ${activeAccount.name} · @${activeAccount.handle}`}
        bottomContent={
          <div className="flex w-max min-w-full items-center gap-4">
            <div className="flex shrink-0 items-center gap-2">
              <div className="relative w-64 shrink-0">
                <Search className="text-muted pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search hooks, body, hashtags…"
                  className="border-border bg-surface text-foreground placeholder:text-muted focus:border-accent w-full rounded-lg border py-1.5 pr-3 pl-8 text-xs outline-none"
                />
              </div>

              {/* Status is the primary triage axis, so it keeps its counts. */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                aria-label="Filter by status"
                className="border-border bg-surface text-foreground focus:border-accent cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs outline-none"
              >
                {(
                  ['all', 'awaiting_review', 'approved', 'rejected'] as StatusFilter[]
                ).map(status => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]} ({statusCounts[status]})
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5">
                <CalendarDays className="text-muted h-3.5 w-3.5" />
                <select
                  value={dateRange}
                  onChange={e => setDateRange(e.target.value as DateRange)}
                  className="border-border bg-surface text-foreground focus:border-accent cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                >
                  {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map(range => (
                    <option key={range} value={range}>
                      {DATE_RANGE_LABELS[range]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="text-muted h-3.5 w-3.5" />
                <select
                  value={sortOrder}
                  onChange={e => setSortOrder(e.target.value as SortOrder)}
                  className="border-border bg-surface text-foreground focus:border-accent cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>

              {(hasActiveFilters || filterRunId) && (
                <button
                  type="button"
                  onClick={() => {
                    clearFilters()
                    if (filterRunId) router.push('/posts')
                  }}
                  className="text-muted hover:text-foreground flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors"
                >
                  <X className="h-3 w-3" />
                  Clear
                </button>
              )}
            </div>
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* QUEUE RAIL — replaces a strip of "Post #1…#90" pills that carried no
            information about the posts they pointed at. */}
        <aside className="border-border bg-surface hidden w-[320px] shrink-0 flex-col border-r lg:flex">
          <div className="border-border text-muted flex items-center justify-between border-b px-4 py-2.5 text-[11px] font-semibold tracking-wider uppercase">
            <span>Queue</span>
            <span className="tabular-nums">
              {totalPosts} post{totalPosts === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredPosts.length === 0 ? (
              <p className="text-muted px-4 py-6 text-xs leading-relaxed">
                No posts match these filters.
              </p>
            ) : (
              filteredPosts.map((post, idx) => {
                const isActive = post.id === activePost?.id
                const showBucket =
                  idx === 0 ||
                  dayKey(filteredPosts[idx - 1]!.createdAt) !==
                    dayKey(post.createdAt)
                const errors = countLintErrors(post.lintFindings)

                return (
                  <div key={post.id}>
                    {showBucket && (
                      <div className="bg-surface-hover/60 text-muted border-border/60 border-y px-4 py-1.5 text-[10px] font-semibold tracking-wider uppercase">
                        {bucketLabel(post.createdAt, hasMounted)}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectPost(post)}
                      className={`border-border/60 w-full cursor-pointer border-b px-4 py-3 text-left transition-colors ${
                        isActive
                          ? 'bg-accent/10 border-l-accent border-l-2'
                          : 'hover:bg-surface-hover border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            post.status === 'approved'
                              ? 'bg-emerald-500'
                              : post.status === 'rejected'
                                ? 'bg-rose-500'
                                : 'bg-amber-500'
                          }`}
                          aria-hidden
                        />
                        <span className="text-muted truncate text-[11px] font-medium">
                          {post.accountName}
                        </span>
                        <span
                          className="text-muted ml-auto shrink-0 text-[10px]"
                          title={formatAbsoluteDateTime(post.createdAt)}
                        >
                          {hasMounted
                            ? formatRelativeDate(post.createdAt)
                            : formatAbsoluteDate(post.createdAt)}
                        </span>
                      </div>

                      {/* The hook is what actually identifies a post. */}
                      <p
                        className={`line-clamp-2 text-xs leading-relaxed ${
                          isActive
                            ? 'text-foreground font-medium'
                            : 'text-foreground/80'
                        }`}
                      >
                        {post.hook}
                      </p>

                      <div className="text-muted mt-1.5 flex items-center gap-2.5 text-[10px]">
                        <span className="tabular-nums">
                          {post.charCount} chars
                        </span>
                        {post.media && (
                          <span className="flex items-center gap-0.5">
                            <ImageIcon className="h-2.5 w-2.5" />
                            Media
                          </span>
                        )}
                        {post.citations.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Quote className="h-2.5 w-2.5" />
                            {post.citations.length}
                          </span>
                        )}
                        {errors > 0 && (
                          <span className="flex items-center gap-0.5 text-rose-500">
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
          </div>
        </aside>

        <div className="bg-surface-hover/30 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl space-y-6">
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
                    className="bg-accent text-background mt-4 cursor-pointer rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
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
                      if (filterRunId) router.push('/posts')
                    }}
                    className="bg-surface-hover border-border text-foreground hover:bg-surface-hover/80 mt-4 cursor-pointer rounded-lg border px-4 py-2 text-xs font-semibold transition-colors"
                  >
                    Clear all filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              {/* REVIEW HEADER — sticky, so the decision is always one glance away.
                  It used to sit at the bottom of the right column, beneath the
                  image tools, floating over the first comment it duplicated. */}
              <div className="border-border bg-surface sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border px-5 py-3 shadow-sm">
                {/* One row: where you are in the queue, the decision, then
                    previous / next. The two wrappers below are `contents`, so
                    their children sit directly in this row. */}
                <div className="contents">
                  <div className="flex min-w-0 flex-1 items-center gap-x-3 overflow-hidden whitespace-nowrap">
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
                          ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : activePost.status === 'rejected'
                            ? 'border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            : 'border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
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
                      className="border-border text-foreground hover:bg-surface-hover flex cursor-pointer items-center rounded-lg border p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={currentIndex >= totalPosts - 1}
                      onClick={handleNextPost}
                      aria-label="Next post"
                      title="Next post (J)"
                      className="border-border text-foreground hover:bg-surface-hover flex cursor-pointer items-center rounded-lg border p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
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
                      className="flex min-w-0 flex-[2] flex-col gap-2 sm:flex-row sm:items-center"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={postRejectionReason}
                        onChange={e => setPostRejectionReason(e.target.value)}
                        placeholder="What's wrong with it? Optional — saved to improve future drafts"
                        className="border-border bg-surface text-foreground placeholder:text-muted min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none focus:border-rose-500"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowPostRejection(false)
                            setPostRejectionReason('')
                          }}
                          className="text-muted hover:text-foreground cursor-pointer px-3 py-2 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSaving}
                          className="cursor-pointer rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-50"
                        >
                          {isSaving ? 'Rejecting…' : 'Reject & next'}
                        </button>
                      </div>
                    </form>
                  ) : activePost.status === 'approved' ? (
                    <div className="flex shrink-0 items-center gap-3">
                      <p className="hidden text-xs text-emerald-600 2xl:block dark:text-emerald-400">
                        <span className="font-semibold">Approved.</span>{' '}
                        <span className="text-muted">
                          Publish it on LinkedIn in this order:
                        </span>
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCopyPost}
                          className="bg-accent text-background flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold shadow-xs transition-opacity hover:opacity-90"
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
                        {editedComment ? (
                          <button
                            type="button"
                            onClick={handleCopyComment}
                            className="border-border text-foreground hover:bg-surface-hover flex cursor-pointer items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors"
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
                          className="text-muted cursor-pointer px-2 py-2 text-[11px] hover:text-rose-600"
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
                            className="border-border text-muted flex cursor-pointer items-center rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors hover:border-rose-500/40 hover:text-rose-600 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleApprove}
                          disabled={isSaving}
                          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <CheckCircle2 className="h-4 w-4" />
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
                        className="text-accent inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium hover:underline"
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
                          onClick={() => setIsEditing(false)}
                          className="text-muted hover:text-foreground cursor-pointer px-3 py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEdits}
                          disabled={isSaving}
                          className="bg-accent text-background cursor-pointer rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full justify-center">
                      <LinkedInPreview
                        authorName={activePost.accountName}
                        authorHeadline={activePost.accountHeadline}
                        authorInitials={authorInitials}
                        hook={editedHook}
                        body={editedBody}
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
                      />
                    </div>
                  )}
                </div>

                {/* ============================================================ */}
                {/* RIGHT COLUMN: COMPACT REVIEW & CONTROL PANEL                 */}
                {/* ============================================================ */}
                <div className="space-y-4 lg:col-span-5">
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
                        className="cursor-pointer p-1 hover:text-rose-700"
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

                  {/* MEDIA RELEVANCE WARNING (if weak or unrelated) */}
                  {activePost.media?.imageUrl &&
                    !isUserPromptedMedia &&
                    !relevanceInfo.isPass && (
                      <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs">
                        <div className="flex items-start gap-2 font-medium text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <div>
                            <p className="font-semibold">
                              Media may not match this post
                            </p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300/80">
                              {relevanceInfo.warningMessage ||
                                'Generated media appears to introduce a different topic.'}
                            </p>
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
                            className="border-border bg-surface hover:bg-surface-hover cursor-pointer rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors"
                          >
                            Change media
                          </button>
                          <button
                            type="button"
                            disabled={isMediaLoading}
                            onClick={handleRemoveMedia}
                            className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
                          >
                            Use text only
                          </button>
                        </div>
                      </div>
                    )}

                  {/* 1. COMPACT MEDIA REVIEW CARD (No duplicate large image) */}
                  <div className="border-border bg-surface space-y-3 rounded-2xl border p-4 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                        <ImageIcon className="text-accent h-3.5 w-3.5" />
                        Media Attachment
                      </span>
                      {activePost.media?.imageUrl && isUserPromptedMedia ? (
                        <span className="border-accent/20 bg-accent/10 text-accent inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                          <Sparkles className="h-3 w-3" />
                          Your prompt
                        </span>
                      ) : activePost.media?.imageUrl ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              relevanceInfo.level === 'Highly relevant'
                                ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : relevanceInfo.level === 'Relevant'
                                  ? 'border border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                  : relevanceInfo.level === 'Weak match'
                                    ? 'border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                    : 'border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {relevanceInfo.isPass ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            {relevanceInfo.label}
                          </span>
                          <span className="text-muted bg-surface-hover rounded px-1.5 py-0.5 text-[10px] capitalize">
                            {activePost.media.visualType
                              ? activePost.media.visualType.replace('_', ' ')
                              : 'Editorial visual'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted bg-surface-hover rounded-full px-2 py-0.5 text-[10px] font-medium">
                          Text Only
                        </span>
                      )}
                    </div>

                    {isMediaLoading ? (
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
                    ) : (
                      <div className="border-border bg-surface-hover/20 text-muted rounded-xl border border-dashed p-3.5 text-center text-xs">
                        No visual media attached. Post will publish as
                        text-only.
                      </div>
                    )}

                    {/* Stock search input */}
                    {showStockInput && !isMediaLoading && (
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
                    {showCustomUrlInput && !isMediaLoading && (
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

                    {/* Prompt-driven generation */}
                    {!isMediaLoading && (
                      <div className="border-border bg-surface-hover/50 space-y-2 rounded-xl border p-3">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="image-prompt"
                            className="text-foreground block text-[11px] font-semibold"
                          >
                            {referenceImage
                              ? 'Describe the change you want'
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
                          rows={3}
                          placeholder={
                            referenceImage
                              ? 'e.g. Replace the headline with "Ship it", or make the background warmer'
                              : 'e.g. A minimal isometric illustration of two paths splitting, muted blues, lots of negative space'
                          }
                          aria-invalid={showPromptError}
                          aria-describedby="image-prompt-hint"
                          className="border-border bg-surface text-foreground focus:border-accent w-full resize-y rounded-lg border px-2.5 py-2 text-xs outline-none aria-invalid:border-rose-500"
                        />
                        <div
                          id="image-prompt-hint"
                          className="flex items-start justify-between gap-2 text-[11px]"
                        >
                          <span className="text-rose-600 dark:text-rose-400">
                            {showPromptError ? promptError : ''}
                          </span>
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
                              <p className="text-muted text-[10px]">
                                Will be edited — unchanged parts are preserved
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
                              Attach a reference image (or paste one above)
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

                    {/* Primary & Secondary Media Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {isGenerating ? (
                        <button
                          type="button"
                          onClick={handleStopGeneration}
                          className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400"
                        >
                          <CircleStop className="h-3.5 w-3.5" />
                          <span>Stop generating</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isMediaLoading || promptError !== null}
                          onClick={handleGenerateFromPrompt}
                          className="bg-accent hover:bg-accent-hover text-background flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isMediaLoading ? (
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
                          className="border-border hover:bg-surface-hover text-foreground flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors"
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
                            {activePost.media?.imageUrl && (
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

                  {/* 2. FIRST COMMENT CARD (Compact with preview & edit) */}
                  {editedComment && (
                    <div className="border-border bg-surface space-y-2.5 rounded-2xl border p-4 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
                          <MessageSquare className="h-3.5 w-3.5 text-[#0a66c2]" />
                          First Comment
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setShowFirstCommentDetail(!showFirstCommentDetail)
                            }
                            className="text-muted hover:text-foreground cursor-pointer text-[11px]"
                          >
                            {showFirstCommentDetail ? 'Collapse' : 'View full'}
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyComment}
                            className="text-accent inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium hover:underline"
                          >
                            {copiedComment ? (
                              <>
                                <Check className="h-3 w-3" />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      <p
                        className={`text-muted bg-surface-hover/60 rounded-xl p-3 font-mono text-xs wrap-break-word ${
                          showFirstCommentDetail ? '' : 'line-clamp-2'
                        }`}
                      >
                        {editedComment}
                      </p>
                    </div>
                  )}

                  {/* ============================================================ */}
                  {/* COLLAPSIBLE ACCORDION SECTIONS (Hooks, Checks, Citations, Debug) */}
                  {/* ============================================================ */}

                  {/* A. ALTERNATE HOOKS (Collapsed by default) */}
                  {alternateHooks.length > 0 && (
                    <div className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setShowAlternateHooks(!showAlternateHooks)
                        }
                        className="text-foreground hover:bg-surface-hover/50 flex w-full cursor-pointer items-center justify-between p-4 text-xs font-semibold transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Sparkles className="text-accent h-3.5 w-3.5" />
                          Alternate Hooks ({alternateHooks.length})
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted text-[11px] font-normal">
                            Click to swap
                          </span>
                          {showAlternateHooks ? (
                            <ChevronUp className="text-muted h-4 w-4" />
                          ) : (
                            <ChevronDown className="text-muted h-4 w-4" />
                          )}
                        </div>
                      </button>

                      {showAlternateHooks && (
                        <div className="border-border/40 space-y-2 border-t p-4 pt-0">
                          {alternateHooks.map(alt => (
                            <button
                              key={alt.id}
                              type="button"
                              onClick={() => handleSwapHook(alt.content)}
                              className={`w-full cursor-pointer rounded-xl border p-2.5 text-left text-xs transition-all ${
                                editedHook === alt.content
                                  ? 'border-accent bg-accent/10 text-foreground font-medium'
                                  : 'border-border hover:bg-surface-hover text-muted'
                              }`}
                            >
                              <span className="text-accent mr-1.5 font-mono text-[10px] font-semibold uppercase">
                                Swap:
                              </span>
                              &quot;{alt.content}&quot;
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

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
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
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

export function PostsClient({
  initialPosts,
  activeAccount
}: {
  initialPosts: PostDetail[]
  activeAccount: ActiveAccount
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
      <PostsClientInner initialPosts={initialPosts} activeAccount={activeAccount} />
    </Suspense>
  )
}
