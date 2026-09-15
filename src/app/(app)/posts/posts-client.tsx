'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, Suspense } from 'react'
import { PageHeader } from '@/components/page-header'
import { LinkedInPreview } from '@/components/linkedin-preview'
import { ImageLightbox } from '@/components/image-lightbox'
import Image from 'next/image'
import {
  AlertTriangle,
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
  Filter,
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
import type { LintFinding } from '@/lib/lint/run-linter'
import { getUserFacingRelevance } from '@/lib/media/media-brief'
import {
  IMAGE_PROMPT_MAX_WORDS,
  countWords,
  validateImagePrompt,
  validateImageUrl,
  validateReferenceDimensions,
  validateReferenceFile,
  validateStockQuery
} from '@/lib/media/image-input'
import {
  approveDraft,
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
    topicMatch?: boolean
    thesisMatch?: boolean
    introducesUnrelatedTopic?: boolean
    mediaBrief?: any
    readability?: {
      readabilityScore?: number
      mobileReadable?: boolean
      visualComplexity?: string
      textDensity?: string
      reasons?: string[]
    } | null
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
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function PostsClientInner({
  initialPosts,
  accounts
}: {
  initialPosts: PostDetail[]
  accounts: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const filterRunId = searchParams.get('runId')

  const [posts, setPosts] = useState<PostDetail[]>(initialPosts)
  const [selectedPostId, setSelectedPostId] = useState<string>(
    initialPosts.find((p) => !filterRunId || p.runId === filterRunId)?.id || initialPosts[0]?.id || ''
  )
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')

  // Active post editing state
  const activePost = posts.find((p) => p.id === selectedPostId) || posts[0]
  const [isEditing, setIsEditing] = useState(false)
  const [editedHook, setEditedHook] = useState(activePost?.hook || '')
  const [editedBody, setEditedBody] = useState(activePost?.body || '')
  const [editedComment, setEditedComment] = useState(activePost?.firstComment || '')

  // Copy feedback
  const [copiedPost, setCopiedPost] = useState(false)
  const [copiedComment, setCopiedComment] = useState(false)
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
  const [referenceImageName, setReferenceImageName] = useState<string | null>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [mediaNotice, setMediaNotice] = useState<string | null>(null)
  const generationAbortRef = useRef<AbortController | null>(null)

  // Leaving the page must not leave a generation running that would still save.
  useEffect(() => () => generationAbortRef.current?.abort(), [])

  // Collapsible drawers (all collapsed by default as requested)
  const [showAlternateHooks, setShowAlternateHooks] = useState(false)
  const [showQualityChecks, setShowQualityChecks] = useState(false)
  const [showCitations, setShowCitations] = useState(false)
  const [showAdvancedMedia, setShowAdvancedMedia] = useState(false)
  const [showFirstCommentDetail, setShowFirstCommentDetail] = useState(false)

  // Filter posts
  const filteredPosts = posts.filter((p) => {
    if (filterRunId && p.runId !== filterRunId) return false
    if (selectedAccountId === 'all') return true
    return p.accountId === selectedAccountId
  })

  const currentIndex = filteredPosts.findIndex((p) => p.id === activePost?.id)
  const totalPosts = filteredPosts.length

  const handleSelectPost = (post: PostDetail) => {
    setSelectedPostId(post.id)
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

  const clearReferenceImage = () => {
    setReferenceImage(null)
    setReferenceImageName(null)
    if (referenceInputRef.current) referenceInputRef.current.value = ''
  }

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

  const handleReferencePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const image = Array.from(e.clipboardData.files).find((f) =>
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
        setPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, media: res.media } : p))
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
      if (generationAbortRef.current === controller) generationAbortRef.current = null
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
        ? imageUrl.slice(imageUrl.indexOf('/') + 1, imageUrl.indexOf(';')) || 'png'
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
        setPosts((prev) =>
          prev.map((p) =>
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
        setPosts((prev) =>
          prev.map((p) =>
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
        setPosts((prev) =>
          prev.map((p) => (p.id === activePost.id ? { ...p, media: null } : p))
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
      setPosts((prev) =>
        prev.map((p) => (p.id === activePost.id ? { ...p, hook: newHook } : p))
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
      setPosts((prev) =>
        prev.map((p) =>
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

  const handleCopyPost = () => {
    if (!activePost) return
    const tagsString = (activePost.hashtags || [])
      .map((t) => (t.startsWith('#') ? t : `#${t}`))
      .join(' ')
    const fullContent = `${editedHook}\n\n${editedBody}${
      activePost.cta ? `\n\n${activePost.cta}` : ''
    }${tagsString ? `\n\n${tagsString}` : ''}`

    navigator.clipboard.writeText(fullContent)
    setCopiedPost(true)
    setTimeout(() => setCopiedPost(false), 2500)
  }

  const handleCopyComment = () => {
    if (!editedComment) return
    navigator.clipboard.writeText(editedComment)
    setCopiedComment(true)
    setTimeout(() => setCopiedComment(false), 2500)
  }

  const handleApprove = async () => {
    if (!activePost) return
    setIsSaving(true)
    try {
      await approveDraft(activePost.id)
      setPosts((prev) =>
        prev.map((p) => (p.id === activePost.id ? { ...p, status: 'approved' } : p))
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleReject = async (reason?: string) => {
    if (!activePost) return
    setIsSaving(true)
    try {
      await rejectDraft(activePost.id, reason || undefined)
      setPosts((prev) =>
        prev.map((p) => (p.id === activePost.id ? { ...p, status: 'rejected' } : p))
      )
      setShowPostRejection(false)
      setPostRejectionReason('')
    } finally {
      setIsSaving(false)
    }
  }

  const authorInitials = activePost?.accountName
    ? activePost.accountName
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'IN'

  const alternateHooks = activePost?.variants?.filter((v) => v.variantType === 'hook') || []
  const citations = activePost?.citations || []
  const lintFindings = activePost?.lintFindings || []
  const passedLintCount = lintFindings.filter((f) => f.passed).length
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
          topicMatch: activePost.media.topicMatch,
          thesisMatch: activePost.media.thesisMatch,
          introducesUnrelatedTopic: activePost.media.introducesUnrelatedTopic
        }
      : null
  )

  const mediaHeadline =
    activePost?.media?.mediaBrief?.textOverlay?.headline ||
    activePost?.media?.mediaBrief?.primaryConcept ||
    activePost?.media?.altText ||
    'Editorial visual asset'

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Review & Ship Posts"
        badge="Daily Surface"
        description="Final polish before publishing. Review formatting, media, and platform-specific nuances."
        bottomContent={
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-muted" />
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-accent"
            >
              <option value="all">All Identities</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto space-y-6">
          {filteredPosts.length === 0 || !activePost ? (
            <div className="p-16 text-center rounded-2xl border-2 border-dashed border-border bg-surface">
              <FileCheck className="w-10 h-10 text-muted mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-foreground">
                No drafted posts waiting for review
              </h3>
              <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                Approve concepts from the Idea Gate to draft grounded posts.
              </p>
              {filterRunId && (
                <button
                  type="button"
                  onClick={() => router.push('/posts')}
                  className="mt-4 px-4 py-2 rounded-lg bg-surface-hover border border-border text-xs font-semibold text-foreground hover:bg-surface-hover/80 transition-colors"
                >
                  Clear Run Filter
                </button>
              )}
            </div>
          ) : (
            <>
              {/* TOP NAVIGATION BAR: Post X of Y, Identity, Status, Prev/Next */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-5 py-3.5 shadow-xs">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-foreground">
                    Post {currentIndex + 1} of {totalPosts}
                  </span>
                  <span className="text-muted text-xs">•</span>
                  <span className="text-xs text-muted font-medium">
                    {activePost.accountName}
                  </span>
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                      activePost.status === 'approved'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                        : activePost.status === 'rejected'
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    {activePost.status === 'approved'
                      ? '✓ Approved'
                      : activePost.status === 'rejected'
                      ? 'Rejected'
                      : 'Awaiting Review'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentIndex <= 0}
                    onClick={handlePrevPost}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-surface text-xs font-medium text-foreground hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>
                  <button
                    type="button"
                    disabled={currentIndex >= totalPosts - 1}
                    onClick={handleNextPost}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border bg-surface text-xs font-medium text-foreground hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* QUICK POST TABS STRIP (if multiple posts) */}
              {totalPosts > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {filteredPosts.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPost(p)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium shrink-0 transition-colors cursor-pointer border ${
                        p.id === activePost?.id
                          ? 'bg-accent text-background border-accent shadow-xs'
                          : 'bg-surface border-border text-muted hover:text-foreground'
                      }`}
                    >
                      <span>Post #{idx + 1}</span>
                      <span className="text-[10px] opacity-80">
                        {p.status === 'approved' ? '✓' : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* TWO-COLUMN REVIEW WORKSPACE (Left: LinkedIn Preview; Right: Compact Review Panel) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* ============================================================ */}
                {/* LEFT COLUMN: PRIMARY VISUAL AREA (LinkedIn Feed Preview)     */}
                {/* ============================================================ */}
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                      LinkedIn Feed Appearance
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsEditing(!isEditing)}
                      className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline font-medium cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{isEditing ? 'View Feed Preview' : 'Edit Post Text'}</span>
                    </button>
                  </div>

                  {/* IN-PLACE TEXT EDITOR OR REALISTIC FEED PREVIEW */}
                  {isEditing ? (
                    <div className="rounded-2xl border border-border bg-surface p-6 space-y-4 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          Edit Draft Copy
                        </span>
                        <span className="text-xs font-mono text-muted">
                          Hook: {editedHook.length} chars (fold ~200)
                        </span>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">
                          Opening Hook
                        </label>
                        <textarea
                          value={editedHook}
                          onChange={(e) => setEditedHook(e.target.value)}
                          rows={3}
                          className="w-full rounded-xl border border-border bg-surface-hover p-3 text-xs text-foreground focus:border-accent outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">
                          Body
                        </label>
                        <textarea
                          value={editedBody}
                          onChange={(e) => setEditedBody(e.target.value)}
                          rows={8}
                          className="w-full rounded-xl border border-border bg-surface-hover p-3 text-xs text-foreground focus:border-accent outline-none font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">
                          First Comment
                        </label>
                        <textarea
                          value={editedComment}
                          onChange={(e) => setEditedComment(e.target.value)}
                          rows={2}
                          className="w-full rounded-xl border border-border bg-surface-hover p-3 text-xs text-foreground focus:border-accent outline-none"
                        />
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setIsEditing(false)}
                          className="px-3 py-1.5 text-xs text-muted hover:text-foreground cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveEdits}
                          disabled={isSaving}
                          className="px-4 py-2 rounded-lg bg-accent text-background text-xs font-semibold cursor-pointer disabled:opacity-50"
                        >
                          Save Changes
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center w-full">
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
                          activePost.media?.imageUrl ? () => setIsImageZoomOpen(true) : undefined
                        }
                      />
                    </div>
                  )}
                </div>

                {/* ============================================================ */}
                {/* RIGHT COLUMN: COMPACT REVIEW & CONTROL PANEL                 */}
                {/* ============================================================ */}
                <div className="lg:col-span-5 space-y-4">
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
                        className="p-1 hover:text-rose-700 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* NEUTRAL NOTICE (e.g. generation stopped) */}
                  {mediaNotice && (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-hover p-3 text-xs text-muted">
                      <span className="flex items-center gap-1.5">
                        <Info className="h-3.5 w-3.5 shrink-0" />
                        {mediaNotice}
                      </span>
                      <button
                        type="button"
                        onClick={() => setMediaNotice(null)}
                        className="p-1 hover:text-foreground cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  {/* MEDIA RELEVANCE WARNING (if weak or unrelated) */}
                  {activePost.media?.imageUrl &&
                    !isUserPromptedMedia &&
                    !relevanceInfo.isPass && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs space-y-2.5">
                      <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400 font-medium">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                        <div>
                          <p className="font-semibold">Media may not match this post</p>
                          <p className="text-[11px] text-amber-800 dark:text-amber-300/80 mt-0.5 leading-relaxed">
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
                          className="px-2.5 py-1 rounded-lg border border-border bg-surface text-[11px] font-medium hover:bg-surface-hover transition-colors cursor-pointer"
                        >
                          Change media
                        </button>
                        <button
                          type="button"
                          disabled={isMediaLoading}
                          onClick={handleRemoveMedia}
                          className="px-2.5 py-1 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-[11px] font-medium transition-colors cursor-pointer"
                        >
                          Use text only
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 1. COMPACT MEDIA REVIEW CARD (No duplicate large image) */}
                  <div className="rounded-2xl border border-border bg-surface p-4 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <ImageIcon className="w-3.5 h-3.5 text-accent" />
                        Media Attachment
                      </span>
                      {activePost.media?.imageUrl && isUserPromptedMedia ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                          <Sparkles className="h-3 w-3" />
                          Your prompt
                        </span>
                      ) : activePost.media?.imageUrl ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              relevanceInfo.level === 'Highly relevant'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                : relevanceInfo.level === 'Relevant'
                                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'
                                : relevanceInfo.level === 'Weak match'
                                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                            }`}
                          >
                            {relevanceInfo.isPass ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <AlertTriangle className="w-3 h-3" />
                            )}
                            {relevanceInfo.label}
                          </span>
                          <span className="text-[10px] text-muted bg-surface-hover px-1.5 py-0.5 rounded capitalize">
                            {activePost.media.visualType
                              ? activePost.media.visualType.replace('_', ' ')
                              : 'Editorial visual'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted bg-surface-hover px-2 py-0.5 rounded-full font-medium">
                          Text Only
                        </span>
                      )}
                    </div>

                    {isMediaLoading ? (
                      <div className="flex flex-col items-center justify-center space-y-2 rounded-xl border border-border bg-surface-hover/50 py-6 text-xs text-muted animate-pulse">
                        <Loader2 className="h-5 w-5 animate-spin text-accent" />
                        <p className="font-medium text-foreground">
                          {mediaLoadingText || 'Processing media asset...'}
                        </p>
                      </div>
                    ) : activePost.media?.imageUrl ? (
                      <div className="space-y-2">
                        <div className="flex items-start gap-3 p-2.5 rounded-xl bg-surface-hover/40 border border-border/60">
                          {/* Compact 64x64 thumbnail */}
                          <button
                            type="button"
                            onClick={() => setIsImageZoomOpen(true)}
                            title="Zoom image"
                            className="relative w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-border bg-neutral-900 cursor-zoom-in"
                          >
                            <Image
                              src={activePost.media.imageUrl}
                              alt={activePost.media.altText || 'Media thumbnail'}
                              width={64}
                              height={64}
                              className="w-full h-full object-cover"
                              unoptimized
                            />
                          </button>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs font-medium text-foreground line-clamp-2 leading-snug">
                              &quot;{mediaHeadline}&quot;
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                              <span>Media v{activePost.media.version || 1}</span>
                              <span>•</span>
                              {activePost.media.width && activePost.media.height ? (
                                <span className="font-medium text-foreground">
                                  {activePost.media.width} × {activePost.media.height} HD
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
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                Download image
                              </button>
                              <button
                                type="button"
                                disabled={isMediaLoading}
                                onClick={handleRemoveMedia}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>

                        <button
                            type="button"
                            onClick={() => setIsImageZoomOpen(true)}
                            aria-label="Zoom image"
                            className="group relative block w-full rounded-xl overflow-hidden border border-border bg-neutral-900 cursor-zoom-in"
                          >
                            <Image
                              src={activePost.media.imageUrl}
                              alt={activePost.media.altText || 'Generated visual'}
                              width={2048}
                              height={1072}
                              className="w-full h-auto object-contain"
                              unoptimized
                            />
                            <span className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                              <ZoomIn className="h-3 w-3" />
                              Zoom
                            </span>
                          </button>
                      </div>
                    ) : (
                      <div className="p-3.5 text-center rounded-xl border border-dashed border-border bg-surface-hover/20 text-xs text-muted">
                        No visual media attached. Post will publish as text-only.
                      </div>
                    )}

                    {/* Stock search input */}
                    {showStockInput && !isMediaLoading && (
                      <div className="space-y-2 rounded-xl border border-border bg-surface-hover p-3">
                        <label className="block text-[11px] font-semibold text-foreground">
                          Search Stock Imagery
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={stockSearchQuery}
                            onChange={(e) => setStockSearchQuery(e.target.value)}
                            placeholder={`e.g. ${activePost.hook.slice(0, 35)}...`}
                            className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
                            aria-invalid={stockSearchQuery.trim().length > 0 && stockQueryError !== null}
                            onKeyDown={(e) =>
                              e.key === 'Enter' && !stockQueryError && handleSearchStockMedia()
                            }
                          />
                          <button
                            type="button"
                            disabled={isMediaLoading || stockQueryError !== null}
                            onClick={handleSearchStockMedia}
                            className="cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Search
                          </button>
                        </div>
                        {stockSearchQuery.trim().length > 0 && stockQueryError && (
                          <p className="text-[11px] text-rose-600 dark:text-rose-400">
                            {stockQueryError}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Custom URL input */}
                    {showCustomUrlInput && !isMediaLoading && (
                      <div className="space-y-2 rounded-xl border border-border bg-surface-hover p-3">
                        <label className="block text-[11px] font-semibold text-foreground">
                          Direct Image URL
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="url"
                            value={customImageUrl}
                            onChange={(e) => setCustomImageUrl(e.target.value)}
                            placeholder="https://images.unsplash.com/..."
                            className="flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent"
                            aria-invalid={customImageUrl.trim().length > 0 && customUrlError !== null}
                            onKeyDown={(e) =>
                              e.key === 'Enter' && !customUrlError && handleApplyCustomUrl()
                            }
                          />
                          <button
                            type="button"
                            disabled={isMediaLoading || customUrlError !== null}
                            onClick={handleApplyCustomUrl}
                            className="cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-background hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
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
                      <div className="space-y-2 rounded-xl border border-border bg-surface-hover/50 p-3">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="image-prompt"
                            className="block text-[11px] font-semibold text-foreground"
                          >
                            {referenceImage
                              ? 'Describe the change you want'
                              : 'Describe the image you want'}
                          </label>
                          {(imagePrompt || referenceImage) && (
                            <button
                              type="button"
                              onClick={clearPromptAndReference}
                              className="text-[11px] font-medium text-muted hover:text-foreground cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <textarea
                          id="image-prompt"
                          value={imagePrompt}
                          onChange={(e) => setImagePrompt(e.target.value)}
                          onPaste={handleReferencePaste}
                          rows={3}
                          placeholder={
                            referenceImage
                              ? 'e.g. Replace the headline with "Ship it", or make the background warmer'
                              : 'e.g. A minimal isometric illustration of two paths splitting, muted blues, lots of negative space'
                          }
                          aria-invalid={showPromptError}
                          aria-describedby="image-prompt-hint"
                          className="w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-2 text-xs text-foreground outline-none focus:border-accent aria-[invalid=true]:border-rose-500"
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
                            {countWords(imagePrompt)}/{IMAGE_PROMPT_MAX_WORDS} words
                          </span>
                        </div>

                        {referenceImage ? (
                          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface p-2">
                            <Image
                              src={referenceImage}
                              alt="Reference"
                              width={40}
                              height={40}
                              className="h-10 w-10 shrink-0 rounded object-cover border border-border"
                              unoptimized
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-medium text-foreground">
                                {referenceImageName}
                              </p>
                              <p className="text-[10px] text-muted">
                                Will be edited — unchanged parts are preserved
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={clearReferenceImage}
                              title="Remove reference image"
                              className="p-1 text-muted hover:text-foreground cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <button
                              type="button"
                              onClick={() => referenceInputRef.current?.click()}
                              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-foreground cursor-pointer"
                            >
                              <Paperclip className="h-3 w-3" />
                              Attach a reference image (or paste one above)
                            </button>
                            {activePost.media?.imageUrl && (
                              <button
                                type="button"
                                onClick={useCurrentImageAsReference}
                                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-accent hover:underline cursor-pointer"
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
                          onChange={(e) => {
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
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <CircleStop className="w-3.5 h-3.5" />
                          <span>Stop generating</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={isMediaLoading || promptError !== null}
                          onClick={handleGenerateFromPrompt}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-accent hover:bg-accent-hover text-background text-xs font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isMediaLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {activePost.media?.imageUrl ? 'Regenerate image' : 'Generate image'}
                          </span>
                        </button>
                      )}

                      <div className="relative">
                        <button
                          type="button"
                          disabled={isMediaLoading}
                          onClick={() => setMediaMenuOpen(!mediaMenuOpen)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border hover:bg-surface-hover text-foreground text-xs font-medium transition-colors cursor-pointer"
                        >
                          <span>Change media</span>
                          <ChevronDown className="w-3.5 h-3.5 text-muted" />
                        </button>

                        {mediaMenuOpen && (
                          <div className="absolute right-0 mt-1 w-52 rounded-xl border border-border bg-surface shadow-xl z-20 py-1.5 text-xs animate-in fade-in zoom-in-95 duration-100">
                            <button
                              type="button"
                              onClick={() => {
                                setMediaMenuOpen(false)
                                setShowStockInput(true)
                                setShowCustomUrlInput(false)
                              }}
                              className="w-full text-left px-3.5 py-2 hover:bg-surface-hover text-foreground flex items-center gap-2 cursor-pointer"
                            >
                              <Search className="w-3.5 h-3.5 text-blue-500" />
                              <span>Find stock image</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMediaMenuOpen(false)
                                setShowCustomUrlInput(true)
                                setShowStockInput(false)
                              }}
                              className="w-full text-left px-3.5 py-2 hover:bg-surface-hover text-foreground flex items-center gap-2 cursor-pointer"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-emerald-500" />
                              <span>Use custom image URL</span>
                            </button>
                            {activePost.media?.imageUrl && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMediaMenuOpen(false)
                                  handleRemoveMedia()
                                }}
                                className="w-full text-left px-3.5 py-2 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center gap-2 border-t border-border mt-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
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
                    <div className="rounded-2xl border border-border bg-surface p-4 space-y-2.5 shadow-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 text-[#0a66c2]" />
                          First Comment
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setShowFirstCommentDetail(!showFirstCommentDetail)
                            }
                            className="text-[11px] text-muted hover:text-foreground cursor-pointer"
                          >
                            {showFirstCommentDetail ? 'Collapse' : 'View full'}
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyComment}
                            className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline font-medium cursor-pointer"
                          >
                            {copiedComment ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      <p
                        className={`text-xs text-muted bg-surface-hover/60 p-3 rounded-xl break-words font-mono ${
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
                    <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
                      <button
                        type="button"
                        onClick={() => setShowAlternateHooks(!showAlternateHooks)}
                        className="w-full flex items-center justify-between p-4 text-xs font-semibold text-foreground hover:bg-surface-hover/50 transition-colors cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 text-accent" />
                          Alternate Hooks ({alternateHooks.length})
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-normal text-muted">
                            Click to swap
                          </span>
                          {showAlternateHooks ? (
                            <ChevronUp className="w-4 h-4 text-muted" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted" />
                          )}
                        </div>
                      </button>

                      {showAlternateHooks && (
                        <div className="p-4 pt-0 space-y-2 border-t border-border/40">
                          {alternateHooks.map((alt) => (
                            <button
                              key={alt.id}
                              type="button"
                              onClick={() => handleSwapHook(alt.content)}
                              className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all cursor-pointer ${
                                editedHook === alt.content
                                  ? 'border-accent bg-accent/10 font-medium text-foreground'
                                  : 'border-border hover:bg-surface-hover text-muted'
                              }`}
                            >
                              <span className="font-mono text-[10px] text-accent mr-1.5 uppercase font-semibold">
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
                  <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
                    <button
                      type="button"
                      onClick={() => setShowQualityChecks(!showQualityChecks)}
                      className="w-full flex items-center justify-between p-4 text-xs font-semibold text-foreground hover:bg-surface-hover/50 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <FileCheck className="w-3.5 h-3.5 text-accent" />
                        Quality Checks
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            hasLintIssues
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {hasLintIssues ? (
                            <>
                              <AlertTriangle className="w-3 h-3" />
                              <span>
                                {totalLintCount - passedLintCount} to review
                              </span>
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{passedLintCount} checks passed</span>
                            </>
                          )}
                        </span>
                        {showQualityChecks ? (
                          <ChevronUp className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        )}
                      </div>
                    </button>

                    {showQualityChecks && (
                      <div className="p-4 pt-0 divide-y divide-border/60 border-t border-border/40 text-xs">
                        {lintFindings.length === 0 ? (
                          <p className="py-2 text-xs text-muted">
                            All standard LinkedIn checks verified.
                          </p>
                        ) : (
                          lintFindings.map((finding, idx) => (
                            <div key={idx} className="py-2.5 flex items-start gap-2.5">
                              {finding.passed ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                              ) : finding.severity === 'error' ? (
                                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                              ) : (
                                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0 flex-1">
                                <span className="font-medium text-foreground text-xs block">
                                  {getHumanRuleLabel(finding.rule)}
                                </span>
                                <p className="text-[11px] text-muted mt-0.5">
                                  {finding.message}
                                </p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* C. EVIDENCE & CITATIONS (Collapsed by default) */}
                  <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
                    <button
                      type="button"
                      onClick={() => setShowCitations(!showCitations)}
                      className="w-full flex items-center justify-between p-4 text-xs font-semibold text-foreground hover:bg-surface-hover/50 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Quote className="w-3.5 h-3.5 text-emerald-500" />
                        Sources & Evidence ({citations.length})
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted">
                          {citations.length > 0
                            ? `${citations.length} verified`
                            : 'No citations'}
                        </span>
                        {showCitations ? (
                          <ChevronUp className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        )}
                      </div>
                    </button>

                    {showCitations && (
                      <div className="p-4 pt-0 space-y-2 border-t border-border/40">
                        {citations.length === 0 ? (
                          <p className="text-xs text-muted py-2">
                            ⚠ No specific factual citations linked to this draft.
                          </p>
                        ) : (
                          citations.map((c) => (
                            <div
                              key={c.id}
                              className="p-3 rounded-xl border border-border bg-surface-hover/40 text-xs space-y-1"
                            >
                              <p className="font-medium text-foreground">{c.claim}</p>
                              {c.quote && (
                                <p className="text-[11px] text-muted italic">
                                  &quot;{c.quote}&quot;
                                </p>
                              )}
                              {c.sourceUrl && (
                                <a
                                  href={c.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline pt-1"
                                >
                                  <span>{c.sourceTitle || 'View Source'}</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  {/* D. ADVANCED GENERATION DETAILS (Debug info, collapsed by default) */}
                  <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedMedia(!showAdvancedMedia)}
                      className="w-full flex items-center justify-between p-4 text-xs font-semibold text-foreground hover:bg-surface-hover/50 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <Info className="w-3.5 h-3.5 text-muted" />
                        Advanced Generation Details
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted">Debug telemetry</span>
                        {showAdvancedMedia ? (
                          <ChevronUp className="w-4 h-4 text-muted" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted" />
                        )}
                      </div>
                    </button>

                    {showAdvancedMedia && (
                      <div className="p-4 pt-0 space-y-3 border-t border-border/40 text-xs">
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="p-2 rounded-lg bg-surface-hover">
                            <span className="text-muted block">Relevance Score</span>
                            <span className="font-semibold text-foreground">
                              {isUserPromptedMedia
                                ? 'Not scored (your prompt)'
                                : `${activePost.media?.relevanceScore ?? 'N/A'}/100 (${relevanceInfo.level})`}
                            </span>
                          </div>
                          <div className="p-2 rounded-lg bg-surface-hover">
                            <span className="text-muted block">Media Version</span>
                            <span className="font-semibold text-foreground">
                              v{activePost.media?.version || 1} (Attempt{' '}
                              {activePost.media?.regenerationAttempt || 0})
                            </span>
                          </div>
                          <div className="p-2 rounded-lg bg-surface-hover">
                            <span className="text-muted block">Visual Type</span>
                            <span className="font-semibold text-foreground capitalize">
                              {activePost.media?.visualType || 'N/A'}
                            </span>
                          </div>
                          <div className="p-2 rounded-lg bg-surface-hover">
                            <span className="text-muted block">Mobile Readable</span>
                            <span className="font-semibold text-foreground">
                              {activePost.media?.readability?.mobileReadable !== false
                                ? '✓ Yes'
                                : '⚠ Unreadable on feed'}
                            </span>
                          </div>
                        </div>

                        {activePost.media?.promptOrQuery && (
                          <div>
                            <span className="text-[11px] font-medium text-muted block mb-1">
                              Raw Image Prompt
                            </span>
                            <p className="rounded-lg bg-surface-hover p-2.5 font-mono text-[10px] leading-relaxed text-muted break-words">
                              {activePost.media.promptOrQuery}
                            </p>
                          </div>
                        )}

                        {activePost.media?.providerRequestId && (
                          <div className="flex items-center justify-between text-[10px] text-muted font-mono pt-1">
                            <span>Req: {activePost.media.providerRequestId.slice(0, 8)}...</span>
                            <span>Seed: {activePost.media.seed ?? 'auto'}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 3. STICKY REVIEW ACTIONS (Approve primary, Reject secondary, Copy buttons) */}
                  <div className="rounded-2xl border border-border bg-surface p-4 space-y-3 shadow-sm sticky bottom-4">
                    {showPostRejection ? (
                      <div className="space-y-3 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10">
                        <label className="block text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                          Rejection Reason (Shapes future generations)
                        </label>
                        <input
                          type="text"
                          value={postRejectionReason}
                          onChange={(e) => setPostRejectionReason(e.target.value)}
                          placeholder="e.g. Too generic, tone is off..."
                          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground outline-none focus:border-rose-500"
                        />
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => setShowPostRejection(false)}
                            className="px-3 py-1.5 text-xs text-muted hover:text-foreground cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReject(postRejectionReason)}
                            disabled={isSaving}
                            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Confirm Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setShowPostRejection(true)}
                          disabled={isSaving}
                          className="flex-1 px-4 py-2.5 rounded-xl border border-border text-foreground hover:text-rose-600 hover:border-rose-500/40 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Reject Post
                        </button>

                        <button
                          type="button"
                          onClick={handleApprove}
                          disabled={isSaving || activePost.status === 'approved'}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                            activePost.status === 'approved'
                              ? 'bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                              : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                          }`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>
                            {activePost.status === 'approved'
                              ? 'Post Approved'
                              : 'Approve Post'}
                          </span>
                        </button>
                      </div>
                    )}

                    {/* Copy Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                      <button
                        type="button"
                        onClick={handleCopyPost}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-accent/10 hover:bg-accent/20 text-accent text-xs font-semibold transition-colors cursor-pointer"
                      >
                        {copiedPost ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedPost ? 'Copied Post!' : 'Copy Post'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyComment}
                        disabled={!editedComment}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-border hover:bg-surface-hover text-foreground text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {copiedComment ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedComment ? 'Copied Comment!' : 'Copy Comment'}</span>
                      </button>
                    </div>

                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function PostsClient({
  initialPosts,
  accounts
}: {
  initialPosts: PostDetail[]
  accounts: Array<{ id: string; name: string }>
}) {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-accent" />
          <p className="text-sm font-medium text-muted">Loading posts...</p>
        </div>
      </div>
    }>
      <PostsClientInner initialPosts={initialPosts} accounts={accounts} />
    </Suspense>
  )
}
