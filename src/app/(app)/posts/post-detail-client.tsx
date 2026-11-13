'use client'

import { CarouselViewer } from '@/components/carousel/carousel-viewer'
import { SlidesPanel } from '@/components/carousel/slides-panel'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PostTypePicker } from '@/components/post-type-picker'
import { PublishChecks } from '@/components/publish-checks'
import type { SlideView } from '@/lib/carousel/types'
import { PageHeader } from '@/components/page-header'
import { PlatformMark } from '@/components/platform-mark'
import { PostPreview } from '@/components/post-preview'
import { usePlatformPublishing } from '@/components/publishing-header-button'
import { showToast } from '@/components/toast-notification'
import { VariantPreview, previewTitle } from '@/components/variant-preview'
import {
  BACKGROUND_PATTERNS,
  BRAND_THEME_PATH,
  FOOTER_MAX_LENGTH,
  IMAGE_STYLES,
  imageStyleLabel,
  isPictureStyle,
  type BackgroundPattern,
  type ImageStyle
} from '@/lib/brand/theme'
import {
  formatAbsoluteDate,
  formatAbsoluteDateTime,
  formatRelativeDate
} from '@/lib/format-date'
import {
  FORMATS,
  PLATFORMS,
  captionMeter,
  carouselWording,
  copyText,
  formatOf,
  resolveMediaFormat,
  suggestsCarousel,
  supportsMediaFormat,
  validatePost,
  type FormatId,
  type MediaFormat
} from '@/lib/formats'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { initialsOf } from '@/lib/initials'
import { SHAPE_SIZES } from '@/lib/media/canvas/spec'
import {
  DIAGRAM_TYPE_CHOICES,
  IMAGE_PROMPT_MAX_WORDS,
  countWords,
  validateImagePrompt,
  validateImageUrl,
  validateReferenceDimensions,
  validateReferenceFile,
  validateStockQuery,
  type DiagramTypeChoice
} from '@/lib/media/image-input'
import { IMAGE_STYLE_ICONS } from '@/components/image-style-icons'
import {
  isReviewerChosenSource,
  reviewerSourceLabel
} from '@/lib/media/media-source'
import { getUserFacingRelevance } from '@/lib/media/relevance-label'
import { getPlatform } from '@/lib/platforms'
import { platformPostText, toPlatformText } from '@/lib/post-text'
import { canPublishFormat } from '@/lib/publishing/platform'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Columns2,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Info,
  Layers,
  LayoutGrid,
  Loader2,
  MessageSquare,
  Network,
  Palette,
  Paperclip,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
  X,
  ZoomIn
} from 'lucide-react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction
} from 'react'
import {
  approveDraft,
  deleteDraft,
  regeneratePostMediaAction,
  rejectDraft,
  removePostMediaAction,
  saveImageSettings,
  setDraftHidden,
  setPostMediaFormat,
  updateDraft,
  updatePostMediaAction
} from './actions'
import { IdeaVersions } from './add-version-menu'
import {
  currentMediaJob,
  startMediaJob,
  trackPostsPage,
  type MediaJobOutcome
} from './media-jobs'
import { PostStatusPill } from './post-status'
import { RegenerateControl, VersionHistory } from './post-versions'
import type { BrandSummary, PostDetail } from './posts-client'
import { getPostPublication } from './publish-actions'
import { PublishControls } from './publish-controls'
// Every change below is called out with markDataChanged(): the actions no
// longer revalidate the page (see RefreshOnBack).
import { markDataChanged } from '@/components/refresh-on-back'

// Only shown when an image is zoomed, so it loads then.
const ImageLightbox = dynamic(
  () => import('@/components/image-lightbox').then(m => m.ImageLightbox),
  { ssr: false }
)

// The diagram picker, for minimal graphic design: Auto (null) lets the art
// director choose per post.
const DIAGRAM_TYPE_OPTIONS = [
  {
    value: null,
    label: 'Auto',
    description: 'Picks the diagram that fits the post best.',
    icon: Sparkles
  },
  ...DIAGRAM_TYPE_CHOICES.map(choice => ({
    ...choice,
    icon: {
      hub_spoke: Network,
      flow: Workflow,
      stack: Layers,
      cards: LayoutGrid,
      comparison: Columns2
    }[choice.value]
  }))
]

/**
 * One post on its own page (/posts/[id]): its preview, text editing, image,
 * and the review and publishing steps, in that order of reading. The list of
 * every post is /posts; `backHref` returns to it with its filters as left.
 */
