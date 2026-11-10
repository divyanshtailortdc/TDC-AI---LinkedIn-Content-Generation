'use client'

import { buttonClassName } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import {
  RichTextEditor,
  type RichTextEditorHandle
} from '@/components/rich-text-editor'
import { showToast } from '@/components/toast-notification'
import {
  articleToHtmlDocument,
  articleToMarkdown,
  articleToPlainText,
  blocksToHtml,
  countArticleWords,
  escapeHtml,
  readingMinutes,
  type ArticleBlock
} from '@/lib/articles/blocks'
import { elementToArticleBlocks } from '@/lib/articles/dom-blocks'
import {
  isLinkedInArticleUrl,
  LINK_CARD_LIMITS
} from '@/lib/articles/link-post'
import { cn } from '@/lib/cn'
import { formatAbsoluteDateTime } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleCheck,
  Copy,
  Download,
  ExternalLink,
  Eye,
  ImagePlus,
  Info,
  Link2,
  Loader2,
  PencilLine,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Trash,
  Upload,
  WandSparkles,
  X
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  createArticleLinkPost,
  deleteArticle,
  fetchArticleStatus,
  generateArticleCover,
  regenerateArticle,
  removeArticleCover,
  restorePreviousArticleVersion,
  saveArticle,
  setArticleCover,
  setArticlePublished
} from '../actions'
import type { ArticleEditorData } from '../articles-data'

/**
 * Reviewing and editing a long-form article: cover, title, subtitle, the
 * rich-text body and its call to action, with a preview, the quality checks
 * and sources beside it, and the ways it can go out. A native article cannot
 * be published through LinkedIn's API, so it is copied (formatted) into
 * LinkedIn's own editor and marked published here; or the page where it is
 * hosted is shared as an article-link post, which publishes like any post.
 */

const POLL_MS = 4000
/** A generation is given up on after this, should the server never answer. */
const MAX_POLL_MS = 12 * 60 * 1000
const LINKEDIN_NEW_ARTICLE_URL = 'https://www.linkedin.com/article/new/'
const COVER_MAX_BYTES = 5 * 1024 * 1024

type Finding = ArticleEditorData['lintFindings'][number]

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'article'

function download(filename: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Copies formatted HTML where the browser allows it, plain text otherwise. */
async function copyRich(html: string, plain: string) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      })
    ])
  } else {
    await navigator.clipboard.writeText(plain)
  }
}

