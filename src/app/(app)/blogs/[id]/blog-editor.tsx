'use client'

import { Button } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { markDataChanged } from '@/components/refresh-on-back'
import { showToast } from '@/components/toast-notification'
import { TextField } from '@/components/ui/field'
import { TruncatedText } from '@/components/ui/tooltip'
import { downloadUrl } from '@/lib/blogs/browser-export'
import { blogWordCount, docSignature, type BlogDoc } from '@/lib/blogs/doc'
import type { BlogEdit } from '@/lib/blogs/input'
import { figureFiles, type BlogPageMeta } from '@/lib/blogs/render'
import { runSeoChecks } from '@/lib/blogs/seo'
import {
  BLOG_KIND_LABELS,
  BLOG_LIMITS,
  BLOG_STYLE_LABELS,
  type BlogContent,
  type FaqItem,
  type InternalLink
} from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { useUnsavedChangesGuard } from '@/lib/hooks/use-unsaved-changes-guard'
import type { Editor } from '@tiptap/react'
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  Eye,
  Globe,
  Link2,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Undo2
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  checkBlogSources,
  deleteBlog,
  featuredImageData,
  regenerateBlog,
  sectionImagesData,
  remakeFeaturedImage,
  remakeSectionImage,
  removeFeaturedImage,
  restoreBlogVersion,
  rewriteBlogSection,
  saveBlog,
  setBlogPublished,
  setBlogSharing
} from '../actions'
import { BlogStatusChip } from '../blog-status'
import type { BlogEditorBlog, BlogLabels } from '../blogs-data'
import { BlogPreview } from './blog-preview'
import { BlogProgress } from './blog-progress'
import { BriefPanel } from './brief-panel'
import { DiagramColorContext } from './diagram-view'
import { BlogImagesContext, type BlogImagesContextValue } from './image-view'
import { DocEditor } from './doc-editor'
import { ExportMenu } from './export-menu'
import { FaqEditor } from './faq-editor'
import { FeaturedImageCard } from './featured-image-card'
import { LinksPanel } from './links-panel'
import { Menu } from './menu'
import { OutlinePanel } from './outline-panel'
import { PublishDialog, type PublishDetails } from './publish-dialog'
import { RegenerateDialog } from './regenerate-dialog'
import { SeoPanel } from './seo-panel'
import { ShareDialog } from './share-dialog'
import { SourcesPanel } from './sources-panel'
import { VersionsPanel } from './versions-panel'

/** The text the user can change, as the editor holds it. */
export const editOf = (blog: BlogEditorBlog): BlogEdit => ({
  title: blog.title,
  slug: blog.slug,
  metaTitle: blog.metaTitle,
  metaDescription: blog.metaDescription,
  primaryKeyword: blog.primaryKeyword,
  keywords: blog.keywords,
  searchIntent: blog.searchIntent,
  content: blog.content,
  faq: blog.faq,
  featuredAlt: blog.featuredImage?.alt ?? '',
  featuredCaption:
    blog.featuredImage?.status === 'ready' ? blog.featuredImage.caption : ''
})

/** Two edits with the same signature say the same thing. */
const signatureOf = (edit: BlogEdit) =>
  JSON.stringify([
    edit.title,
    edit.slug,
    edit.metaTitle,
    edit.metaDescription,
    edit.primaryKeyword,
    edit.keywords,
    edit.searchIntent,
    edit.faq,
    edit.featuredAlt,
    edit.featuredCaption
  ]) + docSignature(edit.content)

type Tab = 'seo' | 'outline' | 'sources' | 'links' | 'versions' | 'brief'
const TABS: Array<[Tab, string]> = [
  ['seo', 'SEO'],
  ['outline', 'Outline'],
  ['sources', 'Sources'],
  ['links', 'Links'],
  ['versions', 'Versions'],
  ['brief', 'Brief']
]

/** Words a reader gets through in a minute, for the reading time. */
const READING_WPM = 230

/**
 * A written blog or article: the document (title, body, FAQ) beside its SEO,
 * outline, sources, versions and brief, with saving, regenerating, rewriting
 * a section, restoring a version, marking it published and deleting it.
 */
