'use client'

import { Button, buttonClassName } from '@/components/button'
import { FormAlert } from '@/components/form-alert'
import { PageHeader } from '@/components/page-header'
import { PlatformMark } from '@/components/platform-mark'
import { showToast } from '@/components/toast-notification'
import { FIELD_CLASS, TextArea, TextField } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { formatCharCount, FORMATS } from '@/lib/formats'
import type { PlatformId } from '@/lib/platforms'
import type { PublicationSummary } from '@/lib/publishing/engine'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  Film,
  Image as ImageIcon,
  Link2,
  Loader2,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MediaAnalysis } from '~/lib/ai/skills/media-post/schema'
import {
  captionOf,
  mediaPostProblem,
  postTextOf,
  VIDEO_TITLE_MAX,
  withRewrittenPart,
  type MediaPostDraft,
  type MediaPostPart
} from '~/lib/media-upload/drafts'
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_NOTES_MAX_CHARS,
  uploadFormatOf,
  uploadTypeOf,
  validateUploadFile,
  type UploadKind
} from '~/lib/media-upload/rules'
import { createMediaPosts, type CreatedPostResult } from './actions'

/**
 * Create from media: upload or share one image or video; the AI looks at it
 * and writes a post for each platform picked (hook, caption, call to action,
 * hashtags); edit them, or have the AI write a post's hook, body or whole
 * text again; then publish now, schedule, or save them as drafts. Every post
 * goes out with the original file.
 *
 * The file goes from the browser straight into storage (a signed link), so a
 * video is not held to the app's request size. Nothing is saved as a post
 * until the last step.
 */

export type PlatformChoice = {
  id: PlatformId
  label: string
  /** The identity posts here (its Profile's platforms). */
  postsHere: boolean
  /** Publishing to it is set up on this server. */
  publishing: boolean
  /** The identity's account there can be published to. */
  connected: boolean
  accountName: string | null
}

type Upload = {
  uploadId: string
  kind: UploadKind
  mediaType: string
  byteSize: number
  fileName: string | null
}

type MediaFacts = {
  kind: UploadKind
  width: number | null
  height: number | null
  durationSeconds: number | null
  byteSize: number
}

type Generated = {
  media: MediaFacts
  analysis: MediaAnalysis
  warnings: Partial<Record<PlatformId, string>>
}

/** A part just written again, and the post as it was, for Undo. */
type Rewritten = { part: MediaPostPart; before: MediaPostDraft }

const REWRITTEN_LABEL: Record<MediaPostPart, string> = {
  hook: 'New hook written.',
  body: 'New body written.',
  post: 'New post written.'
}

/** Whether an edit changes the part that was just written again. */
function editsPart(
  part: MediaPostPart,
  before: MediaPostDraft,
  after: MediaPostDraft
): boolean {
  if (part === 'hook') return before.hook !== after.hook
  if (part === 'body') return before.body !== after.body
  return (
    before.hook !== after.hook ||
    before.body !== after.body ||
    before.cta !== after.cta ||
    before.title !== after.title ||
    before.firstComment !== after.firstComment ||
    before.hashtags.join(' ') !== after.hashtags.join(' ')
  )
}

const without = <T extends object, K extends keyof T>(record: T, key: K) => {
  const { [key]: _, ...rest } = record
  return rest as Omit<T, K>
}

const FOCUS_RING =
  'focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none'
const LABEL = 'text-foreground mb-1 block text-xs font-semibold'