export function ArticleEditor({
  article,
  authorName,
  authorHeadline
}: {
  article: ArticleEditorData
  authorName: string
  authorHeadline?: string | null
}) {
  const router = useRouter()
  const mounted = useHasMounted()
  const editorRef = useRef<RichTextEditorHandle>(null)

  const [title, setTitle] = useState(article.title)
  const [subtitle, setSubtitle] = useState(article.subtitle)
  const [callToAction, setCallToAction] = useState(article.callToAction ?? '')
  const [coverAlt, setCoverAlt] = useState(article.coverImageAlt ?? '')
  const [coverUrl, setCoverUrl] = useState(article.coverUrl)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const [previewBlocks, setPreviewBlocks] = useState<ArticleBlock[]>(
    article.content
  )
  const [wordCount, setWordCount] = useState(article.wordCount)
  const [lintFindings, setLintFindings] = useState<Finding[]>(
    article.lintFindings
  )
  const [generation, setGeneration] = useState({
    status: article.generationStatus,
    error: article.generationError
  })
  const [published, setPublished] = useState({
    status: article.status,
    url: article.publishedUrl,
    at: article.publishedAt
  })

  const generating = generation.status === 'generating'
  const hasText = article.content.length > 0
  const editable = !generating

  /** The body as it stands in the editor (unsaved edits included). */
  const currentBlocks = useCallback((): ArticleBlock[] => {
    const el = editorRef.current?.element()
    return el ? elementToArticleBlocks(el) : article.content
  }, [article.content])

  const markDirty = useCallback(() => setDirty(true), [])

  // Word count follows the text, a moment after typing stops.
  const countTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onBodyChange = useCallback(() => {
    markDirty()
    if (countTimer.current) clearTimeout(countTimer.current)
    countTimer.current = setTimeout(
      () => setWordCount(countArticleWords(currentBlocks())),
      400
    )
  }, [currentBlocks, markDirty])
  useEffect(
    () => () => {
      if (countTimer.current) clearTimeout(countTimer.current)
    },
    []
  )

  // ------------------------------------------------------------------ save
  const savingRef = useRef(false)
  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || !editable) return false
    const el = editorRef.current?.element()
    if (!el) return false
    savingRef.current = true
    setSaving(true)
    try {
      const res = await saveArticle(article.id, {
        title,
        subtitle,
        html: el.innerHTML,
        callToAction,
        coverImageAlt: coverAlt
      })
      if (!res.success) throw new Error(res.error)
      setDirty(false)
      setLintFindings(res.lintFindings)
      setWordCount(res.wordCount)
      setSavedAt(res.updatedAt)
      return true
    } catch (err: any) {
      showToast({
        title: 'Not saved',
        message: err?.message || 'Try again.',
        type: 'error'
      })
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [article.id, callToAction, coverAlt, editable, subtitle, title])

  // Ctrl/Cmd+S saves; leaving with unsaved edits asks first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // ----------------------------------------------------- follow generation
  useEffect(() => {
    if (!generating) return
    const started = Date.now()
    let stopped = false
    const interval = setInterval(async () => {
      if (Date.now() - started > MAX_POLL_MS) {
        stopped = true
        clearInterval(interval)
        router.refresh()
        return
      }
      const res = await fetchArticleStatus(article.id)
      if (stopped || !res.success || res.generationStatus === 'generating')
        return
      stopped = true
      clearInterval(interval)
      if (res.generationStatus === 'ready') {
        showToast({
          title: 'Article ready',
          message: 'Review and edit it below.',
          type: 'success'
        })
      } else {
        showToast({
          title: 'Article not generated',
          message: res.generationError || 'Try again.',
          type: 'error'
        })
      }
      // The page remounts this editor with the new text.
      router.refresh()
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [article.id, generating, router])

  // ----------------------------------------------------------- regenerate
  const regeneratingRef = useRef(false)
  const regenerate = async (guidance: string) => {
    if (regeneratingRef.current) return
    regeneratingRef.current = true
    try {
      if (dirty && hasText && !(await save())) return
      const res = await regenerateArticle(article.id, guidance)
      if (!res.success) throw new Error(res.error)
      setGeneration({ status: 'generating', error: null })
      setMode('edit')
    } catch (err: any) {
      showToast({
        title: 'Not regenerated',
        message: err?.message || 'Try again.',
        type: 'error'
      })
    } finally {
      regeneratingRef.current = false
    }
  }

  const togglePreview = () => {
    if (mode === 'edit') setPreviewBlocks(currentBlocks())
    setMode(mode === 'edit' ? 'preview' : 'edit')
  }

  const words = wordCount
  const showEditor = hasText || !generating

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        preTitle={
          <Link
            href="/articles"
            aria-label="All articles"
            className="text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 w-8 items-center justify-center rounded-lg"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        title={title.trim() || 'Untitled article'}
        description={
          article.idea
            ? `Article from the idea "${article.idea.title || article.idea.hook}"`
            : 'Article'
        }
        actions={
          showEditor && (
            <>
              <span
                className="text-muted hidden text-xs md:inline"
                aria-live="polite"
              >
                {saving
                  ? 'Saving…'
                  : dirty
                    ? 'Unsaved changes'
                    : savedAt && mounted
                      ? `Saved ${formatAbsoluteDateTime(savedAt)}`
                      : null}
              </span>
              <button
                type="button"
                onClick={togglePreview}
                className={buttonClassName({
                  variant: 'secondary',
                  size: 'sm'
                })}
              >
                {mode === 'edit' ? (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    Preview
                  </>
                ) : (
                  <>
                    <PencilLine className="h-3.5 w-3.5" />
                    Edit
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving || !editable}
                className={buttonClassName({ size: 'sm' })}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save draft
              </button>
            </>
          )
        }
      />

      <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:pb-10">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <main className="min-w-0 space-y-5">
            <GenerationBanner
              status={generation.status}
              error={generation.error}
              firstVersion={!hasText}
              onRetry={() => void regenerate(article.guidance ?? '')}
            />

            {showEditor && (
              <>
                {/* The preview reads the editor, so the editor stays mounted. */}
                <div
                  className={cn('space-y-5', mode === 'preview' && 'hidden')}
                >
                  <CoverSection
                    articleId={article.id}
                    coverUrl={coverUrl}
                    onCoverUrl={setCoverUrl}
                    altText={coverAlt}
                    onAltText={value => {
                      setCoverAlt(value)
                      markDirty()
                    }}
                    suggestion={article.coverSuggestion}
                    disabled={!editable}
                    canGenerate={hasText}
                  />

                  <div className="space-y-2">
                    <label htmlFor="article-title" className="sr-only">
                      Title
                    </label>
                    <AutoGrowTextarea
                      id="article-title"
                      value={title}
                      onChange={value => {
                        setTitle(value.replace(/\n/g, ' '))
                        markDirty()
                      }}
                      disabled={!editable}
                      placeholder="Article title"
                      maxLength={200}
                      className="text-foreground text-3xl leading-tight font-bold tracking-tight sm:text-4xl"
                    />
                    <label htmlFor="article-subtitle" className="sr-only">
                      Subtitle
                    </label>
                    <AutoGrowTextarea
                      id="article-subtitle"
                      value={subtitle}
                      onChange={value => {
                        setSubtitle(value.replace(/\n/g, ' '))
                        markDirty()
                      }}
                      disabled={!editable}
                      placeholder="A sentence or two on what the reader will get"
                      maxLength={400}
                      className="text-muted text-lg leading-snug"
                    />
                  </div>

                  <RichTextEditor
                    ref={editorRef}
                    initialHtml={blocksToHtml(article.content)}
                    onChange={onBodyChange}
                    disabled={!editable}
                  />

                  <div className="border-border bg-surface rounded-2xl border p-4 shadow-xs">
                    <label
                      htmlFor="article-cta"
                      className="text-foreground mb-1.5 block text-xs font-semibold"
                    >
                      Call to action
                      <span className="text-muted ml-1.5 font-normal">
                        Optional closing line, added after the article
                      </span>
                    </label>
                    <textarea
                      id="article-cta"
                      rows={2}
                      value={callToAction}
                      disabled={!editable}
                      onChange={e => {
                        setCallToAction(e.target.value)
                        markDirty()
                      }}
                      className="border-border bg-surface-hover text-foreground focus:border-accent w-full resize-y rounded-lg border p-2.5 text-sm outline-none disabled:opacity-60"
                    />
                  </div>

                  <p className="text-muted text-xs tabular-nums">
                    {words.toLocaleString()} words · about{' '}
                    {readingMinutes(words)} min read
                  </p>
                </div>

                {mode === 'preview' && (
                  <ArticlePreview
                    title={title}
                    subtitle={subtitle}
                    blocks={previewBlocks}
                    callToAction={callToAction}
                    coverUrl={coverUrl}
                    coverAlt={coverAlt}
                    authorName={authorName}
                    authorHeadline={authorHeadline}
                  />
                )}
              </>
            )}
          </main>

          {showEditor && (
            <aside className="min-w-0 space-y-4 xl:sticky xl:top-0 xl:self-start">
              <PublishPanel
                articleId={article.id}
                disabled={!hasText || generating}
                published={published}
                onPublished={setPublished}
                getContent={() => ({
                  title,
                  subtitle,
                  blocks: currentBlocks(),
                  callToAction
                })}
                dirty={dirty}
              />
              <LinkPostPanel
                articleId={article.id}
                title={title}
                subtitle={subtitle}
                hasCover={Boolean(coverUrl)}
                publishedUrl={published.url}
                linkPosts={article.linkPosts}
                disabled={!hasText || generating}
                beforeCreate={async () => (dirty ? save() : true)}
              />
              <ChecksPanel
                findings={lintFindings}
                selfFlags={article.selfFlags}
                dirty={dirty}
              />
              <SourcesPanel sources={article.sources} />
              <VersionsPanel
                articleId={article.id}
                generating={generating}
                hasPrevious={article.hasPreviousVersion}
                previousAt={article.previousVersionAt}
                onRegenerate={regenerate}
                canRegenerate={Boolean(article.ideaId)}
                dirty={dirty}
              />
              <DetailsPanel article={article} />
              <DeletePanel articleId={article.id} disabled={generating} />
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

function AutoGrowTextarea({
  id,
  value,
  onChange,
  disabled,
  placeholder,
  maxLength,
  className
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      id={id}
      rows={1}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={e => onChange(e.target.value)}
      className={cn(
        'placeholder:text-muted/60 w-full resize-none overflow-hidden bg-transparent outline-none disabled:opacity-60',
        className
      )}
    />
  )
}

function GenerationBanner({
  status,
  error,
  firstVersion,
  onRetry
}: {
  status: 'generating' | 'ready' | 'failed'
  error: string | null
  firstVersion: boolean
  onRetry: () => void
}) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (status !== 'generating') return
    const started = Date.now()
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000
    )
    return () => clearInterval(t)
  }, [status])

  if (status === 'generating') {
    return (
      <div
        role="status"
        className={cn(
          'border-accent/20 bg-accent/5 rounded-2xl border',
          firstVersion ? 'p-8 text-center' : 'flex items-center gap-3 p-4'
        )}
      >
        {firstVersion ? (
          <>
            <Sparkles className="text-accent mx-auto h-8 w-8 animate-pulse" />
            <h2 className="text-foreground mt-3 text-base font-semibold">
              Writing your article
            </h2>
            <p className="text-muted mx-auto mt-1 max-w-md text-sm">
              Reading the idea&apos;s evidence and your knowledge base, then
              writing a structured article in your voice and checking it. This
              usually takes one to two minutes; you can leave this page and come
              back.
            </p>
            <ul className="text-muted mx-auto mt-4 max-w-xs space-y-1 text-left text-xs">
              <li>• Gathering your identity, voice, goals and audience</li>
              <li>• Finding relevant passages in your knowledge base</li>
              <li>• Writing the title, sections and closing</li>
              <li>• Checking figures, sources and wording</li>
            </ul>
            <p className="text-muted mt-4 text-xs tabular-nums">{elapsed}s</p>
          </>
        ) : (
          <>
            <Loader2 className="text-accent h-4 w-4 shrink-0 animate-spin" />
            <p className="text-foreground text-sm">
              Writing a new version… Editing is paused until it is ready; your
              current text is kept as the previous version.
              <span className="text-muted ml-2 text-xs tabular-nums">
                {elapsed}s
              </span>
            </p>
          </>
        )}
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {firstVersion
              ? 'The article could not be generated.'
              : 'The new version could not be generated.'}
          </p>
          {error && <p className="mt-0.5 text-xs">{error}</p>}
          {!firstVersion && (
            <p className="mt-0.5 text-xs">Your current text is unchanged.</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Try again
        </button>
      </div>
    )
  }
  return null
}

function CoverSection({
  articleId,
  coverUrl,
  onCoverUrl,
  altText,
  onAltText,
  suggestion,
  disabled,
  canGenerate
}: {
  articleId: string
  coverUrl: string | null
  onCoverUrl: (url: string | null) => void
  altText: string
  onAltText: (value: string) => void
  suggestion: ArticleEditorData['coverSuggestion']
  disabled: boolean
  canGenerate: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<
    null | 'upload' | 'link' | 'generate' | 'remove'
  >(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const busyRef = useRef(false)

  const runCover = async (
    kind: NonNullable<typeof busy>,
    action: () => Promise<
      | { success: true; coverUrl?: string; altText?: string | null }
      | { success: false; error: string }
    >,
    done: string
  ) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(kind)
    try {
      const res = await action()
      if (!res.success) throw new Error(res.error)
      onCoverUrl(res.coverUrl ?? null)
      if (res.altText && !altText) onAltText(res.altText)
      setLinkOpen(false)
      showToast({ title: done, type: 'success' })
    } catch (err: any) {
      showToast({
        title: 'Cover not changed',
        message: err?.message || 'Try again.',
        type: 'error'
      })
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
      showToast({ title: 'Use a PNG, JPEG, WebP or GIF image.', type: 'error' })
      return
    }
    if (file.size > COVER_MAX_BYTES) {
      showToast({ title: 'That image is larger than 5 MB.', type: 'error' })
      return
    }
    const reader = new FileReader()
    reader.onload = () =>
      void runCover(
        'upload',
        () =>
          setArticleCover(articleId, {
            dataUrl: String(reader.result),
            altText
          }),
        'Cover uploaded'
      )
    reader.readAsDataURL(file)
  }

  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => fileRef.current?.click()}
        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
      >
        {busy === 'upload' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        Upload
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null}
        onClick={() => setLinkOpen(v => !v)}
        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
      >
        <Link2 className="h-3.5 w-3.5" />
        Image link
      </button>
      <button
        type="button"
        disabled={disabled || busy !== null || !canGenerate}
        onClick={() =>
          void runCover(
            'generate',
            () => generateArticleCover(articleId),
            'Cover generated'
          )
        }
        title="Designed from the article and the suggested concept, in your brand colours"
        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
      >
        {busy === 'generate' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <WandSparkles className="h-3.5 w-3.5" />
        )}
        {busy === 'generate' ? 'Generating… (up to a minute)' : 'Generate'}
      </button>
      {coverUrl && (
        <button
          type="button"
          disabled={disabled || busy !== null}
          onClick={() =>
            void runCover(
              'remove',
              () => removeArticleCover(articleId),
              'Cover removed'
            )
          }
          className="text-muted inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" />
          Remove
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={e => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )

  return (
    <section aria-label="Cover image" className="space-y-3">
      {coverUrl ? (
        <div className="border-border bg-surface-hover relative aspect-[1.91/1] w-full overflow-hidden rounded-2xl border">
          <Image
            src={coverUrl}
            alt={altText || 'Article cover'}
            fill
            unoptimized
            className="object-cover"
          />
        </div>
      ) : (
        <div className="border-border bg-surface flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center">
          <ImagePlus className="text-muted h-7 w-7" />
          <p className="text-foreground text-sm font-semibold">
            Add a cover image
          </p>
          <p className="text-muted max-w-md text-xs">
            LinkedIn shows it above the article and on its card in the feed. Use
            a wide image (about 1.91:1, at least 1200 px across).
          </p>
        </div>
      )}
      {buttons}
      {linkOpen && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={e => {
            e.preventDefault()
            void runCover(
              'link',
              () => setArticleCover(articleId, { url: link, altText }),
              'Cover set'
            )
          }}
        >
          <input
            type="url"
            value={link}
            autoFocus
            onChange={e => setLink(e.target.value)}
            placeholder="https://example.com/image.jpg"
            aria-label="Image link"
            className="border-border bg-surface text-foreground focus:border-accent h-8 min-w-0 flex-1 rounded-lg border px-2.5 text-sm outline-none"
          />
          <button
            type="submit"
            disabled={busy !== null}
            className={buttonClassName({ size: 'sm' })}
          >
            {busy === 'link' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            Use image
          </button>
        </form>
      )}
      {suggestion?.concept && (
        <p className="text-muted text-xs leading-relaxed">
          <span className="text-foreground font-semibold">
            Suggested cover:{' '}
          </span>
          {suggestion.concept}
        </p>
      )}
      <div>
        <label
          htmlFor="cover-alt"
          className="text-foreground mb-1 block text-xs font-semibold"
        >
          Cover alt text
        </label>
        <input
          id="cover-alt"
          value={altText}
          disabled={disabled}
          onChange={e => onAltText(e.target.value)}
          placeholder="Describe the image for people who cannot see it"
          className="border-border bg-surface text-foreground focus:border-accent h-9 w-full rounded-lg border px-2.5 text-sm outline-none disabled:opacity-60"
        />
      </div>
    </section>
  )
}

function ArticlePreview({
  title,
  subtitle,
  blocks,
  callToAction,
  coverUrl,
  coverAlt,
  authorName,
  authorHeadline
}: {
  title: string
  subtitle: string
  blocks: ArticleBlock[]
  callToAction: string
  coverUrl: string | null
  coverAlt: string
  authorName: string
  authorHeadline?: string | null
}) {
  // The blocks were reduced to safe markup (src/lib/articles/html-blocks.ts).
  const html = blocksToHtml(blocks)
  return (
    <article className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs">
      {coverUrl && (
        <div className="bg-surface-hover relative aspect-[1.91/1] w-full">
          <Image
            src={coverUrl}
            alt={coverAlt || 'Article cover'}
            fill
            unoptimized
            className="object-cover"
          />
        </div>
      )}
      <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8">
        <h1 className="text-foreground text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
          {title.trim() || 'Untitled article'}
        </h1>
        {subtitle.trim() && (
          <p className="text-muted mt-3 text-lg leading-snug">{subtitle}</p>
        )}
        <div className="border-border mt-6 flex items-center gap-3 border-y py-3">
          <span className="bg-platform flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white">
            {authorName.slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="text-foreground block text-sm font-semibold">
              {authorName}
            </span>
            {authorHeadline && (
              <span className="text-muted block truncate text-xs">
                {authorHeadline}
              </span>
            )}
          </span>
        </div>
        <div
          className="article-prose mt-6"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {callToAction.trim() && (
          <p className="article-prose mt-6 font-semibold">{callToAction}</p>
        )}
      </div>
    </article>
  )
}

function Panel({
  title,
  icon,
  children,
  defaultOpen = true
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details
      open={defaultOpen}
      className="border-border bg-surface group rounded-2xl border shadow-xs"
    >
      <summary className="text-foreground flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold">
        {icon}
        <span className="flex-1">{title}</span>
        <ChevronDown className="text-muted h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-border space-y-3 border-t px-4 py-3 text-sm">
        {children}
      </div>
    </details>
  )
}

function PublishPanel({
  articleId,
  disabled,
  published,
  onPublished,
  getContent,
  dirty
}: {
  articleId: string
  disabled: boolean
  published: {
    status: 'draft' | 'published'
    url: string | null
    at: string | null
  }
  onPublished: (value: {
    status: 'draft' | 'published'
    url: string | null
    at: string | null
  }) => void
  getContent: () => {
    title: string
    subtitle: string
    blocks: ArticleBlock[]
    callToAction: string
  }
  dirty: boolean
}) {
  const mounted = useHasMounted()
  const [copied, setCopied] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const copy = async (what: 'title' | 'body' | 'all') => {
    const { title, subtitle, blocks, callToAction } = getContent()
    const cta = callToAction.trim()
    const bodyHtml =
      blocksToHtml(blocks) + (cta ? `\n<p>${escapeHtml(cta)}</p>` : '')
    const bodyText =
      articleToPlainText({ content: blocks }) + (cta ? `\n\n${cta}` : '')
    try {
      if (what === 'title') await navigator.clipboard.writeText(title.trim())
      else if (what === 'body') await copyRich(bodyHtml, bodyText)
      else {
        await copyRich(
          `<h1>${escapeHtml(title)}</h1>${subtitle ? `<p><em>${escapeHtml(subtitle)}</em></p>` : ''}${bodyHtml}`,
          [title, subtitle, bodyText].filter(Boolean).join('\n\n')
        )
      }
      setCopied(what)
      setTimeout(() => setCopied(c => (c === what ? null : c)), 2000)
    } catch {
      showToast({
        title: 'Could not copy',
        message: 'Your browser blocked the clipboard.',
        type: 'error'
      })
    }
  }

  const mark = async (value: boolean) => {
    setBusy(true)
    try {
      const res = await setArticlePublished(articleId, {
        published: value,
        url
      })
      if (!res.success) throw new Error(res.error)
      onPublished({
        status: res.status,
        url: res.publishedUrl,
        at: res.publishedAt
      })
      setUrl('')
      showToast({
        title: value ? 'Marked as published' : 'Back to draft',
        type: 'success'
      })
    } catch (err: any) {
      showToast({
        title: 'Not updated',
        message: err?.message || 'Try again.',
        type: 'error'
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Publish on LinkedIn"
      icon={<Send className="text-platform-text h-4 w-4" />}
    >
      {published.status === 'published' ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          <p className="flex items-center gap-1.5 font-semibold">
            <CircleCheck className="h-3.5 w-3.5" />
            Published
            {published.at && mounted
              ? ` ${formatAbsoluteDateTime(published.at)}`
              : ''}
          </p>
          {published.url && (
            <a
              href={published.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 underline"
            >
              Open on LinkedIn <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void mark(false)}
            className="mt-2 block text-xs font-medium underline"
          >
            Mark as draft again
          </button>
        </div>
      ) : (
        <p className="text-muted flex gap-1.5 text-xs leading-relaxed">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          LinkedIn&apos;s API cannot publish native articles, so this one is
          published in LinkedIn&apos;s own article editor. Copy each part in,
          then mark it published here.
        </p>
      )}
      {dirty && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          You have unsaved edits. Copy uses the text as it is on screen.
        </p>
      )}
      <ol className="space-y-2.5">
        <Step n={1} label="Open LinkedIn's article editor">
          <a
            href={LINKEDIN_NEW_ARTICLE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName({
              variant: 'platform',
              size: 'sm',
              className: 'w-full justify-start'
            })}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Write article on LinkedIn
          </a>
        </Step>
        <Step n={2} label="Upload the cover, then paste the title">
          <CopyButton
            label="Copy title"
            copied={copied === 'title'}
            disabled={disabled}
            onCopy={() => void copy('title')}
          />
        </Step>
        <Step
          n={3}
          label="Paste the body (headings, lists and links keep their formatting)"
        >
          <CopyButton
            label="Copy formatted body"
            copied={copied === 'body'}
            disabled={disabled}
            onCopy={() => void copy('body')}
          />
        </Step>
        {published.status !== 'published' && (
          <Step n={4} label="Publish it on LinkedIn, then record it here">
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Article link (optional)"
              aria-label="Published article link"
              className="border-border bg-surface-hover text-foreground focus:border-accent h-8 w-full rounded-lg border px-2.5 text-xs outline-none"
            />
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void mark(true)}
              className={buttonClassName({
                size: 'sm',
                className: 'mt-2 w-full'
              })}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CircleCheck className="h-3.5 w-3.5" />
              )}
              Mark as published
            </button>
          </Step>
        )}
      </ol>
      <div className="border-border border-t pt-3">
        <p className="text-muted mb-2 text-xs font-semibold">Export</p>
        <div className="grid grid-cols-2 gap-2">
          <CopyButton
            label="Copy all"
            copied={copied === 'all'}
            disabled={disabled}
            onCopy={() => void copy('all')}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const c = getContent()
              download(
                `${slug(c.title)}.md`,
                'text/markdown',
                articleToMarkdown({
                  title: c.title,
                  subtitle: c.subtitle,
                  content: withCta(c.blocks, c.callToAction)
                })
              )
            }}
            className={buttonClassName({
              variant: 'secondary',
              size: 'sm',
              className: 'justify-start'
            })}
          >
            <Download className="h-3.5 w-3.5" />
            Markdown
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const c = getContent()
              download(
                `${slug(c.title)}.html`,
                'text/html',
                articleToHtmlDocument({
                  title: c.title,
                  subtitle: c.subtitle,
                  content: withCta(c.blocks, c.callToAction)
                })
              )
            }}
            className={buttonClassName({
              variant: 'secondary',
              size: 'sm',
              className: 'justify-start'
            })}
          >
            <Download className="h-3.5 w-3.5" />
            HTML
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const c = getContent()
              download(
                `${slug(c.title)}.txt`,
                'text/plain',
                articleToPlainText({
                  title: c.title,
                  subtitle: c.subtitle,
                  content: withCta(c.blocks, c.callToAction)
                })
              )
            }}
            className={buttonClassName({
              variant: 'secondary',
              size: 'sm',
              className: 'justify-start'
            })}
          >
            <Download className="h-3.5 w-3.5" />
            Text
          </button>
        </div>
      </div>
    </Panel>
  )
}

function CopyButton({
  label,
  copied,
  disabled,
  onCopy
}: {
  label: string
  copied: boolean
  disabled: boolean
  onCopy: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onCopy}
      className={buttonClassName({
        variant: 'secondary',
        size: 'sm',
        className: 'w-full justify-start'
      })}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied' : label}
    </button>
  )
}