export function PostDetailClient({
  initialPost,
  initialVersions,
  backHref,
  listQuery,
  brand,
  enabledFormats = ['linkedin.post']
}: {
  initialPost: PostDetail
  /** Every version of the post's idea (this one included), for Versions. */
  initialVersions: PostDetail[]
  /** The posts list, with the filters it was opened from. */
  backHref: string
  /** Those filters as a query string, carried to another version's page. */
  listQuery: string
  brand: BrandSummary
  /** The formats the identity has turned on, for "Add a version". */
  enabledFormats?: FormatId[]
}) {
  const router = useRouter()
  const hasMounted = useHasMounted()

  // The open post and its idea's other versions. Every change below is made
  // to this copy, so the page shows it at once.
  const [posts, setPosts] = useState<PostDetail[]>(() =>
    initialVersions.some(p => p.id === initialPost.id)
      ? initialVersions
      : [initialPost, ...initialVersions]
  )
  const activePost: PostDetail =
    posts.find(p => p.id === initialPost.id) ?? initialPost
  const postHref = (id: string) =>
    `/posts/${id}${listQuery ? `?${listQuery}` : ''}`
  // Where the open post goes out: its preview, copy and wording follow it.
  const activePlatform = getPlatform(activePost?.platform)
  // Published on its platform (or going out now): it can no longer be rejected,
  // matching rejectDraft on the server.
  const activePublished =
    activePost?.publication?.status === 'published' ||
    activePost?.publication?.status === 'publishing'
  const [isEditing, setIsEditing] = useState(false)
  // The edit buffer lives in PostTextEditor, so a keystroke there re-renders
  // the editor alone. The page only hears whether it holds unsaved edits, and
  // reaches in through the ref for the hook swap and the copy notice.
  const editorRef = useRef<PostTextEditorHandle>(null)
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false)

  // Copy feedback
  const [copiedPost, setCopiedPost] = useState(false)
  const [copiedComment, setCopiedComment] = useState(false)
  const [copiedImage, setCopiedImage] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Media management state. A generation started before this page opened
  // (the reviewer left the page and came back) is still running: the page
  // starts from it, read once so its state and its outcome agree.
  const [resumedJob] = useState(currentMediaJob)
  const [isMediaLoading, setIsMediaLoading] = useState(
    () => resumedJob !== null
  )
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
  // The Delete dialog, and its "also delete it from the platform" choice.
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [alsoDeleteFromPlatform, setAlsoDeleteFromPlatform] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
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
  // The style of the next image: the one this post's image was made in, so a
  // regeneration keeps its look, else the Brand Theme's.
  const [imageStyle, setImageStyle] = useState<ImageStyle>(
    () => initialPost.media?.imageStyle ?? brand.style
  )
  // For minimal graphic design only; null is Auto.
  const [diagramType, setDiagramType] = useState<DiagramTypeChoice | null>(null)
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

  // The page is keyed by post (see ./[id]/page.tsx), so the open post never
  // changes here; another post is another page.
  const activePostId = activePost.id

  // A carousel's slides, loaded when the post has any; edited in the Slides
  // panel and shown, swipeable, in the preview.
  const [slides, setSlides] = useState<SlideView[] | null>(null)
  const [slidesLoading, setSlidesLoading] = useState(
    () => (initialPost.slideCount ?? 0) > 0
  )
  const [slideIndex, setSlideIndex] = useState(0)
  const [zoomSlide, setZoomSlide] = useState<number | null>(null)
  // The post type being switched to, while it saves.
  const [pendingMediaFormat, setPendingMediaFormat] =
    useState<MediaFormat | null>(null)
  // Carousel picked on a post with no slides yet: the Slides panel shows,
  // offering to make them, before the post is one.
  const [wantsCarousel, setWantsCarousel] = useState(false)
  // Why the post's slides could not be loaded. It has slides, so the panel
  // offers to load them again, never to make new ones over them.
  const [slidesError, setSlidesError] = useState<string | null>(null)

  /** The post's slides, or why they could not be loaded. */
  const fetchSlides = async (): Promise<SlideView[]> => {
    const res = await fetch(`/api/posts/${initialPost.id}/slides`)
    const body = (await res.json().catch(() => null)) as {
      success?: boolean
      slides?: SlideView[]
      error?: string
    } | null
    if (!res.ok || !body?.success || !body.slides) {
      throw new Error(body?.error || `The server answered ${res.status}.`)
    }
    return body.slides
  }

  const retrySlides = () => {
    setSlidesError(null)
    setSlidesLoading(true)
    void fetchSlides()
      .then(setSlides)
      .catch((err: Error) => setSlidesError(err.message))
      .finally(() => setSlidesLoading(false))
  }

  useEffect(() => {
    if ((initialPost.slideCount ?? 0) === 0) return
    let cancelled = false
    void fetchSlides()
      .then(loaded => {
        if (!cancelled) setSlides(loaded)
      })
      .catch((err: Error) => {
        console.error('Could not load the slides:', err)
        if (!cancelled) setSlidesError(err.message)
      })
      .finally(() => {
        if (!cancelled) setSlidesLoading(false)
      })
    return () => {
      cancelled = true
    }
    // Once per page: the page is keyed by post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // Started on another post's page: this page cannot show it.
      if (!isPostOpen(postId)) {
        showToast({
          type: 'success',
          title: 'Image ready',
          message: 'The new image is on the post it was made for.'
        })
      }
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

  // The preview and Copy show the saved post, which is what Approve saves (the
  // preview is hidden while the editor is open). Showing unsaved edits there
  // meant copying or approving one text while another was stored.
  // Copy, like Approve, takes the saved comment, in the form the preview shows.
  const copyableComment = toPlatformText(
    activePost?.firstComment,
    activePlatform
  )
  // What the format calls it: "First comment" on LinkedIn, "Reply" on X.
  const activeCommentLabel = activePost
    ? FORMATS[formatOf(activePost.formatId)].commentLabel
    : 'First comment'

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
      if (
        !window.confirm(
          'You have unsaved changes to this post. Leave this page and discard them?'
        )
      ) {
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
    // A GET, not a Server Action: the browser runs actions one at a time, so
    // the image would wait behind an approve or an edit made just before.
    void fetch(`/api/media/${activeMediaId}`)
      .then(
        async (
          response
        ): Promise<
          | { success: true; imageUrl: string }
          | { success: false; error: string }
        > => {
          const body = await response.json().catch(() => null)
          return body?.success && typeof body.imageUrl === 'string'
            ? { success: true, imageUrl: body.imageUrl }
            : { success: false, error: body?.error || 'Failed to load image' }
        }
      )
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

  // Diagram type, background and website sit behind "Image options".
  const [showAdvancedMedia, setShowAdvancedMedia] = useState(false)

  const clearReferenceImage = () => {
    setReferenceImage(null)
    setReferenceImageName(null)
    setReferenceMediaId(null)
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

    // A reference image is enough on its own, so words are optional. Either
    // way only what was typed and attached is used, never the post.
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
        ? `Generating a new image from your reference${imagePrompt.trim() ? ' and description' : ''}, sized for ${activePlatform.name}...`
        : referenceMediaId
          ? `Editing your image in HD, sized for ${activePlatform.name}...`
          : `Generating your image in HD, sized for ${activePlatform.name}...`,
      {
        prompt: imagePrompt.trim(),
        // The default look of an image from a prompt alone; an edit or a
        // reference keeps its own.
        style: imageStyle,
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
      imageStyle === 'minimal_graphic'
        ? `Designing a minimal graphic from the post, sized for ${activePlatform.name}. This takes about a minute.`
        : `Designing a ${imageStyleLabel(imageStyle).toLowerCase()} visual from the post, sized for ${activePlatform.name}, then checking the picture for stray lettering and artefacts. This takes about a minute.`,
      {
        fromPost: true,
        prompt: imagePrompt.trim(),
        style: imageStyle,
        visualType:
          imageStyle === 'minimal_graphic' ? (diagramType ?? undefined) : undefined
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
    const fileName = `${activePlatform.id}-visual-v${activePost?.media?.version || 1}.${extension}`

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
      markDataChanged()
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
      markDataChanged()
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
      markDataChanged()
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
    // The buffer takes the swap too, so it does not read as an unsaved edit.
    // This post's editor: if another post opens meanwhile, it has its own.
    const editor = editorRef.current
    const previousHook = editor?.draft.hook ?? ''
    editor?.setHook(newHook)
    if (!activePost) return
    setIsSaving(true)
    try {
      markDataChanged()
      const res = await updateDraft(activePost.id, { hook: newHook })
      if (!res.success) throw new Error(res.error)
      setPosts(prev =>
        prev.map(p =>
          p.id === activePost.id
            ? {
                ...p,
                hook: newHook,
                charCount: res.charCount ?? p.charCount,
                lintFindings: res.lintFindings ?? p.lintFindings,
                // The text it replaced is now an earlier version.
                versionCount: (p.versionCount ?? 0) + (res.versionSaved ? 1 : 0)
              }
            : p
        )
      )
    } catch (err: any) {
      // Undo the swap unless the hook has been edited meanwhile.
      editor?.setHook(current => (current === newHook ? previousHook : current))
      showToast({
        type: 'error',
        title: 'Hook not saved',
        message: err?.message || 'Failed to update draft'
      })
    } finally {
      setIsSaving(false)
    }
  }

  // A new version of a post's text (regenerate, restore). Its image is
  // unchanged, so the one already loaded is kept.
  const replacePostText = (updated: PostDetail) =>
    setPosts(prev =>
      prev.map(p =>
        p.id === updated.id
          ? { ...updated, media: p.media, mediaFailure: p.mediaFailure }
          : p
      )
    )

  const handleSaveEdits = async (draft: PostDraft) => {
    if (!activePost) return
    setIsSaving(true)
    try {
      markDataChanged()
      const res = await updateDraft(activePost.id, {
        hook: draft.hook,
        body: draft.body,
        firstComment: draft.firstComment,
        ...(draft.caption !== undefined ? { caption: draft.caption } : {}),
        ...(draft.title !== undefined ? { title: draft.title } : {})
      })
      if (!res.success) throw new Error(res.error)
      setPosts(prev =>
        prev.map(p =>
          p.id === activePost.id
            ? {
                ...p,
                hook: draft.hook,
                body: draft.body,
                firstComment: draft.firstComment,
                ...(draft.caption !== undefined || draft.title !== undefined
                  ? {
                      payload: {
                        ...(p.payload ?? {}),
                        ...(draft.caption !== undefined
                          ? { caption: draft.caption }
                          : {}),
                        ...(draft.title !== undefined
                          ? { title: draft.title }
                          : {})
                      }
                    }
                  : {}),
                // From the save: counted and checked on the text as stored.
                charCount: res.charCount ?? p.charCount,
                lintFindings: res.lintFindings ?? p.lintFindings,
                // The text it replaced is now an earlier version.
                versionCount: (p.versionCount ?? 0) + (res.versionSaved ? 1 : 0)
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
    const format = formatOf(activePost.formatId)
    // LinkedIn copies as its platform formats it (a bold hook); every other
    // format as plain text in its own shape.
    const success = await copyTextToClipboard(
      format === 'linkedin.post'
        ? platformPostText(activePost, activePlatform)
        : copyText(format, activePost)
    )
    if (success) {
      setCopiedPost(true)
      showToast({
        type: 'success',
        title: 'Post Copied!',
        message: hasUnsavedEdits
          ? 'Copied the saved post. Your unsaved edits are not included; save them to copy them.'
          : format === 'linkedin.post'
            ? `Post copied${activePlatform.unicodeBoldHook ? ' with a bold hook' : ''}, ready to paste into ${activePlatform.name}.`
            : FORMATS[format].structure === 'thread'
              ? 'Thread copied. Paste each post, separated by the "---" lines, in order.'
              : FORMATS[format].structure === 'script'
                ? 'Script and caption copied.'
                : `Copied, ready to paste into ${PLATFORMS[FORMATS[format].platform].label}.`
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
      const savedComment = activePost?.firstComment || ''
      const draftComment = editorRef.current?.draft.firstComment ?? savedComment
      setCopiedComment(true)
      showToast({
        type: 'success',
        title: 'Comment Copied!',
        message:
          draftComment !== savedComment
            ? 'Copied the saved comment. Your unsaved edits are not included; save them to copy them.'
            : `${activeCommentLabel} copied, ready to paste under the published post.`
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
          message: `Image copied to clipboard! You can paste (Ctrl+V) directly into ${activePlatform.name}.`
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
   * Approving or rejecting keeps the post open with its new status. Rejecting
   * also cancels its scheduled publication (rejectDraft does that on the
   * server), so it shows here as cancelled too.
   */
  const refreshAfterStatusChange = (id: string, status: string) => {
    setPosts(list =>
      list.map(p => {
        if (p.id !== id) return p
        const publication =
          status === 'rejected' && p.publication?.status === 'scheduled'
            ? {
                ...p.publication,
                status: 'cancelled' as const,
                error: 'Cancelled because the post was rejected.',
                errorCode: 'not_approved' as const
              }
            : p.publication
        return { ...p, status, publication }
      })
    )
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
      markDataChanged()
      const res = await approveDraft(approvedId)
      if (!res.success) throw new Error(res.error)
      refreshAfterStatusChange(approvedId, 'approved')
      showToast({
        type: 'success',
        title: 'Post approved'
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
    if (!activePost || activePublished || activePost.status === 'rejected')
      return
    if (!confirmDiscardEdits('Rejecting this post')) return
    const rejectedId = activePost.id

    setIsSaving(true)
    try {
      markDataChanged()
      const res = await rejectDraft(rejectedId, reason?.trim() || undefined)
      if (!res.success) throw new Error(res.error)
      refreshAfterStatusChange(rejectedId, 'rejected')
      // Closed only once it worked: a failure keeps the reason to try again.
      cancelPostRejection()
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

  /**
   * Hiding takes the post out of the posts list (Filters → Hidden posts shows it);
   * it stays open here, marked Hidden, with Unhide in its place.
   */
  const handleToggleHidden = async () => {
    if (!activePost) return
    const id = activePost.id
    const hide = !activePost.hiddenAt
    setIsSaving(true)
    try {
      markDataChanged()
      const res = await setDraftHidden(id, hide)
      if (!res.success) throw new Error(res.error)
      setPosts(list =>
        list.map(p => (p.id === id ? { ...p, hiddenAt: res.hiddenAt } : p))
      )
      showToast({
        type: 'success',
        title: hide ? 'Post hidden' : 'Post unhidden',
        message: hide
          ? 'It no longer shows in the posts list. Turn on Hidden posts in Filters to see it.'
          : 'It shows in the posts list again.'
      })
    } catch (err: any) {
      showToast({
        type: 'error',
        title: hide ? 'Post not hidden' : 'Post not unhidden',
        message: err?.message || 'Failed to update the post'
      })
    } finally {
      setIsSaving(false)
    }
  }

  // Published and still on its platform, whose API can delete it: the Delete
  // dialog offers to remove it there too.
  const canDeleteFromPlatform =
    activePost?.publication?.status === 'published' &&
    !activePost.publication.deletedAt &&
    activePost.publication.canDelete

  const openDeleteDialog = () => {
    if (!confirmDiscardEdits('Deleting this post')) return
    setAlsoDeleteFromPlatform(false)
    setShowDeleteDialog(true)
  }

  // A deleted post has no page: the list opens instead.
  const handleDelete = async () => {
    if (!activePost) return
    const id = activePost.id
    const alsoFromPlatform = canDeleteFromPlatform && alsoDeleteFromPlatform
    setIsDeleting(true)
    try {
      markDataChanged()
      const res = await deleteDraft(id, { alsoFromPlatform })
      if (!res.success) throw new Error(res.error)
      showToast({
        type: 'success',
        title: 'Post deleted',
        message: res.deletedFromPlatform
          ? `It was deleted from ${activePlatform.name} too.`
          : undefined
      })
      router.push(backHref)
    } catch (err: any) {
      // The dialog stays open, so the platform choice can be changed.
      showToast({
        type: 'error',
        title: 'Post not deleted',
        message: err?.message || 'Failed to delete the post'
      })
      // It may have left the platform before the rest failed.
      if (alsoFromPlatform) {
        const publication = await getPostPublication(id).catch(() => null)
        if (publication) {
          setPosts(list =>
            list.map(p => (p.id === id ? { ...p, publication } : p))
          )
        }
      }
      setIsDeleting(false)
    }
  }

  // Decision shortcuts (A approve, R reject, C copy). Declared after the
  // handlers they call; an Effect Event, so the listener is added once.
  const onDecisionKeyDown = useEffectEvent((event: KeyboardEvent) => {
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
      if (activePost.status === 'rejected' || activePublished) return
      event.preventDefault()
      setShowPostRejection(true)
    } else if (key === 'c') {
      event.preventDefault()
      void handleCopyPost()
    } else if (event.key === 'Escape' && showPostRejection) {
      cancelPostRejection()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', onDecisionKeyDown)
    return () => window.removeEventListener('keydown', onDecisionKeyDown)
  }, [])

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

  // Buttons stay disabled until their input is valid; messages only appear once the
  // user has typed something, so an untouched field is not shown as an error.
  const promptError = validateImagePrompt(imagePrompt)
  const showPromptError = imagePrompt.trim().length > 0 && promptError !== null
  // With nothing typed and no reference, the main button designs an image
  // from the post text (a new concept each time). Anything typed or attached
  // is used on its own instead, without the post.
  const regenerateFromPost = !imagePrompt.trim() && !referenceImage
  // An uploaded reference is enough by itself, so a prompt is optional. It
  // does not read the post, so unsaved edits do not hold it up.
  const guidedByReference = Boolean(referenceImage) && !referenceMediaId
  // An edit keeps its image's look and a reference brings its own.
  const styleLocked = Boolean(referenceImage) || Boolean(referenceMediaId)
  const mainButtonBlocked = regenerateFromPost
    ? isEditing
    : guidedByReference
      ? showPromptError
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

  // Another version of the idea is another post, on its own page.
  const openVersion = (postId: string) => {
    if (postId === activePost.id) return
    if (!confirmDiscardEdits('Opening another version')) return
    router.push(postHref(postId))
  }

  // A version just written (Add a version) opens at once, for review.
  const handleVersionAdded = (added: PostDetail) => {
    markDataChanged()
    setPosts(prev => [
      added,
      // Its siblings now have one more format between them.
      ...prev.map(p =>
        p.ideaId && p.ideaId === added.ideaId
          ? { ...p, ideaFormats: added.ideaFormats }
          : p
      )
    ])
    if (confirmDiscardEdits('Opening the new version')) {
      router.push(postHref(added.id))
    }
  }

  const activeFormat = formatOf(activePost.formatId)
  // What goes out with the text (src/lib/formats/media.ts), and what the
  // page shows: a carousel picked before it has slides shows the Slides
  // panel to make them.
  const activeMediaFormat = resolveMediaFormat(
    activeFormat,
    activePost.mediaFormat,
    { image: Boolean(activePost.media) }
  )
  const shownMedia: MediaFormat = wantsCarousel ? 'carousel' : activeMediaFormat
  // Set aside by "Text only": the image is kept but does not go out.
  const imageSetAside = activePost.mediaFormat === 'text'
  // Published or marked posted: what went out stays as it is.
  const mediaLocked =
    Boolean(activePost.postedAt) ||
    activePost.publication?.status === 'published' ||
    activePost.publication?.status === 'publishing'

  // Whether the post is ready for its platform, from what is saved.
  const publishChecks = validatePost({
    formatId: activeFormat,
    mediaFormat: activeMediaFormat,
    post: activePost,
    image: { present: Boolean(activePost.media) },
    slides:
      activeMediaFormat !== 'carousel'
        ? []
        : slides
          ? slides.map(s => ({
              position: s.position,
              headline: s.headline,
              body: s.body,
              status: s.status
            }))
          : slidesLoading || slidesError
            ? null
            : [],
    siblings: posts
      .filter(p => p.id !== activePost.id)
      .map(p => ({
        formatId: formatOf(p.formatId),
        text: copyText(formatOf(p.formatId), p)
      }))
  })
  const activeMeter = captionMeter(activeFormat, activePost)

  // The AI planned a carousel for a post that is not one: drafted before
  // carousels were made automatically, or its slides could not be made.
  // Offered in one click, until the reviewer picks a post type themselves.
  const plannedVisual =
    typeof activePost.payload?.visualIdea === 'string'
      ? activePost.payload.visualIdea
      : ''
  const captionSaysSwipe = carouselWording(
    [activePost.hook, activePost.body, activePost.cta].filter(Boolean).join('\n')
  )
  const carouselSuggested =
    !mediaLocked &&
    !activePost.mediaFormat &&
    shownMedia !== 'carousel' &&
    supportsMediaFormat(activeFormat, 'carousel') &&
    (suggestsCarousel(plannedVisual) || captionSaysSwipe !== null)

  // The carousel, swipeable, where the platform shows a post's media; the
  // image a text-only post set aside is not shown, since it does not go out.
  const carouselPreview =
    shownMedia === 'carousel' ? (
      <CarouselViewer
        slides={(slides ?? []).map(s => ({
          id: s.id,
          position: s.position,
          imageUrl: s.imageUrl,
          altText: s.altText,
          status: s.status
        }))}
        platform={activePost.platform}
        title={slides?.[0]?.headline}
        index={slideIndex}
        onIndexChange={setSlideIndex}
        onOpen={setZoomSlide}
        loading={slidesLoading}
        error={slidesError}
      />
    ) : undefined
  const previewImageUrl =
    imageSetAside || shownMedia === 'carousel' ? undefined : activePost.media?.imageUrl

  /** Saves what goes out with the text; a carousel without slides waits for them. */
  const handleMediaFormatChange = async (next: MediaFormat) => {
    if (
      next === 'carousel' &&
      !(slides && slides.length > 0) &&
      !(activePost.slideCount ?? 0)
    ) {
      setWantsCarousel(true)
      return
    }
    setWantsCarousel(false)
    if (next === activeMediaFormat && activePost.mediaFormat === next) return
    const id = activePost.id
    setPendingMediaFormat(next)
    try {
      markDataChanged()
      const res = await setPostMediaFormat(id, next)
      if (!res.success) throw new Error(res.error)
      setPosts(prev =>
        prev.map(p =>
          p.id === id
            ? {
                ...p,
                mediaFormat: res.mediaFormat,
                lintFindings: (res.lintFindings as PostDetail['lintFindings']) ?? p.lintFindings
              }
            : p
        )
      )
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Post type not changed',
        message: err?.message || 'Could not change the post type'
      })
    } finally {
      setPendingMediaFormat(null)
    }
  }
  // The shape its platform shows images in (LinkedIn 1.91:1, X 16:9,
  // Instagram and Facebook 4:5). Every generated image is made at it; one
  // made for another platform, or found or pasted, is flagged so it can be
  // regenerated to fit.
  const platformShape = FORMATS[activeFormat].imageShape
  const shapeSize = SHAPE_SIZES[platformShape]
  const mediaWidth = activePost.media?.width
  const mediaHeight = activePost.media?.height
  const imageOffShape =
    Boolean(mediaWidth && mediaHeight) &&
    Math.abs(
      Math.log(
        mediaWidth! / mediaHeight! / (shapeSize.width / shapeSize.height)
      )
    ) > 0.06
  // The app publishes this format itself; a Reel or a video script is copied
  // out and posted by hand.
  const canPublish = canPublishFormat(activePost.platform, activeFormat)
  // The user's connection to the platform; null when publishing to it is not
  // set up on this server.
  const publishing = usePlatformPublishing(activePost.platform)
  const isApproved = activePost.status === 'approved'
  const isLive =
    Boolean(activePost.postedAt) ||
    activePost.publication?.status === 'published'

  // What to do next, in one sentence, for where the post stands (shown when
  // hovering the status in the top bar).
  const nextStep = showPostRejection
    ? 'Say why if you like: the reason shapes future drafts.'
    : activePost.status === 'rejected'
      ? 'This post was rejected. Approve it if you change your mind.'
      : !isApproved
        ? 'Check the preview and the image, edit anything you want, then approve the post.'
        : isLive
          ? `This post is on ${activePlatform.name}.`
          : canPublish && publishing
            ? `Approved. Publish it to ${activePlatform.name} now, schedule it, or copy it and post it yourself.`
            : `Approved. Copy it and post it on ${activePlatform.name} yourself.`

  // Review, then publish, in the top bar: Approve or Reject until the post is
  // approved, then Publish now and Schedule. A format the app does not publish
  // (or publishing not set up here) gets Copy post instead.
  const publishBar = showPostRejection ? (
    <form
      onSubmit={e => {
        e.preventDefault()
        void handleReject(postRejectionReason)
      }}
      // The shortcuts listen on window and skip text fields, so Escape in
      // the reason never reached them; it is handled here, and keys pressed
      // on the form's buttons must not approve or copy.
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Escape') cancelPostRejection()
      }}
      className="flex min-w-0 flex-wrap items-center justify-end gap-2"
    >
      <input
        type="text"
        autoFocus
        value={postRejectionReason}
        onChange={e => setPostRejectionReason(e.target.value)}
        placeholder="Why reject? Optional"
        aria-label="Why reject this post (optional)"
        className="border-border bg-surface text-foreground placeholder:text-muted h-8 w-48 max-w-full min-w-0 rounded-lg border px-3 text-xs outline-none focus:border-rose-500 sm:w-60"
      />
      <button
        type="button"
        onClick={cancelPostRejection}
        className="text-muted hover:text-foreground h-8 cursor-pointer rounded-lg px-2.5 text-[13px] font-medium"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSaving}
        className="h-8 cursor-pointer rounded-lg bg-rose-600 px-3.5 text-[13px] font-semibold text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-50"
      >
        {isSaving ? 'Rejecting…' : 'Reject post'}
      </button>
    </form>
  ) : (
    <>
      <span title={nextStep} className="flex">
        <PostStatusPill post={activePost} />
      </span>
      {isApproved ? (
        <>
          {canPublish && (
            <PublishControls
              key={activePost.id}
              platform={activePost.platform}
              formatId={activeFormat}
              postId={activePost.id}
              postedAt={activePost.postedAt ?? null}
              publication={activePost.publication}
              media={activeMediaFormat}
              slideCount={slides?.length ?? activePost.slideCount ?? 0}
              onChange={publication => {
                const id = activePost.id
                setPosts(prev =>
                  prev.map(p => (p.id === id ? { ...p, publication } : p))
                )
              }}
            />
          )}
          {(!canPublish || !publishing) && !isLive && (
            <button
              type="button"
              onClick={handleCopyPost}
              className="bg-accent text-background hover:bg-accent-hover flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-xs transition-colors"
            >
              {copiedPost ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedPost ? 'Post copied' : 'Copy post'}
            </button>
          )}
          {!activePublished && (
            <button
              type="button"
              onClick={() => setShowPostRejection(true)}
              className="text-muted h-8 cursor-pointer px-1 text-[12px] hover:text-rose-600 dark:hover:text-rose-400"
            >
              Reject instead
            </button>
          )}
        </>
      ) : (
        <>
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
            className="bg-accent text-background hover:bg-accent-hover flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-xs transition-colors disabled:opacity-60"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            {isSaving
              ? 'Saving…'
              : activePost.status === 'rejected'
                ? 'Approve instead'
                : 'Approve'}
          </button>
        </>
      )}
    </>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        // The publish controls share the bar, on a row of their own when
        // they do not fit beside the title.
        wrapActions
        preTitle={
          <Link
            href={backHref}
            title="Back to all posts"
            className="border-border text-muted hover:bg-surface-hover hover:text-foreground flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">All posts</span>
          </Link>
        }
        // The platform's logo beside the title and its byline, which line
        // up under each other (PageHeader's description would sit under
        // the back link instead).
        title={
          <div className="flex min-w-0 items-center gap-3">
            <PlatformMark
              platform={activePost.platform}
              colored
              className="h-9 w-9 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-foreground flex min-w-0 items-center gap-2 text-lg leading-tight font-bold tracking-tight">
                <span className="truncate">{FORMATS[activeFormat].label}</span>
                {activePost.hiddenAt && (
                  <span className="border-border bg-surface-hover text-muted shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold">
                    Hidden
                  </span>
                )}
              </h1>
              <p className="text-muted mt-0.5 truncate text-xs sm:text-sm">
                {activePost.accountName} · Drafted{' '}
                <span title={formatAbsoluteDateTime(activePost.createdAt)}>
                  {hasMounted
                    ? formatRelativeDate(activePost.createdAt)
                    : formatAbsoluteDate(activePost.createdAt)}
                </span>
              </p>
            </div>
          </div>
        }
        actions={
          // Fragments, so every control wraps in the bar's own row.
          <>
            {publishBar}
            <span aria-hidden className="bg-border hidden h-5 w-px sm:block" />
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void handleToggleHidden()}
              aria-label={activePost.hiddenAt ? 'Unhide post' : 'Hide post'}
              title={
                activePost.hiddenAt
                  ? 'Show it in the posts list again'
                  : 'Hide it from the posts list (Filters → Hidden posts shows it)'
              }
              className="border-border text-muted hover:bg-surface-hover hover:text-foreground flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              {activePost.hiddenAt ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              // The server refuses too: it may be on its platform any moment.
              disabled={
                isSaving || activePost.publication?.status === 'publishing'
              }
              onClick={openDeleteDialog}
              aria-label="Delete post"
              title={
                activePost.publication?.status === 'publishing'
                  ? `It is being published to ${activePlatform.name} right now`
                  : 'Delete post'
              }
              className="border-border text-muted flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors hover:border-rose-500/40 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-rose-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        }
      />

      {showDeleteDialog && activePost && (
        <ConfirmDialog
          title="Delete this post?"
          description={
            <>
              It is removed from the app for good, with its image and
              alternates. This cannot be undone.
              {activePost.publication?.status === 'scheduled' &&
                ` Its scheduled ${activePlatform.name} publishing is cancelled.`}
              {canDeleteFromPlatform && (
                <label className="text-foreground mt-3 flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={alsoDeleteFromPlatform}
                    disabled={isDeleting}
                    onChange={e => setAlsoDeleteFromPlatform(e.target.checked)}
                    className="mt-1 accent-rose-600"
                  />
                  <span>
                    Also delete it from {activePlatform.name}, with its
                    reactions and comments. Otherwise it stays on{' '}
                    {activePlatform.name}.
                  </span>
                </label>
              )}
            </>
          }
          confirmLabel="Delete post"
          pendingLabel="Deleting…"
          pending={isDeleting}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={() => void handleDelete()}
        />
      )}

      {/* Full width, 16px in from each side (24px from sm), lined up with
          the top bar's title. Sized by its own width (the
          sidebar takes part of the screen), so the columns use @-variants.
          With two columns, each card scrolls on its own inside the screen's
          height, so no card runs past the bottom of the screen. */}
      <div className="bg-surface-hover/30 @container flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6 @3xl:overflow-hidden">
          {/* The idea's versions (LinkedIn, X…), and Add a version */}
          <IdeaVersions
            post={activePost}
            posts={posts}
            enabledFormats={enabledFormats}
            disabled={isSaving}
            onOpen={openVersion}
            onAdded={handleVersionAdded}
            className="shrink-0"
          />
          {/* Left: how the post will look. Right: its image, in a narrower
              panel. Two rows from @3xl: the header rows share the first
              (each column is a subgrid), so the two cards always start level
              in the second, even when a header wraps. */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 @3xl:min-h-0 @3xl:flex-1 @3xl:grid-cols-[minmax(0,1fr)_clamp(18rem,32%,32rem)] @3xl:grid-rows-[auto_minmax(0,1fr)] @6xl:gap-x-8">
            {/* LEFT COLUMN: the post as it will appear, and its text */}
            <div className="flex min-w-0 flex-col gap-3 @3xl:row-span-2 @3xl:grid @3xl:grid-rows-subgrid">
              <div className="relative flex min-h-8 flex-wrap items-center justify-between gap-x-6 gap-y-1 px-1">
                <span className="text-muted text-xs font-semibold tracking-wider uppercase">
                  {formatOf(activePost.formatId) === 'linkedin.post'
                    ? `${activePlatform.name} preview`
                    : previewTitle(activePost.formatId)}
                </span>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={handleCopyPost}
                    className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-2 text-sm font-medium"
                  >
                    {copiedPost ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    <span>{copiedPost ? 'Copied' : 'Copy text'}</span>
                  </button>
                  {/* LinkedIn's preview has its own copy button on the comment. */}
                  {copyableComment &&
                    formatOf(activePost.formatId) !== 'linkedin.post' && (
                      <button
                        type="button"
                        onClick={handleCopyComment}
                        className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-2 text-sm font-medium"
                      >
                        {copiedComment ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <MessageSquare className="h-4 w-4" />
                        )}
                        <span>
                          {copiedComment
                            ? 'Copied'
                            : `Copy ${activeCommentLabel.toLowerCase()}`}
                        </span>
                      </button>
                    )}
                  {/* A published post (or one marked posted) keeps the text
                      that went out; regenerateDraft refuses it too. */}
                  {!activePublished && !activePost.postedAt && (
                    <RegenerateControl
                      key={activePost.id}
                      post={activePost}
                      disabled={isEditing || isSaving}
                      onDone={replacePostText}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setIsEditing(!isEditing)}
                    className="text-accent inline-flex cursor-pointer items-center gap-2 text-sm font-medium hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50"
                  >
                    <Edit2 className="h-4 w-4" />
                    <span>
                      {isEditing ? 'View Feed Preview' : 'Edit Post Text'}
                    </span>
                  </button>
                </div>
              </div>

              {/* The column's scrolling part; the card is centred in it at a
                  feed-like width. */}
              <div className="min-h-0 @3xl:overflow-y-auto">
                <div className="mx-auto w-full max-w-4xl space-y-3">
                  {/* IN-PLACE TEXT EDITOR OR REALISTIC FEED PREVIEW */}
                  <PostTextEditor
                    // A new version (regenerate, restore) starts the editor afresh.
                    key={`${activePost.id}-${activePost.versionCount ?? 0}`}
                    ref={editorRef}
                    post={activePost}
                    open={isEditing}
                    saving={isSaving}
                    onDirtyChange={setHasUnsavedEdits}
                    onSave={handleSaveEdits}
                    onClose={() => setIsEditing(false)}
                  />
                  {!isEditing &&
                    formatOf(activePost.formatId) !== 'linkedin.post' && (
                      <div className="flex w-full justify-center">
                        <VariantPreview
                          key={activePost.id}
                          formatId={formatOf(activePost.formatId)}
                          authorName={activePost.accountName}
                          authorInitials={authorInitials}
                          hook={activePost.hook || ''}
                          body={activePost.body || ''}
                          cta={activePost.cta}
                          hashtags={activePost.hashtags}
                          firstComment={activePost.firstComment}
                          payload={activePost.payload}
                          mediaUrl={previewImageUrl}
                          mediaAltText={activePost.media?.altText}
                          carousel={carouselPreview}
                          onMediaClick={
                            activePost.media?.imageUrl
                              ? () => setIsImageZoomOpen(true)
                              : undefined
                          }
                        />
                      </div>
                    )}
                  {!isEditing &&
                    formatOf(activePost.formatId) === 'linkedin.post' && (
                      <div className="flex w-full justify-center">
                        <PostPreview
                          key={activePost.id}
                          platform={activePlatform}
                          authorName={activePost.accountName}
                          authorHeadline={activePost.accountHeadline}
                          authorInitials={authorInitials}
                          hook={activePost.hook || ''}
                          body={activePost.body || ''}
                          cta={activePost.cta}
                          hashtags={activePost.hashtags}
                          mediaUrl={previewImageUrl}
                          mediaAltText={activePost.media?.altText}
                          carousel={carouselPreview}
                          onMediaClick={
                            activePost.media?.imageUrl
                              ? () => setIsImageZoomOpen(true)
                              : undefined
                          }
                          // Swapping the hook edits the post, so it's offered only while active.
                          hookOptions={
                            hookOptions.length > 1 ? hookOptions : []
                          }
                          onSelectHook={handleSwapHook}
                          hookSwapDisabled={isSaving}
                          firstComment={activePost.firstComment || ''}
                          onCopyFirstComment={handleCopyComment}
                          firstCommentCopied={copiedComment}
                        />
                      </div>
                    )}
                  {!isEditing && (
                    <PublishChecks
                      platformName={activePlatform.name}
                      meter={activeMeter}
                      checks={publishChecks}
                    />
                  )}
                  {!isEditing && (
                    <VersionHistory
                      key={activePost.id}
                      post={activePost}
                      disabled={isSaving}
                      onRestored={replacePostText}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: the image. Its header shares the preview
                header's row. */}
            <div className="flex min-w-0 flex-col gap-3 @3xl:row-span-2 @3xl:grid @3xl:grid-rows-subgrid">
              <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 px-1">
                {/* What goes out with the text: text only, an image or a carousel. */}
                <PostTypePicker
                  formatId={activeFormat}
                  value={shownMedia}
                  onChange={next => void handleMediaFormatChange(next)}
                  disabled={mediaLocked || pendingMediaFormat !== null || mediaBusyHere}
                  pending={pendingMediaFormat}
                />
                {shownMedia === 'carousel' ? (
                  <span className="text-muted bg-surface-hover rounded-full px-2 py-0.5 text-[10px] font-medium">
                    {slides?.length ?? activePost.slideCount ?? 0} slides
                  </span>
                ) : imageSetAside ? null : activePost.media?.imageUrl && isUserPromptedMedia ? (
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

              <div className="min-h-0 @3xl:overflow-y-auto">
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
                {/* IMAGE CARD: the post's image, and making a new one with AI.
                  Its notices sit inside it, so the card never drops below
                  the preview's top edge. */}
                {/* Slides on the review screen: zoomed one at a time. */}
                {zoomSlide !== null && slides?.[zoomSlide]?.imageUrl && (
                  <ImageLightbox
                    src={slides[zoomSlide].imageUrl!}
                    alt={slides[zoomSlide].altText || `Slide ${zoomSlide + 1}`}
                    width={1080}
                    height={1350}
                    onClose={() => setZoomSlide(null)}
                  />
                )}
                {carouselSuggested && (
                  <div className="border-accent/30 bg-accent/5 mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-2xl border p-3 text-xs">
                    <span className="text-foreground min-w-0 flex-1 leading-relaxed">
                      <Layers className="text-accent mr-1.5 inline h-3.5 w-3.5 align-[-2px]" />
                      The AI planned this post as a carousel
                      {captionSaysSwipe
                        ? `, and its caption says “${captionSaysSwipe}”. Make the slides so the post has what it promises.`
                        : '.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setWantsCarousel(true)}
                      disabled={pendingMediaFormat !== null || mediaBusyHere}
                      className="bg-accent text-background hover:bg-accent-hover inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      Make it a carousel
                    </button>
                  </div>
                )}
                {shownMedia === 'carousel' ? (
                  // SLIDES CARD: a carousel's slides, each edited on its own.
                  <div className="border-border bg-surface rounded-2xl border p-4 shadow-sm">
                    <SlidesPanel
                      postId={activePost.id}
                      formatId={activeFormat}
                      slides={slides}
                      loading={slidesLoading}
                      onSlidesChange={next => {
                        setSlides(next)
                        const id = activePost.id
                        setPosts(prev =>
                          prev.map(p => (p.id === id ? { ...p, slideCount: next.length } : p))
                        )
                      }}
                      onGenerated={result => {
                        setSlides(result.slides)
                        setWantsCarousel(false)
                        const id = activePost.id
                        setPosts(prev =>
                          prev.map(p =>
                            p.id === id
                              ? {
                                  ...p,
                                  mediaFormat: 'carousel',
                                  slideCount: result.slides.length,
                                  lintFindings:
                                    (result.lintFindings as PostDetail['lintFindings']) ??
                                    p.lintFindings
                                }
                              : p
                          )
                        )
                      }}
                      activeIndex={slideIndex}
                      onActiveIndexChange={setSlideIndex}
                      locked={mediaLocked}
                      drawsPictures={isPictureStyle(brand.style)}
                      loadError={slidesError}
                      onRetryLoad={retrySlides}
                    />
                  </div>
                ) : imageSetAside ? (
                  <div className="border-border bg-surface space-y-2 rounded-2xl border p-4 text-xs shadow-sm">
                    <p className="text-foreground font-semibold">Text only</p>
                    <p className="text-muted leading-relaxed">
                      This post goes out without media.
                      {activePost.media
                        ? ' Its image is kept: pick Single image to use it again.'
                        : ' Pick Single image or Carousel to add visuals.'}
                    </p>
                  </div>
                ) : (
                <div className="border-border bg-surface space-y-4 rounded-2xl border p-4 shadow-sm">
                  {isMediaLoading && !mediaBusyHere && (
                    <p className="text-muted text-[11px]">
                      An image for another post is still being processed. Media
                      actions here unlock when it finishes.
                    </p>
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

                  {mediaBusyHere ? (
                    <div className="border-border bg-surface-hover/50 text-muted flex animate-pulse flex-col items-center justify-center space-y-2 rounded-xl border py-6 text-xs">
                      <Loader2 className="text-accent h-5 w-5 animate-spin" />
                      <p className="text-foreground font-medium">
                        {mediaLoadingText || 'Processing media asset...'}
                      </p>
                    </div>
                  ) : activePost.media?.imageUrl ? (
                    <div className="space-y-4">
                      <button
                        type="button"
                        onClick={() => setIsImageZoomOpen(true)}
                        aria-label="Zoom image"
                        className="group border-border relative block w-full cursor-zoom-in overflow-hidden rounded-xl border bg-neutral-900"
                      >
                        <Image
                          src={activePost.media.imageUrl}
                          alt={activePost.media.altText || 'Generated visual'}
                          width={activePost.media.width || 2048}
                          height={activePost.media.height || 1072}
                          className="h-auto max-h-72 w-full object-contain"
                          unoptimized
                        />
                        <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                          <ZoomIn className="h-3 w-3" />
                          Zoom
                        </span>
                      </button>
                      {/* Which image this is, and what to do with it */}
                      <div className="border-border text-muted flex flex-wrap items-center gap-x-2 gap-y-1 border-b pb-4 text-[13px]">
                        <span className="text-foreground font-medium">
                          Media v{activePost.media.version || 1}
                        </span>
                        <span>·</span>
                        {activePost.media.width && activePost.media.height ? (
                          <span className="font-mono text-xs">
                            {activePost.media.width} × {activePost.media.height}{' '}
                            HD
                          </span>
                        ) : (
                          <span className="capitalize">
                            {activePost.media.mode.replace('_', ' ')}
                          </span>
                        )}
                        {activePost.media.workflow === 'edit' && (
                          <>
                            <span>·</span>
                            <span>edited</span>
                          </>
                        )}
                        <span className="ml-auto flex items-center gap-4">
                          <button
                            type="button"
                            onClick={handleDownloadMedia}
                            className="text-foreground hover:text-accent inline-flex cursor-pointer items-center gap-1.5 font-medium hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download image
                          </button>
                          <button
                            type="button"
                            disabled={isMediaLoading}
                            onClick={handleRemoveMedia}
                            className="text-muted inline-flex cursor-pointer items-center gap-1.5 font-medium hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </span>
                      </div>
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

                  {/* An image in another platform's shape (made before, or
                      found or pasted): the platform would crop or pad it. */}
                  {activePost.media?.imageUrl &&
                    imageOffShape &&
                    !mediaBusyHere && (
                      <div className="flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-700 dark:text-sky-300">
                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          This image is {mediaWidth} × {mediaHeight}, not{' '}
                          {activePlatform.name}&apos;s{' '}
                          {platformShape === '4:5' ? 'portrait' : 'landscape'}{' '}
                          {platformShape} shape, so it may be cropped there.
                          Regenerate it to get one sized for{' '}
                          {activePlatform.name}.
                        </span>
                      </div>
                    )}

                  {/* The look of the next image. An edit keeps its image's
                      look and a reference brings its own, so neither uses it. */}
                  {!mediaBusyHere && (
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span
                          id="image-style-label"
                          className="text-foreground text-[11px] font-semibold"
                        >
                          Style
                        </span>
                        {imageStyle !== brand.style && !styleLocked && (
                          <button
                            type="button"
                            onClick={() => setImageStyle(brand.style)}
                            className="text-muted hover:text-foreground cursor-pointer text-[10px]"
                          >
                            Back to the Brand Theme&apos;s{' '}
                            {imageStyleLabel(brand.style)}
                          </button>
                        )}
                      </div>
                      <div
                        role="radiogroup"
                        aria-labelledby="image-style-label"
                        className="flex flex-wrap gap-1.5"
                      >
                        {IMAGE_STYLES.map(option => {
                          const active = imageStyle === option.value
                          const Icon = IMAGE_STYLE_ICONS[option.value]
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              title={option.description}
                              disabled={styleLocked}
                              onClick={() => setImageStyle(option.value)}
                              className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                active
                                  ? 'border-accent bg-accent/10 text-foreground font-semibold'
                                  : 'border-border bg-surface text-muted hover:text-foreground'
                              }`}
                            >
                              <Icon
                                className={`h-3.5 w-3.5 ${active ? 'text-accent' : ''}`}
                              />
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                      <p className="text-muted text-[10px]">
                        {referenceMediaId
                          ? 'An edit keeps the current image’s look unless you ask for another.'
                          : referenceImage
                            ? 'A reference image brings its own look.'
                            : IMAGE_STYLES.find(o => o.value === imageStyle)
                                ?.description}
                      </p>
                    </div>
                  )}

                  {/* Generate / Change media: first, so they stay in view on
                      short screens. The main button takes the spare width;
                      when the panel is too narrow for both labels, they wrap
                      onto two full-width rows instead of breaking a label. */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    {isGenerating && mediaBusyHere ? (
                      <button
                        type="button"
                        onClick={handleStopGeneration}
                        className="flex h-9 flex-[999_1_auto] cursor-pointer items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 text-sm font-semibold whitespace-nowrap text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400"
                      >
                        <CircleStop className="h-4 w-4" />
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
                          regenerateFromPost && isEditing
                            ? 'Save your edits first so the image matches the post'
                            : undefined
                        }
                        className="bg-accent hover:bg-accent-hover text-background flex h-9 flex-[999_1_auto] cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold whitespace-nowrap shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {mediaBusyHere ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        <span>
                          {activePost.media?.imageUrl
                            ? 'Regenerate image'
                            : 'Generate image'}
                        </span>
                      </button>
                    )}

                    <div className="relative flex-[1_1_auto]">
                      <button
                        type="button"
                        disabled={isMediaLoading}
                        onClick={() => setMediaMenuOpen(!mediaMenuOpen)}
                        className="border-border hover:bg-surface-hover text-foreground flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span>Change media</span>
                        <ChevronDown className="text-muted h-4 w-4" />
                      </button>

                      {mediaMenuOpen && (
                        <div className="border-border bg-surface animate-in fade-in zoom-in-95 absolute right-0 z-20 mt-1 w-56 rounded-xl border py-1.5 text-sm shadow-xl duration-100">
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
                          disabled={isMediaLoading || stockQueryError !== null}
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

                  {/* Prompt-driven generation */}
                  {!mediaBusyHere && (
                    <div className="border-border bg-surface-hover/50 space-y-3 rounded-xl border p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <label
                          htmlFor="image-prompt"
                          className="text-foreground block text-sm font-medium"
                        >
                          {referenceMediaId
                            ? 'Describe the change you want'
                            : referenceImage
                              ? 'Add direction (optional)'
                              : 'Describe the image you want'}
                          {!referenceImage && (
                            <span
                              title="With nothing typed, a new image is designed from the post"
                              className="text-muted text-[13px] font-normal"
                            >
                              {' '}
                              · or leave empty
                            </span>
                          )}
                        </label>
                        {(imagePrompt || referenceImage) && (
                          <button
                            type="button"
                            onClick={clearPromptAndReference}
                            className="text-muted hover:text-foreground cursor-pointer text-xs font-medium"
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
                        rows={2}
                        placeholder={
                          referenceMediaId
                            ? 'e.g. Replace the headline with "Ship it", or make the background warmer'
                            : referenceImage
                              ? 'e.g. Keep this layout, but about faster order approvals'
                              : 'e.g. A sales rep reviewing a quote with a customer on a warehouse floor, morning light'
                        }
                        aria-invalid={showPromptError}
                        aria-describedby={
                          showPromptError
                            ? 'image-prompt-error image-prompt-hint'
                            : 'image-prompt-hint'
                        }
                        // Grows with what is typed (and the placeholder), so a
                        // narrow panel never cuts the example off.
                        className="border-border bg-background text-foreground placeholder:text-muted focus:border-accent field-sizing-content max-h-48 min-h-16 w-full resize-y rounded-lg border px-3 py-2.5 text-sm outline-none aria-invalid:border-rose-500"
                      />
                      {showPromptError && (
                        <p
                          id="image-prompt-error"
                          className="text-xs text-rose-600 dark:text-rose-400"
                        >
                          {promptError}
                        </p>
                      )}

                      {referenceImage && (
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
                            <p className="text-foreground truncate text-xs font-medium">
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
                      )}

                      {/* The word count, and the ways to guide it with an image */}
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                        <span
                          id="image-prompt-hint"
                          className={`font-mono tabular-nums ${
                            countWords(imagePrompt) > IMAGE_PROMPT_MAX_WORDS
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-muted'
                          }`}
                        >
                          {countWords(imagePrompt)}/{IMAGE_PROMPT_MAX_WORDS}{' '}
                          words
                        </span>
                        {!referenceImage && (
                          <span className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => referenceInputRef.current?.click()}
                              title="Attach an image: the new one is made from it and your words, not the post"
                              className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 font-medium"
                            >
                              <Paperclip className="h-3.5 w-3.5" />
                              Attach reference
                            </button>
                            {activePost.media?.imageUrl && (
                              <button
                                type="button"
                                onClick={useCurrentImageAsReference}
                                title="Edit the current image instead of designing a new one"
                                className="text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 font-medium"
                              >
                                <ImageIcon className="h-3.5 w-3.5" />
                                Use current
                              </button>
                            )}
                          </span>
                        )}
                      </div>

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

                  {/* Generation from the post's own text, the typed words
                        only as direction. With nothing typed, or a reference
                        attached, the main button already does this. */}
                  {!mediaBusyHere &&
                    !guidedByReference &&
                    !regenerateFromPost && (
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
                          className="border-accent/40 text-accent hover:bg-accent/10 flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <FileText className="h-4 w-4" />
                          <span>Design from the post text instead</span>
                        </button>
                        <p className="text-muted text-[10px]">
                          {isEditing
                            ? 'Save your edits first so the image matches the post.'
                            : null}
                        </p>
                      </div>
                    )}

                  {/* Diagram type, background and website: set once and
                        rarely changed, so folded away until asked for. */}
                  {!mediaBusyHere && (
                    <button
                      type="button"
                      onClick={() => setShowAdvancedMedia(open => !open)}
                      aria-expanded={showAdvancedMedia}
                      className="border-border text-foreground/85 hover:text-foreground flex w-full cursor-pointer items-center justify-between gap-2 border-t pt-4 text-sm font-medium"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <SlidersHorizontal className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          Image options
                          <span className="text-muted font-normal">
                            {' '}
                            ·{' '}
                            {imageStyle === 'minimal_graphic'
                              ? 'diagram, background, website'
                              : 'background, website'}
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        className={`text-muted h-4 w-4 shrink-0 transition-transform ${showAdvancedMedia ? 'rotate-180' : ''}`}
                      />
                    </button>
                  )}
                  {showAdvancedMedia && (
                    <>
                      {/* Background and website for every image, and for
                        minimal graphic design an optional diagram type; an
                        edit of the current image keeps its own. */}
                      {!mediaBusyHere && !referenceMediaId && (
                        <div className="border-border bg-surface-hover/50 space-y-2 rounded-xl border p-3">
                          {imageStyle === 'minimal_graphic' && (
                            <>
                              <div className="flex items-baseline justify-between">
                                <span
                                  id="diagram-type-label"
                                  className="text-foreground text-[11px] font-semibold"
                                >
                                  Diagram type
                                </span>
                                <span className="text-muted text-[10px]">
                                  Optional
                                </span>
                              </div>
                              <div
                                role="radiogroup"
                                aria-labelledby="diagram-type-label"
                                className="flex flex-wrap gap-1.5"
                              >
                                {DIAGRAM_TYPE_OPTIONS.map(option => {
                                  const active = diagramType === option.value
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
                                      onClick={() => setDiagramType(option.value)}
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
                                    ? 'Generate image follows your description below. The diagram type is used by "Design from the post text".'
                                    : DIAGRAM_TYPE_OPTIONS.find(
                                        o => o.value === diagramType
                                      )?.description}
                              </p>
                            </>
                          )}

                          <div
                            className={
                              imageStyle === 'minimal_graphic'
                                ? 'border-border space-y-2 border-t pt-2'
                                : 'space-y-2'
                            }
                          >
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
                                className="flex flex-wrap justify-end gap-1.5"
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

                      {/* Every generated image gets these; set on the Brand Theme page */}
                      {!mediaBusyHere && (
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          {brand.hasLogo || brand.colors.length > 0 ? (
                            <span className="text-muted inline-flex min-w-0 items-center gap-1.5">
                              {brand.colors.map((color, i) => (
                                <span
                                  key={`${i}-${color}`}
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
                    </>
                  )}
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The text a reviewer edits on a post. */
interface PostDraft {
  hook: string
  body: string
  firstComment: string
  /** A video's caption and (YouTube) title; absent for other formats. */
  caption?: string
  title?: string
}

/** What the page reads and sets in the editor's buffer from outside it. */
interface PostTextEditorHandle {
  draft: PostDraft
  setHook: Dispatch<SetStateAction<string>>
}

/**
 * The hook, body and first comment textareas, with the edit buffer they type
 * into. The buffer is kept here so a keystroke re-renders this, not the page.
 *
 * Keyed by post, so opening another post starts a fresh buffer. It stays
 * mounted while closed: closing it to look at the preview keeps the edits,
 * and they still count as unsaved.
 */
function PostTextEditor({
  ref,
  post,
  open,
  saving,
  onDirtyChange,
  onSave,
  onClose
}: {
  ref: Ref<PostTextEditorHandle>
  post: PostDetail
  open: boolean
  saving: boolean
  /** Called when the buffer starts or stops differing from the saved post. */
  onDirtyChange: (dirty: boolean) => void
  onSave: (draft: PostDraft) => void
  onClose: () => void
}) {
  const savedHook = post.hook || ''
  const savedBody = post.body || ''
  const savedComment = post.firstComment || ''
  const formatId = formatOf(post.formatId)
  const spec = FORMATS[formatId]
  const isVideo = spec.structure === 'script'
  const hasTitle = isVideo && spec.platform === 'youtube'
  const savedCaption =
    typeof post.payload?.caption === 'string' ? post.payload.caption : ''
  const savedTitle =
    typeof post.payload?.title === 'string' ? post.payload.title : ''
  const [hook, setHook] = useState(savedHook)
  const [body, setBody] = useState(savedBody)
  const [firstComment, setFirstComment] = useState(savedComment)
  const [caption, setCaption] = useState(savedCaption)
  const [title, setTitle] = useState(savedTitle)
  const current: PostDraft = {
    hook,
    body,
    firstComment,
    ...(isVideo ? { caption } : {}),
    ...(hasTitle ? { title } : {})
  }

  useImperativeHandle(
    ref,
    () => ({ draft: current, setHook }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hook, body, firstComment, caption, title]
  )

  // The page only re-renders when this flips, not on every keystroke. Also
  // flips without typing: a save or hook swap changes the saved post.
  const dirty =
    hook !== savedHook ||
    body !== savedBody ||
    firstComment !== savedComment ||
    (isVideo && caption !== savedCaption) ||
    (hasTitle && title !== savedTitle)
  const labels =
    spec.structure === 'script'
      ? {
          hook: 'Opening line (spoken)',
          body: 'Rest of the script, one shot per paragraph'
        }
      : spec.structure === 'thread'
        ? {
            hook: 'First post',
            body: 'Other posts, separated by a line with ---'
          }
        : { hook: 'Opening Hook', body: 'Body' }
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  const discard = () => {
    setHook(savedHook)
    setBody(savedBody)
    setFirstComment(savedComment)
    setCaption(savedCaption)
    setTitle(savedTitle)
    onClose()
  }

  if (!open) return null

  return (
    <div className="border-border bg-surface space-y-4 rounded-2xl border p-6 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-foreground text-xs font-semibold">
          Edit Draft Copy
        </span>
        <span className="text-muted font-mono text-xs">
          {spec.limits.foldChars
            ? `Hook: ${hook.length} chars (fold ~${spec.limits.foldChars})`
            : `Hook: ${hook.length} chars`}
        </span>
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs font-medium">
          {labels.hook}
        </label>
        <textarea
          value={hook}
          onChange={e => setHook(e.target.value)}
          rows={3}
          className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 text-xs outline-none"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs font-medium">
          {labels.body}
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={8}
          className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 font-mono text-xs outline-none"
        />
      </div>
      <div>
        <label className="text-muted mb-1 block text-xs font-medium">
          {spec.commentLabel}
        </label>
        <textarea
          value={firstComment}
          onChange={e => setFirstComment(e.target.value)}
          rows={2}
          className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 text-xs outline-none"
        />
      </div>
      {hasTitle && (
        <div>
          <label className="text-muted mb-1 block text-xs font-medium">
            Title ({title.length}/100)
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 text-xs outline-none"
          />
        </div>
      )}
      {isVideo && (
        <div>
          <label className="text-muted mb-1 block text-xs font-medium">
            Caption posted with the video
          </label>
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={3}
            className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-3 text-xs outline-none"
          />
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={discard}
          className="text-muted hover:text-foreground h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(current)}
          disabled={saving}
          className="bg-accent text-background hover:bg-accent-hover h-7 cursor-pointer rounded-lg px-2.5 text-xs font-semibold disabled:opacity-50"
        >
          Save Changes
        </button>
      </div>
    </div>
  )
}