export function BlogEditor({
  initial,
  labels
}: {
  initial: BlogEditorBlog
  labels: BlogLabels
}) {
  const router = useRouter()
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState<BlogEdit>(() => editOf(initial))
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const [tab, setTab] = useState<Tab>('seo')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [rewriting, setRewriting] = useState<number | null>(null)
  const [dialog, setDialog] = useState<
    'regenerate' | 'publish' | 'share' | 'delete' | null
  >(null)
  const [deleting, setDeleting] = useState(false)
  const [makingImage, setMakingImage] = useState(false)
  const [remakingPicture, setRemakingPicture] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [failureSeen, setFailureSeen] = useState(false)
  const [preview, setPreview] = useState(false)
  // Whether the running regeneration reuses the sources it found before.
  const [sourcesReused, setSourcesReused] = useState(false)
  const editorRef = useRef<Editor | null>(null)
  const onEditor = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])
  const titleId = useId()
  const tabsId = useId()

  const regenerating = saved.generationStatus === 'generating' && !saved.stale
  const dirty = useMemo(
    () => signatureOf(draft) !== signatureOf(editOf(saved)),
    [draft, saved]
  )
  const busy =
    saving ||
    rewriting !== null ||
    regenerating ||
    makingImage ||
    remakingPicture !== null ||
    checking
  const editable =
    !regenerating && rewriting === null && !makingImage && remakingPicture === null
  const researchUsed = saved.sources.some(source => source.origin === 'web')
  const imageReady = saved.featuredImage?.status === 'ready'
  const liveChecks = useMemo(
    () =>
      runSeoChecks({
        ...draft,
        length: saved.brief.length,
        faqWanted: saved.brief.faq,
        researchUsed,
        searchIntent: draft.searchIntent,
        featuredImage: imageReady ? { alt: draft.featuredAlt } : null,
        ...(labels.site && { internalLinkHosts: [labels.site] })
      }),
    [draft, saved.brief, researchUsed, imageReady, labels.site]
  )
  const words = useMemo(
    () => blogWordCount(draft.content, draft.faq),
    [draft.content, draft.faq]
  )

  const patch = useCallback(
    (change: Partial<BlogEdit>) =>
      setDraft(current => ({ ...current, ...change })),
    []
  )
  const onDocChange = useCallback(
    (content: BlogDoc) => patch({ content }),
    [patch]
  )
  const onFaqChange = useCallback((faq: FaqItem[]) => patch({ faq }), [patch])

  /** A server copy of the blog replaces both the saved state and the draft. */
  const applyServer = useCallback((blog: BlogEditorBlog) => {
    setSaved(blog)
    setDraft(editOf(blog))
  }, [])

  const save = useCallback(async (): Promise<BlogEditorBlog | null> => {
    const sent = draftRef.current
    const sentSignature = signatureOf(sent)
    setSaving(true)
    const result = await saveBlog(saved.id, {
      lockVersion: saved.lockVersion,
      ...sent
    })
    setSaving(false)
    if (!result.success) {
      if ('conflict' in result && result.conflict) setConflict(true)
      showToast({ type: 'error', title: 'Not saved', message: result.error })
      return null
    }
    markDataChanged()
    setSaved(result.blog)
    // The server's tidy copy (slug, spacing) replaces the draft, unless the
    // user typed on while it was saving.
    if (signatureOf(draftRef.current) === sentSignature)
      setDraft(editOf(result.blog))
    return result.blog
  }, [saved.id, saved.lockVersion])

  const canSave = dirty && !busy && !conflict
  const onSave = useCallback(async () => {
    const blog = await save()
    if (blog) showToast({ type: 'success', title: 'Saved' })
  }, [save])

  // Ctrl/Cmd+S saves.
  const shortcut = useRef({ canSave, onSave })
  useEffect(() => {
    shortcut.current = { canSave, onSave }
  }, [canSave, onSave])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (shortcut.current.canSave) void shortcut.current.onSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Leaving the page with unsaved changes asks first: closing the tab, and
  // following any link to another page of the app.
  useUnsavedChangesGuard(
    dirty,
    'You have unsaved changes to this blog. Leave this page and discard them?'
  )

  const startedGenerating = () =>
    setSaved(current => ({
      ...current,
      generationStatus: 'generating',
      generationStage: null,
      generationError: null,
      stale: false,
      generationStartedAt: new Date().toISOString()
    }))

  const regenerate = async (choice: {
    instruction: string
    researchAgain: boolean
    newImage: boolean
    saveFirst: boolean
  }) => {
    if (dirty && choice.saveFirst && !(await save())) return false
    const result = await regenerateBlog(saved.id, {
      instruction: choice.instruction,
      researchAgain: choice.researchAgain,
      newImage: choice.newImage
    })
    if (!result.success) {
      showToast({
        type: 'error',
        title: 'Could not regenerate',
        message: result.error
      })
      return false
    }
    markDataChanged()
    setFailureSeen(false)
    setSourcesReused(!choice.researchAgain && saved.sources.length > 0)
    startedGenerating()
    return true
  }

  const rewrite = async (section: number, instruction: string | null) => {
    let base = saved
    if (dirty) {
      const blog = await save()
      if (!blog) return false
      base = blog
    }
    setRewriting(section)
    const result = await rewriteBlogSection(saved.id, {
      sectionIndex: section,
      instruction,
      lockVersion: base.lockVersion
    })
    setRewriting(null)
    if (!result.success) {
      if ('conflict' in result && result.conflict) setConflict(true)
      showToast({
        type: 'error',
        title: 'Section not rewritten',
        message: result.error
      })
      return false
    }
    markDataChanged()
    applyServer(result.blog)
    showToast({
      type: 'success',
      title: 'Section rewritten',
      message: 'The text it replaced is under Versions.'
    })
    return true
  }

  /** Unsaved changes are saved before an action that writes the blog. */
  const savedFirst = async () => !dirty || Boolean(await save())

  const makeImage = async (direction: string) => {
    if (!(await savedFirst())) return
    setMakingImage(true)
    const result = await remakeFeaturedImage(saved.id, { direction })
    setMakingImage(false)
    if (!result.success) {
      showToast({ type: 'error', title: 'No new image', message: result.error })
      return
    }
    markDataChanged()
    applyServer(result.blog)
    showToast({
      type: 'success',
      title: 'New featured image',
      message: 'Check its alt text. The one it replaced is under Versions.'
    })
  }

  const remakePicture = async (imageId: string, direction: string) => {
    if (!(await savedFirst())) return
    setRemakingPicture(imageId)
    const result = await remakeSectionImage(saved.id, { imageId, direction })
    setRemakingPicture(null)
    if (!result.success) {
      showToast({ type: 'error', title: 'No new picture', message: result.error })
      return
    }
    markDataChanged()
    applyServer(result.blog)
    showToast({
      type: 'success',
      title: 'New picture',
      message: 'Check its alt text and caption. The one it replaced is under Versions.'
    })
  }
  const remakeRef = useRef(remakePicture)
  useEffect(() => {
    remakeRef.current = remakePicture
  })
  const imagesContext = useMemo<BlogImagesContextValue>(
    () => ({
      images: saved.images,
      remake: (imageId, direction) => remakeRef.current(imageId, direction),
      remaking: remakingPicture
    }),
    [saved.images, remakingPicture]
  )

  const removeImage = async () => {
    if (!(await savedFirst())) return
    const result = await removeFeaturedImage(saved.id)
    if (!result.success) {
      showToast({ type: 'error', title: 'Not removed', message: result.error })
      return
    }
    markDataChanged()
    applyServer(result.blog)
  }

  const imageData = async () => {
    const result = await featuredImageData(saved.id)
    return result.success ? result.dataUrl : null
  }

  const pictureData = async () => {
    const result = await sectionImagesData(saved.id)
    return result.success ? result.images : {}
  }

  const downloadImage = async () => {
    const dataUrl = await imageData()
    const file = figureFiles(current).find(f => f.kind === 'featured')
    if (dataUrl && file) downloadUrl(file.name, dataUrl)
    else showToast({ type: 'error', title: 'Could not download the image' })
  }

  const checkSources = async () => {
    let base = saved
    if (dirty) {
      const blog = await save()
      if (!blog) return
      base = blog
    }
    setChecking(true)
    const result = await checkBlogSources(saved.id, { lockVersion: base.lockVersion })
    setChecking(false)
    if (!result.success) {
      if ('conflict' in result && result.conflict) setConflict(true)
      showToast({ type: 'error', title: 'Sources not checked', message: result.error })
      return
    }
    // Checking changes no text: the draft stays as it is.
    setSaved(result.blog)
    showToast({ type: 'success', title: 'Sources checked' })
  }

  /** Links the selected words to the page, or adds its suggested words at the cursor. */
  const insertLink = (link: InternalLink) => {
    const editor = editorRef.current
    if (!editor) return
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: 'text',
            text: link.anchor,
            marks: [{ type: 'link', attrs: { href: link.url } }]
          },
          { type: 'text', text: ' ' }
        ])
        .run()
    } else {
      editor.chain().focus().setLink({ href: link.url }).run()
    }
  }

  const restore = async (revisionId: string) => {
    const result = await restoreBlogVersion(saved.id, revisionId)
    if (!result.success) {
      showToast({ type: 'error', title: 'Not restored', message: result.error })
      return false
    }
    markDataChanged()
    applyServer(result.blog)
    setConflict(false)
    showToast({ type: 'success', title: 'Version restored' })
    return true
  }

  // Where and when it went out (null: back to a draft).
  const markPublished = async (details: PublishDetails | null) => {
    const wasPublished = saved.status === 'published'
    const result = await setBlogPublished(
      saved.id,
      details ? { published: true, ...details } : { published: false, url: null }
    )
    if (!result.success) {
      showToast({ type: 'error', title: 'Not changed', message: result.error })
      return false
    }
    markDataChanged()
    // Publishing changes no text: the draft and lock version stay as they are.
    setSaved(current => ({
      ...current,
      status: result.blog.status,
      publishedUrl: result.blog.publishedUrl,
      publishedAt: result.blog.publishedAt,
      publishedTo: result.blog.publishedTo
    }))
    showToast({
      type: 'success',
      title: !details
        ? 'Marked as a draft'
        : wasPublished
          ? 'Publishing details saved'
          : 'Marked as published'
    })
    return true
  }

  const share = async (shared: boolean) => {
    const result = await setBlogSharing(saved.id, shared)
    if (!result.success) {
      showToast({ type: 'error', title: 'Not changed', message: result.error })
      return false
    }
    // Sharing changes no text: the draft and lock version stay as they are.
    setSaved(current => ({ ...current, shareToken: result.shareToken }))
    if (!shared) showToast({ type: 'success', title: 'Stopped sharing' })
    return true
  }

  const remove = async () => {
    setDeleting(true)
    const result = await deleteBlog(saved.id)
    if (!result.success) {
      setDeleting(false)
      showToast({ type: 'error', title: 'Not deleted', message: result.error })
      return
    }
    markDataChanged()
    router.push('/blogs')
  }

  const jumpTo = (index: number) => {
    try {
      const heading = editorRef.current?.view.dom.querySelectorAll(
        ':scope > h2, :scope > h3'
      )[index]
      heading?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      // The editor is not mounted yet.
    }
  }

  const minutes = Math.max(1, Math.round(words / READING_WPM))
  // What Preview, Copy and Export show: the text on screen, saved or not.
  const image = saved.featuredImage
  const current: BlogContent = {
    kind: saved.kind,
    ...draft,
    sources: saved.sources,
    featuredImage:
      image?.status === 'ready' && saved.featuredImageUrl
        ? {
            src: saved.featuredImageUrl,
            alt: draft.featuredAlt,
            caption: draft.featuredCaption,
            width: image.width,
            height: image.height
          }
        : null,
    verification: saved.verification,
    images: saved.images,
    entities: saved.plan?.entities ?? [],
    mainEntity: saved.plan?.mainEntity ?? ''
  }
  const pageMeta: BlogPageMeta = {
    siteName: labels.author.name,
    author: {
      name: labels.author.name,
      ...(labels.author.url && { url: labels.author.url }),
      type: labels.author.type
    },
    publishedUrl: saved.publishedUrl,
    datePublished: saved.publishedAt,
    dateModified: saved.updatedAt,
    diagramColor: labels.brandColor
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        wrapActions
        preTitle={
          <Link
            href="/blogs"
            aria-label="Back to Blogs & Articles"
            className="text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        title={
          <h1 className="text-foreground min-w-0 text-xl font-bold tracking-tight sm:text-2xl">
            <TruncatedText text={draft.title || saved.brief.topic} />
          </h1>
        }
        description={
          <span className="inline-flex items-center gap-2">
            <BlogStatusChip
              status={saved.status}
              generationStatus={saved.generationStatus}
              generationStage={saved.generationStage}
              stale={saved.stale}
              hasText
              publishedTo={saved.publishedTo}
            />
            <span>
              {saving
                ? 'Saving…'
                : dirty
                  ? 'Unsaved changes'
                  : 'All changes saved'}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              size="sm"
              onClick={onSave}
              disabled={!canSave}
              loading={saving}
            >
              <Save aria-hidden className="h-4 w-4" />
              Save
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDialog('regenerate')}
              disabled={busy}
            >
              <RefreshCw aria-hidden className="h-4 w-4" />
              Regenerate
            </Button>
            <Button
              size="sm"
              variant="secondary"
              aria-pressed={preview}
              onClick={() => setPreview(value => !value)}
            >
              {preview ? (
                <PencilLine aria-hidden className="h-4 w-4" />
              ) : (
                <Eye aria-hidden className="h-4 w-4" />
              )}
              {preview ? 'Edit' : 'Preview'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDialog('share')}
              disabled={!saved.title.trim()}
            >
              <Link2 aria-hidden className="h-4 w-4" />
              {saved.shareToken ? 'Shared' : 'Share'}
            </Button>
            <ExportMenu
              blog={current}
              meta={pageMeta}
              loadImageData={imageData}
              loadPictureData={pictureData}
            />
            <Menu
              label="More"
              icon={<MoreHorizontal aria-hidden className="h-4 w-4" />}
              disabled={busy}
              items={[
                ...(saved.status === 'published'
                  ? [
                      {
                        label: 'Edit publishing details…',
                        icon: <Globe aria-hidden className="h-4 w-4" />,
                        onSelect: () => setDialog('publish')
                      },
                      {
                        label: 'Mark as a draft',
                        icon: <Undo2 aria-hidden className="h-4 w-4" />,
                        onSelect: () => void markPublished(null)
                      }
                    ]
                  : [
                      {
                        label: 'Mark as published…',
                        icon: <Globe aria-hidden className="h-4 w-4" />,
                        onSelect: () => setDialog('publish')
                      }
                    ]),
                ...(saved.publishedUrl
                  ? [
                      {
                        label: 'Open the published page',
                        icon: <ExternalLink aria-hidden className="h-4 w-4" />,
                        onSelect: () =>
                          window.open(saved.publishedUrl!, '_blank', 'noopener')
                      }
                    ]
                  : []),
                {
                  label: 'Delete…',
                  icon: <Trash2 aria-hidden className="h-4 w-4" />,
                  tone: 'danger' as const,
                  onSelect: () => setDialog('delete')
                }
              ]}
            />
          </>
        }
      />

      <div className="bg-background flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:items-start">
          <main className="min-w-0 flex-1">
            <div className="mx-auto max-w-3xl space-y-4">
              {conflict && (
                <Notice
                  tone="warning"
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => router.refresh()}
                    >
                      Reload
                    </Button>
                  }
                >
                  This blog changed in another tab or by a regeneration. Reload
                  to see it; your unsaved changes here will be lost.
                </Notice>
              )}
              {saved.generationStatus === 'failed' && !failureSeen && (
                <Notice
                  tone="warning"
                  action={
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setDialog('regenerate')}
                      >
                        <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                        Try again
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setFailureSeen(true)}
                      >
                        Dismiss
                      </Button>
                    </>
                  }
                >
                  The last regeneration failed
                  {saved.generationError
                    ? `: ${saved.generationError}`
                    : '.'}{' '}
                  The text below is the version before it.
                </Notice>
              )}
              {saved.generationStatus === 'generating' && saved.stale && (
                <Notice
                  tone="warning"
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDialog('regenerate')}
                    >
                      <RotateCcw aria-hidden className="h-3.5 w-3.5" />
                      Try again
                    </Button>
                  }
                >
                  The last regeneration stopped before it finished. The text
                  below is the version before it; you can keep editing it.
                </Notice>
              )}
              {regenerating && (
                <BlogProgress
                  compact
                  sourcesReused={sourcesReused}
                  blogId={saved.id}
                  brief={saved.brief}
                  initial={{
                    status: 'generating',
                    stage: saved.generationStage,
                    error: null,
                    stale: false
                  }}
                  startedAt={saved.generationStartedAt}
                  onReady={() => router.refresh()}
                  onDismiss={() => router.refresh()}
                />
              )}

              {preview && (
                <BlogPreview
                  blog={current}
                  site={labels.site}
                  diagramColor={labels.brandColor}
                />
              )}
              {/* Hidden, not unmounted, in Preview: the editor keeps its undo history. */}
              <div
                className={cn(
                  'border-border bg-surface rounded-2xl border shadow-xs transition-opacity',
                  regenerating && 'pointer-events-none opacity-50',
                  preview && 'hidden'
                )}
                aria-busy={regenerating || rewriting !== null}
              >
                <div className="px-5 pt-6 sm:px-10 sm:pt-8">
                  <div className="mb-6">
                    <FeaturedImageCard
                      image={saved.featuredImage}
                      url={saved.featuredImageUrl}
                      alt={draft.featuredAlt}
                      caption={draft.featuredCaption}
                      making={makingImage}
                      disabled={!editable || busy}
                      onAlt={featuredAlt => patch({ featuredAlt })}
                      onCaption={featuredCaption => patch({ featuredCaption })}
                      onMake={makeImage}
                      onRemove={() => void removeImage()}
                      onDownload={() => void downloadImage()}
                    />
                  </div>
                  <label htmlFor={titleId} className="sr-only">
                    Title
                  </label>
                  <TextField
                    id={titleId}
                    maxRows={12}
                    maxLength={BLOG_LIMITS.title}
                    value={draft.title}
                    disabled={!editable}
                    onChange={event =>
                      patch({ title: event.target.value.replace(/\n/g, ' ') })
                    }
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        editorRef.current?.commands.focus('start')
                      }
                    }}
                    placeholder="Title"
                    className="rounded-none border-0 bg-transparent p-0 text-3xl leading-tight font-bold tracking-tight shadow-none hover:border-0 focus:ring-0 disabled:cursor-default disabled:opacity-100 sm:text-4xl"
                  />
                  <p className="text-muted mt-2 text-xs">
                    {BLOG_KIND_LABELS[saved.kind]} ·{' '}
                    {BLOG_STYLE_LABELS[saved.brief.style]} ·{' '}
                    {words.toLocaleString('en-US')} words · {minutes} min read ·
                    AI cost ${saved.costUsd.toFixed(2)}
                  </p>
                </div>
                <div className="mt-2 px-3 sm:px-8">
                  <DiagramColorContext.Provider value={labels.brandColor}>
                    <BlogImagesContext.Provider value={imagesContext}>
                      <DocEditor
                        value={draft.content}
                        editable={editable}
                        onChange={onDocChange}
                        onEditor={onEditor}
                      />
                    </BlogImagesContext.Provider>
                  </DiagramColorContext.Provider>
                </div>
                <div className="px-5 pb-8 sm:px-10">
                  <FaqEditor
                    items={draft.faq}
                    onChange={onFaqChange}
                    disabled={!editable}
                  />
                </div>
              </div>
            </div>
          </main>

          <aside className="lg:sticky lg:top-6 lg:w-96 lg:shrink-0">
            <div className="border-border bg-surface rounded-2xl border shadow-xs">
              <ScrollFade
                role="tablist"
                aria-label="Blog details"
                className="border-border flex gap-0.5 border-b px-1.5 pt-1.5"
              >
                {TABS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`${tabsId}-${key}`}
                    aria-selected={tab === key}
                    aria-controls={`${tabsId}-panel`}
                    onClick={() => setTab(key)}
                    className={cn(
                      'focus-visible:ring-brand/30 -mb-px flex-1 cursor-pointer rounded-t-md border-b-2 px-2 py-2 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                      tab === key
                        ? 'border-brand text-foreground'
                        : 'text-muted hover:text-foreground hover:bg-surface-hover/60 border-transparent'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </ScrollFade>
              <div
                role="tabpanel"
                id={`${tabsId}-panel`}
                aria-labelledby={`${tabsId}-${tab}`}
                className="p-4 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto"
              >
                {tab === 'seo' && (
                  <SeoPanel
                    edit={draft}
                    onChange={patch}
                    disabled={!editable}
                    liveChecks={liveChecks}
                    savedChecks={saved.checks}
                    notes={saved.selfFlags}
                    site={labels.site}
                  />
                )}
                {tab === 'outline' && (
                  <OutlinePanel
                    doc={draft.content}
                    disabled={!editable || conflict}
                    rewriting={rewriting}
                    onJump={jumpTo}
                    onRewrite={rewrite}
                  />
                )}
                {tab === 'sources' && (
                  <SourcesPanel
                    sources={saved.sources}
                    verification={saved.verification}
                    checking={checking}
                    disabled={busy || conflict}
                    onCheck={() => void checkSources()}
                  />
                )}
                {tab === 'links' && (
                  <LinksPanel
                    links={saved.internalLinks}
                    related={labels.related}
                    doc={draft.content}
                    disabled={!editable}
                    onInsert={insertLink}
                  />
                )}
                {tab === 'versions' && (
                  <VersionsPanel
                    blogId={saved.id}
                    kind={saved.kind}
                    version={saved.lockVersion}
                    dirty={dirty}
                    disabled={busy}
                    onRestore={restore}
                  />
                )}
                {tab === 'brief' && (
                  <BriefPanel
                    blogId={saved.id}
                    kind={saved.kind}
                    brief={saved.brief}
                    plan={saved.plan}
                    labels={labels}
                    costUsd={saved.costUsd}
                    model={saved.model}
                    questions={saved.searchQuestions}
                  />
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {dialog === 'regenerate' && (
        <RegenerateDialog
          dirty={dirty}
          researchOn={saved.brief.research}
          hasImage={imageReady || Object.keys(saved.images).length > 0}
          onCancel={() => setDialog(null)}
          onConfirm={regenerate}
        />
      )}
      {dialog === 'publish' && (
        <PublishDialog
          initial={{
            destination: saved.publishedTo,
            url: saved.publishedUrl,
            publishedAt: saved.publishedAt
          }}
          editing={saved.status === 'published'}
          onCancel={() => setDialog(null)}
          onConfirm={details => markPublished(details)}
        />
      )}
      {dialog === 'share' && (
        <ShareDialog
          token={saved.shareToken}
          dirty={dirty}
          onShare={share}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Delete this blog?"
          description="It is removed with all its versions. This cannot be undone."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          pending={deleting}
          onCancel={() => setDialog(null)}
          onConfirm={remove}
        />
      )}
    </div>
  )
}

/**
 * A row that scrolls sideways when it does not fit, with its cut-off edge
 * faded so it is clear there is more to scroll to.
 */
function ScrollFade({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const row = ref.current
    if (!row) return
    const measure = () =>
      setEdges({
        start: row.scrollLeft > 1,
        end: row.scrollLeft + row.clientWidth < row.scrollWidth - 1
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    row.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      row.removeEventListener('scroll', measure)
    }
  }, [])
  const fade = 'black calc(100% - 24px), transparent'
  const mask =
    edges.start && edges.end
      ? `linear-gradient(to right, transparent, black 24px, ${fade})`
      : edges.start
        ? 'linear-gradient(to right, transparent, black 24px)'
        : edges.end
          ? `linear-gradient(to right, ${fade})`
          : undefined
  return (
    <div
      ref={ref}
      {...props}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      className={cn('overflow-x-auto [scrollbar-width:none]', className)}
    >
      {children}
    </div>
  )
}

function Notice({
  tone,
  action,
  children
}: {
  tone: 'warning'
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'warning' &&
          'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
      )}
    >
      <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1">{children}</p>
      {action && <div className="flex gap-2">{action}</div>}
    </div>
  )
}