/** The call to action as the article's last paragraph, for exports. */
const withCta = (blocks: ArticleBlock[], cta: string): ArticleBlock[] =>
  cta.trim()
    ? [...blocks, { type: 'paragraph', text: escapeHtml(cta.trim()) }]
    : blocks

function Step({
  n,
  label,
  children
}: {
  n: number
  label: string
  children: ReactNode
}) {
  return (
    <li className="flex gap-2.5">
      <span className="bg-surface-hover text-foreground mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-muted text-xs">{label}</p>
        {children}
      </div>
    </li>
  )
}

function LinkPostPanel({
  articleId,
  title,
  subtitle,
  hasCover,
  publishedUrl,
  linkPosts,
  disabled,
  beforeCreate
}: {
  articleId: string
  title: string
  subtitle: string
  hasCover: boolean
  publishedUrl: string | null
  linkPosts: ArticleEditorData['linkPosts']
  disabled: boolean
  beforeCreate: () => Promise<boolean>
}) {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const nativeLink = url.trim() !== '' && isLinkedInArticleUrl(url.trim())

  const create = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      if (!(await beforeCreate())) return
      const res = await createArticleLinkPost(articleId, { url })
      if (!res.success) throw new Error(res.error)
      showToast({
        title: 'Link post created',
        message: 'Review and approve it in Posts, then publish it from there.',
        type: 'success'
      })
      router.push('/posts')
    } catch (err: any) {
      showToast({
        title: 'Link post not created',
        message: err?.message || 'Try again.',
        type: 'error'
      })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Share as a link post"
      icon={<Link2 className="text-muted h-4 w-4" />}
      defaultOpen={false}
    >
      <p className="text-muted text-xs leading-relaxed">
        Hosting the article on your website? Share its page as a LinkedIn post
        with a link card. It goes to Posts for review and publishes like any
        post.
      </p>
      <div className="border-border bg-surface-hover/60 rounded-lg border p-2.5 text-xs">
        <p className="text-muted mb-1 font-semibold">
          The card LinkedIn will show
        </p>
        <p className="text-foreground line-clamp-2 font-semibold">
          {title.trim().slice(0, LINK_CARD_LIMITS.title) || 'Untitled article'}
        </p>
        {subtitle.trim() && (
          <p className="text-muted mt-0.5 line-clamp-2">
            {subtitle.trim().slice(0, LINK_CARD_LIMITS.description)}
          </p>
        )}
        <p className="text-muted mt-1">
          {hasCover
            ? 'Thumbnail: the cover image'
            : 'No thumbnail (add a cover)'}
        </p>
      </div>
      <input
        type="url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="https://yoursite.com/blog/article"
        aria-label="Where the article is published"
        className="border-border bg-surface-hover text-foreground focus:border-accent h-8 w-full rounded-lg border px-2.5 text-xs outline-none"
      />
      {publishedUrl && !url && (
        <button
          type="button"
          onClick={() => setUrl(publishedUrl)}
          className="text-accent text-xs hover:underline"
        >
          Use the published link
        </button>
      )}
      {nativeLink && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This is a LinkedIn article. LinkedIn&apos;s own Share button on the
          article does the same; a link post works too.
        </p>
      )}
      <button
        type="button"
        disabled={disabled || busy || !url.trim()}
        onClick={() => void create()}
        className={buttonClassName({ size: 'sm', className: 'w-full' })}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
        Create link post
      </button>
      {linkPosts.length > 0 && (
        <div className="border-border border-t pt-2">
          <p className="text-muted mb-1 text-xs font-semibold">
            Link posts from this article
          </p>
          <ul className="space-y-1 text-xs">
            {linkPosts.map(p => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-foreground min-w-0 truncate">
                  {p.linkUrl}
                </span>
                <Link
                  href="/posts"
                  className="text-accent shrink-0 hover:underline"
                >
                  {p.postedAt
                    ? 'Posted'
                    : p.status === 'approved'
                      ? 'Approved'
                      : 'In review'}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

function ChecksPanel({
  findings,
  selfFlags,
  dirty
}: {
  findings: Finding[]
  selfFlags: string[]
  dirty: boolean
}) {
  const failed = findings
    .filter(f => !f.passed)
    .sort(
      (a, b) =>
        (a.severity === 'error' ? -1 : 0) - (b.severity === 'error' ? -1 : 0)
    )
  const passed = findings.filter(f => f.passed)
  return (
    <Panel
      title={
        failed.length > 0
          ? `Quality checks (${failed.length} to review)`
          : 'Quality checks'
      }
      icon={
        failed.length > 0 ? (
          <AlertTriangle className="h-4 w-4 text-amber-600" />
        ) : (
          <CircleCheck className="h-4 w-4 text-emerald-600" />
        )
      }
    >
      {dirty && (
        <p className="text-muted text-xs">Checks run again when you save.</p>
      )}
      {failed.length === 0 && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Every check passes.
        </p>
      )}
      <ul className="space-y-1.5">
        {failed.map((f, i) => (
          <li
            key={`${f.rule}-${i}`}
            className={cn(
              'rounded-lg px-2.5 py-2 text-xs leading-relaxed',
              f.severity === 'error'
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
            )}
          >
            {f.message}
          </li>
        ))}
      </ul>
      {passed.length > 0 && (
        <details className="text-xs">
          <summary className="text-muted cursor-pointer">
            {passed.length} passed
          </summary>
          <ul className="text-muted mt-1 space-y-1 pl-1">
            {passed.map((f, i) => (
              <li key={`${f.rule}-ok-${i}`} className="flex gap-1.5">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                {f.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      {selfFlags.length > 0 && (
        <div>
          <p className="text-muted mb-1 text-xs font-semibold">
            The writer&apos;s notes to check
          </p>
          <ul className="text-foreground/80 list-disc space-y-0.5 pl-4 text-xs">
            {selfFlags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

function SourcesPanel({ sources }: { sources: ArticleEditorData['sources'] }) {
  const used = sources.filter(s => s.used)
  const rest = sources.filter(s => !s.used)
  const item = (s: (typeof sources)[number], i: number) => (
    <li
      key={i}
      className="bg-surface-hover rounded-lg px-2.5 py-2 text-xs leading-relaxed"
    >
      <span className="text-muted mb-0.5 block text-[10px] font-semibold tracking-wide uppercase">
        {s.kind === 'knowledge' ? 'Your knowledge base' : 'Idea evidence'}
      </span>
      {s.url && /^https?:\/\//i.test(s.url) ? (
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent inline-flex items-center gap-1 font-medium hover:underline"
        >
          {s.title}
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-foreground font-medium">{s.title}</span>
      )}
      {s.claim && <p className="text-muted mt-0.5 line-clamp-3">{s.claim}</p>}
    </li>
  )
  return (
    <Panel title={`Sources (${used.length})`} defaultOpen={false}>
      {sources.length === 0 ? (
        <p className="text-muted text-xs">
          No evidence or knowledge was available, so the article states no
          outside figures.
        </p>
      ) : (
        <>
          {used.length > 0 ? (
            <ul className="space-y-1.5">{used.map(item)}</ul>
          ) : (
            <p className="text-muted text-xs">
              The writer did not name the sources it relied on.
            </p>
          )}
          {rest.length > 0 && (
            <details className="text-xs">
              <summary className="text-muted cursor-pointer">
                Also given to the writer ({rest.length})
              </summary>
              <ul className="mt-1.5 space-y-1.5">{rest.map(item)}</ul>
            </details>
          )}
        </>
      )}
    </Panel>
  )
}

function VersionsPanel({
  articleId,
  generating,
  hasPrevious,
  previousAt,
  onRegenerate,
  canRegenerate,
  dirty
}: {
  articleId: string
  generating: boolean
  hasPrevious: boolean
  previousAt: string | null
  onRegenerate: (guidance: string) => Promise<void>
  canRegenerate: boolean
  dirty: boolean
}) {
  const router = useRouter()
  const mounted = useHasMounted()
  const [open, setOpen] = useState(false)
  const [guidance, setGuidance] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)

  const restore = async () => {
    setBusy(true)
    try {
      const res = await restorePreviousArticleVersion(articleId)
      if (!res.success) throw new Error(res.error)
      showToast({ title: 'Earlier version restored', type: 'success' })
      setConfirmRestore(false)
      router.refresh()
    } catch (err: any) {
      showToast({
        title: 'Not restored',
        message: err?.message || 'Try again.',
        type: 'error'
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Versions"
      icon={<RotateCcw className="text-muted h-4 w-4" />}
      defaultOpen={false}
    >
      {!open ? (
        <button
          type="button"
          disabled={generating || !canRegenerate}
          onClick={() => setOpen(true)}
          className={buttonClassName({
            variant: 'secondary',
            size: 'sm',
            className: 'w-full'
          })}
          title={
            canRegenerate
              ? undefined
              : 'The idea this article came from no longer exists'
          }
        >
          <Sparkles className="h-3.5 w-3.5" />
          Regenerate article
        </button>
      ) : (
        <form
          className="space-y-2"
          onSubmit={async e => {
            e.preventDefault()
            setBusy(true)
            await onRegenerate(guidance)
            setBusy(false)
            setOpen(false)
            setGuidance('')
          }}
        >
          <label
            htmlFor="regen-guidance"
            className="text-foreground block text-xs font-semibold"
          >
            What should change?{' '}
            <span className="text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="regen-guidance"
            rows={3}
            value={guidance}
            maxLength={1500}
            onChange={e => setGuidance(e.target.value)}
            placeholder="e.g. Shorter, more concrete examples for retail teams, a less formal tone"
            className="border-border bg-surface-hover text-foreground focus:border-accent w-full resize-y rounded-lg border p-2 text-xs outline-none"
          />
          <p className="text-muted text-xs">
            A new version replaces the text in the editor
            {dirty ? ' (your edits are saved first)' : ''}. The current text is
            kept as the previous version.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className={buttonClassName({ size: 'sm', className: 'flex-1' })}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Regenerate
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {hasPrevious && (
        <button
          type="button"
          disabled={generating || busy}
          onClick={() => setConfirmRestore(true)}
          className="text-accent text-xs font-medium hover:underline disabled:opacity-60"
        >
          Restore the previous version
          {previousAt && mounted
            ? ` (replaced ${formatAbsoluteDateTime(previousAt)})`
            : ''}
        </button>
      )}
      {confirmRestore && (
        <ConfirmDialog
          title="Restore the previous version?"
          description="The title, subtitle, body and call to action go back to the version the last regeneration replaced. The current text becomes the previous version, so you can switch back. Unsaved edits are lost."
          confirmLabel="Restore"
          pendingLabel="Restoring…"
          pending={busy}
          onCancel={() => setConfirmRestore(false)}
          onConfirm={() => void restore()}
        />
      )}
    </Panel>
  )
}

function DetailsPanel({ article }: { article: ArticleEditorData }) {
  const mounted = useHasMounted()
  const cost = article.costUsd
  return (
    <Panel title="Details" defaultOpen={false}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted">Idea</dt>
        <dd className="text-foreground min-w-0 truncate">
          {article.idea ? (
            <Link href="/ideas" className="hover:underline">
              {article.idea.title || article.idea.hook}
            </Link>
          ) : (
            'Deleted'
          )}
        </dd>
        <dt className="text-muted">Generated</dt>
        <dd className="text-foreground">
          {article.generatedAt && mounted
            ? formatAbsoluteDateTime(article.generatedAt)
            : '—'}
          {article.generationCount > 1
            ? ` (version ${article.generationCount})`
            : ''}
        </dd>
        {article.model && (
          <>
            <dt className="text-muted">Model</dt>
            <dd className="text-foreground min-w-0 truncate">
              {article.model}
            </dd>
          </>
        )}
        <dt className="text-muted">AI cost</dt>
        <dd className="text-foreground tabular-nums">
          {cost > 0
            ? `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`
            : '—'}
        </dd>
      </dl>
    </Panel>
  )
}

function DeletePanel({
  articleId,
  disabled
}: {
  articleId: string
  disabled: boolean
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className="text-muted inline-flex items-center gap-1.5 px-1 text-xs font-medium hover:text-rose-600 disabled:opacity-60"
      >
        <Trash className="h-3.5 w-3.5" />
        Delete article
      </button>
      {confirming && (
        <ConfirmDialog
          title="Delete this article?"
          description="The article and its cover are deleted from TDC AI for good. Anything already published on LinkedIn stays there, and link posts made from it stay in Posts. You can generate a new article from the idea later."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          pending={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setBusy(true)
            const res = await deleteArticle(articleId)
            setBusy(false)
            if (!res.success) {
              showToast({
                title: 'Not deleted',
                message: res.error,
                type: 'error'
              })
              return
            }
            setConfirming(false)
            showToast({ title: 'Article deleted', type: 'success' })
            router.push('/articles')
          }}
        />
      )}
    </>
  )
}