const megabytes = (bytes: number) =>
  `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

/** "2026-11-27T10:00" an hour or so from now, for the schedule field. */
function defaultScheduleValue(): string {
  const at = new Date(Date.now() + 60 * 60_000)
  at.setMinutes(0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** PUTs the file to its signed link, reporting progress; rejects with a message. */
function putFile(
  url: string,
  file: File,
  mediaType: string,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', mediaType)
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`The upload failed (${xhr.status}). Try again.`))
    xhr.onerror = () =>
      reject(
        new Error(
          'The upload could not reach storage. Check your connection; if it keeps failing, the storage bucket may not allow uploads from this site (CORS).'
        )
      )
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || 'Something went wrong. Try again.')
  }
  return data as T
}

const emptyDraft = (
  platform: PlatformId,
  kind: UploadKind
): MediaPostDraft | null => {
  const formatId = uploadFormatOf(kind, platform)
  return formatId
    ? {
        platform,
        formatId,
        hook: '',
        body: '',
        cta: '',
        hashtags: [],
        firstComment: '',
        title: '',
        altText: ''
      }
    : null
}

export function CreateFromMediaClient({
  platforms,
  storageReady,
  identityName
}: {
  platforms: PlatformChoice[]
  storageReady: boolean
  identityName: string
}) {
  // ------------------------------------------------------------ the media
  const [preview, setPreview] = useState<{
    url: string
    kind: UploadKind
    local: boolean
  } | null>(null)
  const [upload, setUpload] = useState<Upload | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [dragging, setDragging] = useState(false)
  const uploadAbort = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // ------------------------------------------------------------ the posts
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState<PlatformId[]>([])
  const [generated, setGenerated] = useState<Generated | null>(null)
  const [drafts, setDrafts] = useState<
    Partial<Record<PlatformId, MediaPostDraft>>
  >({})
  // Bumped on each generation, so the cards start from the new text.
  const [generation, setGeneration] = useState(0)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const analyzeAbort = useRef<AbortController | null>(null)
  // Regenerate on one post: the part being written again, by platform, and
  // the last part written, for Undo. A post written whole remounts its card
  // (its hashtags field keeps its own text).
  const [rewriting, setRewriting] = useState<
    Partial<Record<PlatformId, MediaPostPart>>
  >({})
  const [rewritten, setRewritten] = useState<
    Partial<Record<PlatformId, Rewritten>>
  >({})
  const [cardResets, setCardResets] = useState<
    Partial<Record<PlatformId, number>>
  >({})
  const rewriteAborts = useRef(new Map<PlatformId, AbortController>())
  const anyRewriting = Object.keys(rewriting).length > 0

  // ------------------------------------------------------------ going out
  const [busy, setBusy] = useState<'publish' | 'schedule' | 'draft' | null>(
    null
  )
  const [scheduling, setScheduling] = useState(false)
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [problems, setProblems] = useState<Partial<Record<PlatformId, string>>>(
    {}
  )
  const [results, setResults] = useState<CreatedPostResult[] | null>(null)
  const [resultIntent, setResultIntent] = useState<
    'publish' | 'schedule' | 'draft'
  >('draft')

  const kind = upload?.kind ?? preview?.kind ?? null
  const available = useMemo(
    () =>
      kind ? platforms.filter(p => uploadFormatOf(kind, p.id)) : platforms,
    [kind, platforms]
  )

  // New media starts with the platforms the identity posts on that take
  // it; else the connected ones; else the first that takes it.
  const selectDefaults = useCallback(
    (mediaKind: UploadKind) => {
      const takes = platforms.filter(p => uploadFormatOf(mediaKind, p.id))
      const mine = takes.filter(p => p.postsHere).map(p => p.id)
      const connected = takes.filter(p => p.connected).map(p => p.id)
      setSelected(
        mine.length > 0
          ? mine
          : connected.length > 0
            ? connected
            : takes.slice(0, 1).map(p => p.id)
      )
    },
    [platforms]
  )

  // Object URLs are let go when the preview changes.
  useEffect(() => {
    const url = preview?.local ? preview.url : null
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [preview])

  useEffect(
    () => () => {
      uploadAbort.current?.abort()
      analyzeAbort.current?.abort()
      for (const controller of rewriteAborts.current.values()) controller.abort()
    },
    []
  )

  // Unsaved posts are not lost to a stray reload.
  const unsaved = Boolean(generated) && !results
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  /** Stops every Regenerate under way; what it would have written is dropped. */
  const stopRewriting = useCallback(() => {
    for (const controller of rewriteAborts.current.values()) controller.abort()
    rewriteAborts.current.clear()
    setRewriting({})
    setRewritten({})
  }, [])

  const reset = useCallback(() => {
    uploadAbort.current?.abort()
    analyzeAbort.current?.abort()
    stopRewriting()
    setPreview(null)
    setUpload(null)
    setUploading(false)
    setProgress(0)
    setMediaError(null)
    setLink('')
    setGenerated(null)
    setDrafts({})
    setAnalyzeError(null)
    setSubmitError(null)
    setProblems({})
    setResults(null)
    setScheduling(false)
  }, [stopRewriting])

  /** Validates and uploads a file straight to storage. */
  const takeFile = useCallback(
    async (file: File) => {
      const problem = validateUploadFile(file)
      if (problem) {
        setMediaError(problem)
        return
      }
      const type = uploadTypeOf(file.type)!
      reset()
      setPreview({
        url: URL.createObjectURL(file),
        kind: type.kind,
        local: true
      })
      selectDefaults(type.kind)
      setUploading(true)
      const controller = new AbortController()
      uploadAbort.current = controller
      try {
        const { upload: started } = await postJson<{
          upload: Upload & { uploadUrl: string }
        }>(
          '/api/media-posts/upload',
          { mediaType: type.mediaType, size: file.size, fileName: file.name },
          controller.signal
        )
        await putFile(
          started.uploadUrl,
          file,
          started.mediaType,
          setProgress,
          controller.signal
        )
        const { uploadUrl: _, ...done } = started
        setUpload(done)
      } catch (err) {
        if (controller.signal.aborted) return
        setMediaError(
          err instanceof Error ? err.message : 'The upload failed. Try again.'
        )
        setPreview(null)
      } finally {
        if (!controller.signal.aborted) setUploading(false)
      }
    },
    [reset, selectDefaults]
  )

  /** Media shared as a link: the server fetches and keeps it. */
  const takeLink = async () => {
    const value = link.trim()
    if (!value) return
    reset()
    setLink(value)
    setUploading(true)
    const controller = new AbortController()
    uploadAbort.current = controller
    try {
      const { upload: done } = await postJson<{ upload: Upload }>(
        '/api/media-posts/upload',
        { link: value },
        controller.signal
      )
      setUpload(done)
      setPreview({ url: value, kind: done.kind, local: false })
      selectDefaults(done.kind)
    } catch (err) {
      if (controller.signal.aborted) return
      setMediaError(
        err instanceof Error ? err.message : 'That link could not be used.'
      )
    } finally {
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  // A pasted image or video is taken like a dropped one.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const file = [...(e.clipboardData?.files ?? [])][0]
      if (file && !uploading && !analyzing && !busy) {
        e.preventDefault()
        void takeFile(file)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [takeFile, uploading, analyzing, busy])

  const togglePlatform = (id: PlatformId) => {
    setSelected(prev => {
      const next = prev.includes(id)
        ? prev.filter(p => p !== id)
        : [...prev, id]
      // A platform added after the posts were written starts empty, to write
      // by hand or with Write again.
      if (!prev.includes(id) && generated && kind && !drafts[id]) {
        const empty = emptyDraft(id, kind)
        if (empty) setDrafts(d => ({ ...d, [id]: empty }))
      }
      return platforms.filter(p => next.includes(p.id)).map(p => p.id)
    })
  }

  const analyze = async () => {
    if (!upload || selected.length === 0) return
    analyzeAbort.current?.abort()
    stopRewriting()
    const controller = new AbortController()
    analyzeAbort.current = controller
    setAnalyzing(true)
    setAnalyzeError(null)
    setSubmitError(null)
    setProblems({})
    try {
      const { result } = await postJson<{
        result: Generated & { posts: MediaPostDraft[] }
      }>(
        '/api/media-posts/analyze',
        { uploadId: upload.uploadId, platforms: selected, notes },
        controller.signal
      )
      const { posts, ...rest } = result
      setGenerated(rest)
      setDrafts(prev => {
        const next = { ...prev }
        for (const post of posts) next[post.platform] = post
        return next
      })
      setGeneration(g => g + 1)
    } catch (err) {
      if (controller.signal.aborted) return
      setAnalyzeError(
        err instanceof Error ? err.message : 'The posts could not be written.'
      )
    } finally {
      if (!controller.signal.aborted) setAnalyzing(false)
    }
  }

  const stopAnalyzing = () => {
    analyzeAbort.current?.abort()
    setAnalyzing(false)
  }

  /**
   * Regenerate on one post: its hook, body or whole text is written again
   * from what the AI saw in the media; the rest of the post, edits included,
   * stays. The media is not uploaded or read again.
   */
  const rewrite = async (platform: PlatformId, part: MediaPostPart) => {
    const current = drafts[platform]
    if (!generated || !current || rewriting[platform]) return
    const controller = new AbortController()
    rewriteAborts.current.set(platform, controller)
    setRewriting(prev => ({ ...prev, [platform]: part }))
    try {
      const { formatId: _, ...draft } = current
      const { draft: next } = await postJson<{ draft: MediaPostDraft }>(
        '/api/media-posts/rewrite',
        {
          kind: generated.media.kind,
          part,
          analysis: generated.analysis,
          notes,
          draft
        },
        controller.signal
      )
      if (controller.signal.aborted) return
      // Into the post as it is now: fields other than the one being written
      // may have been edited meanwhile.
      setDrafts(prev => {
        const latest = prev[platform]
        return latest
          ? { ...prev, [platform]: withRewrittenPart(latest, next, part) }
          : prev
      })
      setRewritten(prev => ({ ...prev, [platform]: { part, before: current } }))
      setProblems(prev => without(prev, platform))
      if (part === 'post') {
        setCardResets(prev => ({ ...prev, [platform]: (prev[platform] ?? 0) + 1 }))
      }
    } catch (err) {
      if (controller.signal.aborted) return
      showToast({
        type: 'error',
        title: 'Not regenerated',
        message:
          err instanceof Error ? err.message : 'The new text could not be written.'
      })
    } finally {
      if (rewriteAborts.current.get(platform) === controller) {
        rewriteAborts.current.delete(platform)
        setRewriting(prev => without(prev, platform))
      }
    }
  }

  /** Puts back the part last written again, as it was before. */
  const undoRewrite = (platform: PlatformId) => {
    const last = rewritten[platform]
    if (!last) return
    setDrafts(prev => {
      const latest = prev[platform]
      return latest
        ? {
            ...prev,
            [platform]: withRewrittenPart(latest, last.before, last.part)
          }
        : prev
    })
    setRewritten(prev => without(prev, platform))
    if (last.part === 'post') {
      setCardResets(prev => ({ ...prev, [platform]: (prev[platform] ?? 0) + 1 }))
    }
  }

  const shownDrafts = selected
    .map(id => drafts[id])
    .filter((d): d is MediaPostDraft => Boolean(d))
  const choiceOf = (id: PlatformId) => platforms.find(p => p.id === id)!
  const notPublishable = selected.filter(id => {
    const choice = choiceOf(id)
    return !choice.publishing || !choice.connected
  })
  const localProblems = Object.fromEntries(
    shownDrafts
      .map(d => [d.platform, mediaPostProblem(d)] as const)
      .filter(([, p]) => p)
  ) as Partial<Record<PlatformId, string>>

  const submit = async (intent: 'publish' | 'schedule' | 'draft') => {
    if (!upload || !generated || shownDrafts.length === 0 || anyRewriting)
      return
    setBusy(intent)
    setSubmitError(null)
    setProblems({})
    try {
      const outcome = await createMediaPosts({
        uploadId: upload.uploadId,
        fileName: upload.fileName,
        summary: generated.analysis.summary,
        analysis: generated.analysis,
        notes,
        media: {
          width: generated.media.width,
          height: generated.media.height,
          durationSeconds: generated.media.durationSeconds
        },
        kind: upload.kind,
        posts: shownDrafts.map(({ formatId: _, ...post }) => post),
        intent,
        scheduledAt:
          intent === 'schedule'
            ? new Date(scheduleAt).toISOString()
            : undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
      if (!outcome.success) {
        setSubmitError(outcome.error)
        setProblems(outcome.problems ?? {})
        return
      }
      setResults(outcome.results)
      setResultIntent(intent)
      const failed = outcome.results.filter(r => r.error).length
      showToast({
        type: failed ? 'error' : 'success',
        title:
          intent === 'draft'
            ? 'Saved as drafts'
            : failed
              ? `${failed} of ${outcome.results.length} could not go out`
              : intent === 'schedule'
                ? 'Scheduled'
                : 'Published'
      })
    } catch {
      setSubmitError(
        'The posts could not be saved. Check your connection and try again.'
      )
    } finally {
      setBusy(null)
    }
  }

  const ready = Boolean(upload) && !uploading
  // A time too soon is refused by the server, which says so.
  const scheduleInvalid =
    !scheduleAt || Number.isNaN(new Date(scheduleAt).getTime())
  const publishBlocked =
    notPublishable.length > 0
      ? `Connect ${notPublishable.map(id => choiceOf(id).label).join(', ')} in Settings → Integrations to publish there, or untick ${notPublishable.length === 1 ? 'it' : 'them'}.`
      : Object.keys(localProblems).length > 0
        ? 'Fix the posts marked below first.'
        : null

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Create from media"
        preTitle={
          <Link
            href="/posts"
            aria-label="Back to posts"
            className={cn(
              'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-8 w-8 items-center justify-center rounded-lg',
              FOCUS_RING
            )}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        description="Upload a photo or video. AI writes a post for each platform from what it shows; edit them, then publish, schedule or save them."
      />

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6">
        {!storageReady && (
          <FormAlert className="mb-4">
            Uploading media needs file storage, which is not set up on this
            server (STORAGE_BUCKET).
          </FormAlert>
        )}

        {results ? (
          <ResultsPanel
            results={results}
            intent={resultIntent}
            platforms={platforms}
            onAnother={reset}
          />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
            {/* LEFT: the media, what it is about, and the platforms. */}
            <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
              <section className="border-border bg-surface rounded-2xl border p-4 shadow-xs">
                <h2 className="text-foreground mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Upload aria-hidden className="text-accent h-4 w-4" />
                  1. Your media
                </h2>
                {preview ? (
                  <div className="space-y-2">
                    <div className="bg-background border-border relative overflow-hidden rounded-xl border">
                      {preview.kind === 'video' ? (
                        <video
                          src={preview.url}
                          controls
                          playsInline
                          muted
                          className="max-h-80 w-full bg-black object-contain"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={preview.url}
                          alt={upload?.fileName ?? 'Your image'}
                          className="max-h-80 w-full object-contain"
                        />
                      )}
                      {uploading && (
                        <div className="bg-background/80 absolute inset-x-0 bottom-0 p-2">
                          <div className="bg-border h-1.5 overflow-hidden rounded-full">
                            <div
                              className="bg-accent h-full transition-[width]"
                              style={{
                                width: `${Math.round(progress * 100)}%`
                              }}
                            />
                          </div>
                          <p
                            className="text-muted mt-1 text-[11px]"
                            aria-live="polite"
                          >
                            Uploading… {Math.round(progress * 100)}%
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-muted inline-flex min-w-0 items-center gap-1.5">
                        {preview.kind === 'video' ? (
                          <Film aria-hidden className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ImageIcon
                            aria-hidden
                            className="h-3.5 w-3.5 shrink-0"
                          />
                        )}
                        <span className="truncate">
                          {upload?.fileName ||
                            (preview.kind === 'video' ? 'Video' : 'Image')}
                          {upload && ` · ${megabytes(upload.byteSize)}`}
                          {generated?.media.width && generated.media.height
                            ? ` · ${generated.media.width}×${generated.media.height}`
                            : ''}
                          {generated?.media.durationSeconds
                            ? ` · ${clock(generated.media.durationSeconds)}`
                            : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={reset}
                        disabled={Boolean(busy)}
                        className={cn(
                          'text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-1 rounded px-1 font-medium disabled:cursor-not-allowed',
                          FOCUS_RING
                        )}
                      >
                        <X aria-hidden className="h-3.5 w-3.5" />
                        Change
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button
                      type="button"
                      disabled={!storageReady || uploading}
                      onClick={() => fileInput.current?.click()}
                      onDragOver={e => {
                        e.preventDefault()
                        setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={e => {
                        e.preventDefault()
                        setDragging(false)
                        const file = e.dataTransfer.files[0]
                        if (file) void takeFile(file)
                      }}
                      className={cn(
                        'border-border hover:border-accent/50 hover:bg-accent/5 flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        dragging && 'border-accent bg-accent/5',
                        FOCUS_RING
                      )}
                    >
                      {uploading ? (
                        <Loader2
                          aria-hidden
                          className="text-accent h-7 w-7 animate-spin"
                        />
                      ) : (
                        <Upload aria-hidden className="text-accent h-7 w-7" />
                      )}
                      <span className="text-foreground text-sm font-semibold">
                        {uploading
                          ? 'Fetching…'
                          : 'Drop, paste or choose a file'}
                      </span>
                      <span className="text-muted text-xs">
                        JPEG, PNG or WebP up to{' '}
                        {megabytes(UPLOAD_MAX_BYTES.image)} · MP4 or MOV up to{' '}
                        {megabytes(UPLOAD_MAX_BYTES.video)}
                      </span>
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                      className="sr-only"
                      tabIndex={-1}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void takeFile(file)
                      }}
                    />
                    <form
                      onSubmit={e => {
                        e.preventDefault()
                        void takeLink()
                      }}
                      className="flex gap-2"
                    >
                      <label className="relative min-w-0 flex-1">
                        <span className="sr-only">
                          Or share a link to an image or video
                        </span>
                        <Link2
                          aria-hidden
                          className="text-muted pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
                        />
                        <input
                          type="url"
                          inputMode="url"
                          value={link}
                          onChange={e => setLink(e.target.value)}
                          placeholder="Or paste a link to an image or video"
                          disabled={!storageReady || uploading}
                          className={cn(FIELD_CLASS, 'h-9 py-0 pl-8')}
                        />
                      </label>
                      <Button
                        type="submit"
                        variant="secondary"
                        size="sm"
                        className="h-9"
                        disabled={!storageReady || !link.trim()}
                        loading={uploading}
                      >
                        Use link
                      </Button>
                    </form>
                  </div>
                )}
                {mediaError && (
                  <FormAlert className="mt-3">{mediaError}</FormAlert>
                )}

                <div className="mt-4">
                  <label htmlFor="media-notes" className={LABEL}>
                    What should people know?{' '}
                    <span className="text-muted font-normal">(optional)</span>
                  </label>
                  <TextArea
                    id="media-notes"
                    value={notes}
                    onChange={e =>
                      setNotes(e.target.value.slice(0, UPLOAD_NOTES_MAX_CHARS))
                    }
                    rows={3}
                    placeholder="Who or what is in it, where it was, the occasion, a link to include… The AI only states what it can see or what you write here."
                    maxRows={14}
                  />
                </div>
              </section>

              <section className="border-border bg-surface rounded-2xl border p-4 shadow-xs">
                <h2 className="text-foreground mb-1 flex items-center gap-2 text-sm font-semibold">
                  <Send aria-hidden className="text-accent h-4 w-4" />
                  2. Platforms
                </h2>
                <p className="text-muted mb-3 text-xs">
                  {kind === 'video'
                    ? 'Where the video goes. Instagram and Facebook post it as a Reel, YouTube as a Short.'
                    : kind === 'image'
                      ? 'Where the image goes, with a post written for each.'
                      : 'Pick where it goes once your media is in.'}
                </p>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
                  {available.map(choice => {
                    const on = selected.includes(choice.id)
                    return (
                      <li key={choice.id}>
                        <label
                          className={cn(
                            'border-border hover:bg-surface-hover flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                            on && 'border-accent/50 bg-accent/5'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={
                              !kind ||
                              analyzing ||
                              Boolean(busy) ||
                              Boolean(rewriting[choice.id])
                            }
                            onChange={() => togglePlatform(choice.id)}
                            className="accent-accent h-4 w-4"
                          />
                          <PlatformMark
                            platform={choice.id}
                            className="h-4 w-4 shrink-0"
                          />
                          <span className="text-foreground min-w-0 flex-1 truncate font-medium">
                            {choice.label}
                          </span>
                          <span
                            className={cn(
                              'shrink-0 text-[11px]',
                              choice.connected
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-muted'
                            )}
                            title={choice.accountName ?? undefined}
                          >
                            {choice.connected
                              ? 'Connected'
                              : choice.publishing
                                ? 'Not connected'
                                : 'Drafts only'}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {analyzing ? (
                    <>
                      <Button disabled className="flex-1">
                        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
                        {kind === 'video'
                          ? 'Watching the video…'
                          : 'Looking at the image…'}
                      </Button>
                      <Button variant="secondary" onClick={stopAnalyzing}>
                        Stop
                      </Button>
                    </>
                  ) : (
                    <Button
                      className="flex-1"
                      onClick={() => void analyze()}
                      disabled={
                        !ready ||
                        selected.length === 0 ||
                        Boolean(busy) ||
                        anyRewriting
                      }
                      title={
                        anyRewriting
                          ? 'A post is being written again; wait for it first'
                          : undefined
                      }
                    >
                      {generated ? (
                        <RefreshCw aria-hidden className="h-4 w-4" />
                      ) : (
                        <Sparkles aria-hidden className="h-4 w-4" />
                      )}
                      {generated ? 'Write again' : 'Write posts with AI'}
                    </Button>
                  )}
                </div>
                {generated && !analyzing && (
                  <p className="text-muted mt-2 text-[11px]">
                    Write again replaces the text of every post ticked above.
                    To keep a post and change one part of it, use Regenerate
                    on the post.
                  </p>
                )}
                {analyzeError && (
                  <FormAlert className="mt-3">{analyzeError}</FormAlert>
                )}
              </section>
            </div>

            {/* RIGHT: what the AI saw, the posts to edit, and sending them. */}
            <div className="flex min-w-0 flex-col gap-4">
              {!generated ? (
                <div className="border-border text-muted flex min-h-64 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center text-sm">
                  {analyzing ? (
                    <>
                      <Loader2
                        aria-hidden
                        className="text-accent h-6 w-6 animate-spin"
                      />
                      <p className="text-foreground font-medium">
                        Writing {selected.length} post
                        {selected.length === 1 ? '' : 's'} in {identityName}
                        &rsquo;s voice…
                      </p>
                      <p className="text-xs">This takes up to a minute.</p>
                    </>
                  ) : (
                    <>
                      <Sparkles aria-hidden className="text-accent h-6 w-6" />
                      <p className="text-foreground font-medium">
                        Your posts appear here
                      </p>
                      <p className="max-w-sm text-xs">
                        Add a photo or video, pick platforms and choose Write
                        posts with AI. Each post gets a hook, a caption, a call
                        to action and hashtags, written from what the media
                        shows.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <AnalysisCard
                    analysis={generated.analysis}
                    kind={generated.media.kind}
                  />
                  {shownDrafts.length === 0 && (
                    <p className="text-muted text-sm">
                      Tick a platform to write its post.
                    </p>
                  )}
                  {shownDrafts.map(draft => (
                    <PostEditor
                      key={`${draft.platform}-${generation}-${cardResets[draft.platform] ?? 0}`}
                      draft={draft}
                      choice={choiceOf(draft.platform)}
                      kind={generated.media.kind}
                      warning={generated.warnings[draft.platform] ?? null}
                      problem={
                        problems[draft.platform] ??
                        localProblems[draft.platform] ??
                        null
                      }
                      disabled={analyzing || Boolean(busy)}
                      rewriting={rewriting[draft.platform] ?? null}
                      rewritten={rewritten[draft.platform]?.part ?? null}
                      onRewrite={part => void rewrite(draft.platform, part)}
                      onUndo={() => undoRewrite(draft.platform)}
                      onChange={next => {
                        setDrafts(prev => ({ ...prev, [draft.platform]: next }))
                        // Once the new part is edited, Undo would undo the edit too.
                        const last = rewritten[draft.platform]
                        if (last && editsPart(last.part, draft, next)) {
                          setRewritten(prev => without(prev, draft.platform))
                        }
                      }}
                    />
                  ))}

                  {shownDrafts.length > 0 && (
                    <section className="border-border bg-surface sticky bottom-3 z-10 rounded-2xl border p-4 shadow-md">
                      <h2 className="text-foreground mb-1 text-sm font-semibold">
                        3. Send {shownDrafts.length} post
                        {shownDrafts.length === 1 ? '' : 's'}
                      </h2>
                      <p className="text-muted mb-3 text-xs">
                        Each post goes out with your original{' '}
                        {generated.media.kind}. Every post is also kept under
                        Posts.
                      </p>
                      {submitError && (
                        <FormAlert className="mb-3">{submitError}</FormAlert>
                      )}
                      {publishBlocked && !submitError && (
                        <p className="mb-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                          <AlertTriangle
                            aria-hidden
                            className="mt-0.5 h-3.5 w-3.5 shrink-0"
                          />
                          {publishBlocked}
                        </p>
                      )}
                      {scheduling ? (
                        <form
                          className="flex flex-wrap items-center gap-2"
                          onSubmit={e => {
                            e.preventDefault()
                            if (!scheduleInvalid) void submit('schedule')
                          }}
                        >
                          <label
                            htmlFor="schedule-at"
                            className="text-foreground text-xs font-semibold"
                          >
                            Publish at
                          </label>
                          <input
                            id="schedule-at"
                            type="datetime-local"
                            required
                            value={scheduleAt}
                            onChange={e => setScheduleAt(e.target.value)}
                            className={cn(FIELD_CLASS, 'h-9 w-auto py-0')}
                          />
                          <Button
                            type="submit"
                            loading={busy === 'schedule'}
                            disabled={
                              Boolean(publishBlocked) ||
                              scheduleInvalid ||
                              Boolean(busy) ||
                              anyRewriting
                            }
                          >
                            <CalendarClock aria-hidden className="h-4 w-4" />
                            Schedule all
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setScheduling(false)}
                            disabled={Boolean(busy)}
                          >
                            Cancel
                          </Button>
                        </form>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            onClick={() => void submit('publish')}
                            loading={busy === 'publish'}
                            disabled={
                              Boolean(publishBlocked) ||
                              Boolean(busy) ||
                              analyzing ||
                              anyRewriting
                            }
                          >
                            {busy !== 'publish' && (
                              <Send aria-hidden className="h-4 w-4" />
                            )}
                            Publish now
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setScheduling(true)}
                            disabled={
                              Boolean(publishBlocked) ||
                              Boolean(busy) ||
                              analyzing ||
                              anyRewriting
                            }
                          >
                            <CalendarClock aria-hidden className="h-4 w-4" />
                            Schedule
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => void submit('draft')}
                            loading={busy === 'draft'}
                            disabled={Boolean(busy) || analyzing || anyRewriting}
                          >
                            {busy !== 'draft' && (
                              <Save aria-hidden className="h-4 w-4" />
                            )}
                            Save as drafts
                          </Button>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** What the AI saw in the media: so the user can tell the posts rest on it. */
function AnalysisCard({
  analysis,
  kind
}: {
  analysis: MediaAnalysis
  kind: UploadKind
}) {
  return (
    <section className="border-border bg-surface rounded-2xl border p-4 shadow-xs">
      <h2 className="text-foreground mb-2 flex items-center gap-2 text-sm font-semibold">
        <Eye aria-hidden className="text-accent h-4 w-4" />
        What the AI sees in your {kind}
      </h2>
      <p className="text-foreground text-sm leading-relaxed">
        {analysis.summary}
      </p>
      {analysis.details.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {analysis.details.slice(0, 12).map((detail, i) => (
            <li
              key={i}
              className="bg-background border-border text-foreground rounded-full border px-2.5 py-0.5 text-xs"
            >
              {detail}
            </li>
          ))}
        </ul>
      )}
      {analysis.visibleText.length > 0 && (
        <p className="text-muted mt-3 text-xs">
          <span className="text-foreground font-semibold">Text in it:</span>{' '}
          {analysis.visibleText.map(t => `“${t}”`).join(', ')}
        </p>
      )}
      {analysis.uncertain.length > 0 && (
        <p className="text-muted mt-2 text-xs">
          <span className="text-foreground font-semibold">
            Can&rsquo;t tell from the {kind}:
          </span>{' '}
          {analysis.uncertain.join('; ')}. Add it to the notes and write again
          to use it.
        </p>
      )}
    </section>
  )
}

/**
 * One platform's post, editable field by field, with its length and
 * problems, and Regenerate for its hook, its body or the whole post.
 */
function PostEditor({
  draft,
  choice,
  kind,
  warning,
  problem,
  disabled,
  rewriting,
  rewritten,
  onRewrite,
  onUndo,
  onChange
}: {
  draft: MediaPostDraft
  choice: PlatformChoice
  kind: UploadKind
  warning: string | null
  problem: string | null
  disabled: boolean
  /** The part being written again now, if any. */
  rewriting: MediaPostPart | null
  /** The part last written again, while Undo can put it back. */
  rewritten: MediaPostPart | null
  onRewrite: (part: MediaPostPart) => void
  onUndo: () => void
  onChange: (next: MediaPostDraft) => void
}) {
  const id = useId()
  // While a part is written again, that part (or, for the whole post,
  // every field) waits for it; the other fields can still be edited.
  const busy = rewriting !== null
  const fieldsLocked = disabled || rewriting === 'post'
  const hookLocked = fieldsLocked || rewriting === 'hook'
  const bodyLocked = fieldsLocked || rewriting === 'body'
  const partButton = (part: 'hook' | 'body', label: string) => (
    <button
      type="button"
      onClick={() => onRewrite(part)}
      disabled={disabled || busy}
      className={cn(
        'text-accent hover:bg-accent/10 inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS_RING
      )}
    >
      {rewriting === part ? (
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
      ) : (
        <RefreshCw aria-hidden className="h-3 w-3" />
      )}
      {rewriting === part ? 'Writing…' : label}
    </button>
  )
  const spec = FORMATS[draft.formatId]
  const isShort = spec.structure === 'script'
  const [tagText, setTagText] = useState(() =>
    draft.hashtags.map(t => `#${t}`).join(' ')
  )
  const set = (patch: Partial<MediaPostDraft>) =>
    onChange({ ...draft, ...patch })
  const count = formatCharCount(draft.formatId, postTextOf(draft))
  const max = spec.limits.maxChars
  const fold = spec.limits.foldChars
  const hookLength = draft.hook.trim().length
  // Instagram's and YouTube's comment field is a note for the author, never posted.
  const commentPosted =
    spec.links.fallback !== 'link_in_bio' && choice.id !== 'linkedin'
  const kindLabel =
    kind === 'video'
      ? choice.id === 'instagram' || choice.id === 'facebook'
        ? 'Reel'
        : choice.id === 'youtube'
          ? 'Short'
          : 'Video post'
      : 'Image post'

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        'border-border bg-surface rounded-2xl border shadow-xs',
        problem && 'border-rose-500/40'
      )}
    >
      <header className="border-border flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
        <PlatformMark platform={choice.id} className="h-6 w-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3
            id={`${id}-title`}
            className="text-foreground text-sm font-semibold"
          >
            {choice.label}
          </h3>
          <p className="text-muted text-[11px]">
            {kindLabel}
            {choice.accountName ? ` · ${choice.accountName}` : ''}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onRewrite('post')}
          disabled={disabled || busy}
          loading={rewriting === 'post'}
          title={`Write this ${choice.label} post again from your ${kind}. The other posts stay as they are.`}
        >
          {rewriting !== 'post' && <Wand2 aria-hidden className="h-3.5 w-3.5" />}
          {rewriting === 'post' ? 'Writing…' : 'Regenerate post'}
        </Button>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
            count > max
              ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : 'bg-background text-muted'
          )}
          title={`${spec.label}s take up to ${max.toLocaleString()} characters`}
        >
          {count.toLocaleString()} / {max.toLocaleString()}
        </span>
      </header>
      <div className="space-y-3 p-4">
        {rewritten && !busy && (
          <p
            role="status"
            className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          >
            <CheckCircle2
              aria-hidden
              className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
            />
            {REWRITTEN_LABEL[rewritten]}
            <button
              type="button"
              onClick={onUndo}
              disabled={disabled}
              className={cn(
                'text-foreground inline-flex cursor-pointer items-center gap-1 rounded font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-50',
                FOCUS_RING
              )}
            >
              <Undo2 aria-hidden className="h-3 w-3" />
              Undo
            </button>
          </p>
        )}
        {(problem || warning) && (
          <div className="space-y-1.5">
            {problem && (
              <p className="flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-300">
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                {problem}
              </p>
            )}
            {warning && (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                {warning}
              </p>
            )}
          </div>
        )}
        {isShort && (
          <div>
            <label htmlFor={`${id}-title-field`} className={LABEL}>
              Title
            </label>
            <TextField
              id={`${id}-title-field`}
              value={draft.title}
              maxLength={VIDEO_TITLE_MAX}
              disabled={fieldsLocked}
              onChange={e => set({ title: e.target.value })}
            />
          </div>
        )}
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <label htmlFor={`${id}-hook`} className={cn(LABEL, 'mb-0')}>
              Hook
              {fold ? (
                <span
                  className={cn(
                    'ml-1.5 font-normal',
                    hookLength > fold
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-muted'
                  )}
                >
                  {hookLength}/{fold} before &ldquo;more&rdquo;
                </span>
              ) : null}
            </label>
            {partButton('hook', 'Regenerate hook')}
          </div>
          <TextArea
            id={`${id}-hook`}
            value={draft.hook}
            rows={2}
            disabled={hookLocked}
            aria-busy={rewriting === 'hook' || rewriting === 'post' || undefined}
            onChange={e => set({ hook: e.target.value })}
            maxRows={14}
          />
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <label htmlFor={`${id}-body`} className={cn(LABEL, 'mb-0')}>
              {isShort ? 'Description' : 'Body'}
            </label>
            {partButton('body', 'Regenerate body')}
          </div>
          <TextArea
            id={`${id}-body`}
            value={draft.body}
            rows={5}
            disabled={bodyLocked}
            aria-busy={rewriting === 'body' || rewriting === 'post' || undefined}
            onChange={e => set({ body: e.target.value })}
            maxRows={14}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-cta`} className={LABEL}>
              Call to action
            </label>
            <TextArea
              id={`${id}-cta`}
              value={draft.cta}
              rows={2}
              disabled={fieldsLocked}
              onChange={e => set({ cta: e.target.value })}
              maxRows={14}
            />
          </div>
          <div>
            <label htmlFor={`${id}-tags`} className={LABEL}>
              Hashtags
              <span className="text-muted ml-1.5 font-normal">
                {spec.hashtags === 'voice'
                  ? 'as your voice uses them'
                  : spec.hashtags.max === 0
                    ? 'none here'
                    : `up to ${spec.hashtags.max}`}
              </span>
            </label>
            <TextArea
              id={`${id}-tags`}
              value={tagText}
              rows={2}
              disabled={fieldsLocked}
              placeholder="#example #another"
              onChange={e => {
                setTagText(e.target.value)
                set({
                  // "#AI#SaaS" is two tags, not one glued "#AISaaS".
                  hashtags: e.target.value.split(/[\s,;#]+/).filter(Boolean)
                })
              }}
              maxRows={14}
            />
          </div>
        </div>
        <details className="group">
          <summary className="text-muted hover:text-foreground cursor-pointer text-xs font-medium select-none">
            {spec.commentLabel}
            {kind === 'image' ? ' and alt text' : ''}
            {draft.firstComment.trim() ? ' · filled in' : ''}
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor={`${id}-comment`} className={LABEL}>
                {spec.commentLabel}
                <span className="text-muted ml-1.5 font-normal">
                  {commentPosted
                    ? 'published with the post'
                    : 'kept for you, not published'}
                </span>
              </label>
              <TextArea
                id={`${id}-comment`}
                value={draft.firstComment}
                rows={2}
                disabled={fieldsLocked}
                onChange={e => set({ firstComment: e.target.value })}
                maxRows={14}
              />
            </div>
            {kind === 'image' && (
              <div>
                <label htmlFor={`${id}-alt`} className={LABEL}>
                  Alt text{' '}
                  <span className="text-muted font-normal">
                    for screen readers
                  </span>
                </label>
                <TextArea
                  id={`${id}-alt`}
                  value={draft.altText}
                  rows={2}
                  maxLength={1000}
                  disabled={fieldsLocked}
                  onChange={e => set({ altText: e.target.value })}
                  maxRows={14}
                />
              </div>
            )}
          </div>
        </details>
        {!captionOf(draft) && (
          <p className="text-muted text-xs">
            Not written yet: write it here, or choose Regenerate post.
          </p>
        )}
      </div>
    </section>
  )
}

/** What happened to each post, with a way to open it. */
function ResultsPanel({
  results,
  intent,
  platforms,
  onAnother
}: {
  results: CreatedPostResult[]
  intent: 'publish' | 'schedule' | 'draft'
  platforms: PlatformChoice[]
  onAnother: () => void
}) {
  const label = (id: PlatformId) =>
    platforms.find(p => p.id === id)?.label ?? id
  const statusOf = (r: CreatedPostResult) => {
    if (r.error) return { tone: 'error' as const, text: r.error }
    const p: PublicationSummary | null = r.publication
    if (!p)
      return {
        tone: 'ok' as const,
        text: 'Saved as a draft to review under Posts.'
      }
    if (p.status === 'published')
      return { tone: 'ok' as const, text: 'Published.' }
    if (p.status === 'scheduled' && intent === 'schedule') {
      return {
        tone: 'ok' as const,
        text: `Scheduled for ${new Date(p.scheduledAt).toLocaleString(
          undefined,
          {
            dateStyle: 'medium',
            timeStyle: 'short'
          }
        )}.`
      }
    }
    if (p.status === 'scheduled') {
      return {
        tone: 'warn' as const,
        text: p.error ? `Will retry: ${p.error}` : 'Queued.'
      }
    }
    if (p.status === 'publishing')
      return { tone: 'ok' as const, text: 'Publishing…' }
    return { tone: 'error' as const, text: p.error ?? 'Publishing failed.' }
  }
  return (
    <section className="border-border bg-surface mx-auto max-w-2xl rounded-2xl border p-5 shadow-xs">
      <h2 className="text-foreground mb-4 flex items-center gap-2 text-base font-semibold">
        <CheckCircle2
          aria-hidden
          className="h-5 w-5 text-emerald-600 dark:text-emerald-400"
        />
        {intent === 'draft'
          ? 'Your posts are saved'
          : intent === 'schedule'
            ? 'Your posts are scheduled'
            : 'Your posts are on their way'}
      </h2>
      <ul className="divide-border divide-y">
        {results.map(r => {
          const status = statusOf(r)
          return (
            <li
              key={r.draftId}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <PlatformMark
                platform={r.platform}
                className="h-5 w-5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium">
                  {label(r.platform)}
                </p>
                <p
                  className={cn(
                    'text-xs',
                    status.tone === 'error'
                      ? 'text-rose-700 dark:text-rose-300'
                      : status.tone === 'warn'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-muted'
                  )}
                >
                  {status.text}
                </p>
              </div>
              {r.publication?.postUrl && (
                <a
                  href={r.publication.postUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName({
                    variant: 'secondary',
                    size: 'sm'
                  })}
                >
                  View <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                </a>
              )}
              <Link
                href={`/posts/${r.draftId}`}
                className={buttonClassName({
                  variant: 'secondary',
                  size: 'sm'
                })}
              >
                Open post
              </Link>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAnother}>
          <Upload aria-hidden className="h-4 w-4" />
          Create another
        </Button>
        <Link
          href="/posts"
          className={buttonClassName({ variant: 'secondary' })}
        >
          All posts
        </Link>
      </div>
    </section>
  )
}
