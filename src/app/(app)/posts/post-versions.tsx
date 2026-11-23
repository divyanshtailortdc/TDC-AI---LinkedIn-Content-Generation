'use client'

import { Pagination } from '@/components/pagination'
import { cn } from '@/lib/cn'
import { showToast } from '@/components/toast-notification'
import { formatAbsoluteDateTime, formatRelativeDate } from '@/lib/format-date'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import { ChevronDown, History, Loader2, RotateCcw, Wand2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { loadPostVersions, regeneratePost, restorePostVersion } from './actions'
import type { PostDetail } from './posts-client'

/**
 * "Regenerate": a new version of the post from its idea, with what the
 * reviewer wants changed, or just another take. The version it replaces is
 * kept under Earlier versions.
 */
export function RegenerateControl({
  post,
  onDone,
  disabled,
  confirmStart,
  onBusyChange,
  buttonClassName
}: {
  post: PostDetail
  onDone: (post: PostDetail) => void
  disabled?: boolean
  /** Asked before writing; false leaves the post as it is. */
  confirmStart?: () => boolean
  /** Told when writing starts and when it ends, however it ends. */
  onBusyChange?: (busy: boolean) => void
  /** The button's look, to match the toolbar it sits in. */
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [running, setRunning] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!post.ideaId) return null

  const run = async () => {
    // Declined: the panel stays open with the instruction.
    if (confirmStart && !confirmStart()) return
    setOpen(false)
    setRunning(true)
    onBusyChange?.(true)
    try {
      const res = await regeneratePost(post.id, instruction)
      if (res.success && res.post) {
        onDone(res.post)
        setInstruction('')
        showToast({
          type: 'success',
          title: 'New version written',
          message: 'The previous version is under Earlier versions.'
        })
      } else {
        showToast({
          type: 'error',
          title: 'No new version',
          message: (!res.success && res.error) || 'The new version could not be written.'
        })
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'No new version',
        message: err?.message || 'The new version could not be written.'
      })
    } finally {
      setRunning(false)
      onBusyChange?.(false)
    }
  }

  return (
    // Below sm the panel anchors to the toolbar row (relative there), not the
    // button, so it stays on a phone's screen.
    <div className="sm:relative" ref={wrapper}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled || running}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          buttonClassName ??
            'text-muted hover:text-foreground inline-flex cursor-pointer items-center gap-2 text-sm font-medium',
          'disabled:cursor-wait disabled:opacity-60'
        )}
      >
        {running ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wand2 aria-hidden className="h-3.5 w-3.5" />
        )}
        <span>{running ? 'Writing…' : 'Regenerate'}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Regenerate this post"
          className="border-border bg-surface absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border p-3 shadow-lg"
        >
          <label
            htmlFor={`${panelId}-instruction`}
            className="text-foreground mb-1 block text-xs font-semibold"
          >
            What to change <span className="text-muted font-normal">· Optional</span>
          </label>
          <textarea
            id={`${panelId}-instruction`}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            maxLength={1000}
            rows={3}
            autoFocus
            placeholder="e.g. Shorter. Open with the customer story. Less salesy."
            title="Leave it empty for a different take on the same idea. The image stays as it is."
            className="border-border bg-surface-hover text-foreground focus:border-accent w-full resize-none rounded-lg border p-2 text-xs leading-relaxed outline-none"
          />
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted hover:text-foreground h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void run()}
              className="bg-accent text-background hover:bg-accent-hover h-7 cursor-pointer rounded-lg px-3 text-xs font-semibold"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type Version = {
  id: string
  number: number
  replacedBy: string
  instruction: string | null
  hook: string
  body: string
  charCount: number
  createdAt: Date | string
}

function replacedLabel(version: Version): string {
  if (version.replacedBy === 'regenerate') {
    return version.instruction
      ? `Before regenerating: “${version.instruction}”`
      : 'Before regenerating'
  }
  if (version.replacedBy === 'restore') return 'Before restoring an earlier version'
  return 'Before your edit'
}

/** The post's earlier versions, each of which can be put back. */
export function VersionHistory({
  post,
  onRestored,
  disabled,
  confirmRestore,
  onBusyChange
}: {
  post: PostDetail
  onRestored: (post: PostDetail) => void
  disabled?: boolean
  /** Asked before restoring a version; false leaves the post as it is. */
  confirmRestore?: (versionNumber: number) => boolean
  /** Told when a restore starts and when it ends, however it ends. */
  onBusyChange?: (busy: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)
  // Raised by Try again, to load the versions once more.
  const [attempt, setAttempt] = useState(0)
  const count = post.versionCount ?? 0
  // Ten versions at a time, newest first; a new version starts at page 1.
  const [page, setPage] = useState(1)
  const sectionRef = useRef<HTMLElement>(null)

  // Loaded when opened, and again when the post gains a version while open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    loadPostVersions(post.id).then(
      res => {
        if (cancelled) return
        if (res.success) {
          setVersions(res.versions)
          setPage(1)
          setError(null)
        } else setError(res.error || 'Could not load earlier versions.')
      },
      () => {
        if (!cancelled) setError('Could not load earlier versions.')
      }
    )
    return () => {
      cancelled = true
    }
  }, [open, count, post.id, attempt])

  if (count === 0) return null

  const { rows: pageVersions, pageInfo } = paginate(
    versions ?? [],
    page,
    PAGE_SIZE
  )

  const restore = async (version: Version) => {
    if (confirmRestore && !confirmRestore(version.number)) return
    setRestoring(version.id)
    onBusyChange?.(true)
    try {
      const res = await restorePostVersion(post.id, version.id)
      if (res.success && res.post) {
        onRestored(res.post)
        showToast({
          type: 'success',
          title: `Version ${version.number} restored`,
          message: 'The version it replaced is kept too.'
        })
      } else {
        showToast({
          type: 'error',
          title: 'Not restored',
          message: (!res.success && res.error) || 'The version could not be restored.'
        })
      }
    } finally {
      setRestoring(null)
      onBusyChange?.(false)
    }
  }

  return (
    <section ref={sectionRef} className="border-border bg-surface rounded-2xl border shadow-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="text-foreground hover:bg-surface-hover/50 focus-visible:ring-foreground/30 flex w-full cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <History aria-hidden className="text-muted h-4 w-4" />
        Earlier versions
        <span className="border-border bg-surface-hover text-muted rounded-full border px-2 py-px text-[11px] font-semibold tabular-nums">
          {count}
        </span>
        <ChevronDown
          aria-hidden
          className={`text-muted ml-auto h-4 w-4 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-border border-t px-4 py-3">
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-rose-600 dark:text-rose-400">{error}</span>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setAttempt(n => n + 1)
                }}
                className="text-foreground focus-visible:ring-foreground/30 cursor-pointer rounded-md font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                Try again
              </button>
            </div>
          )}
          {!versions && !error && (
            <p className="text-muted inline-flex items-center gap-1.5 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </p>
          )}
          {versions && (
            <ol className="space-y-3">
              {pageVersions.map(version => (
                <li key={version.id} className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-foreground text-xs font-semibold">
                      Version {version.number}
                    </span>
                    <span
                      className="text-muted text-xs"
                      title={formatAbsoluteDateTime(version.createdAt)}
                    >
                      {formatRelativeDate(version.createdAt)} · {version.charCount.toLocaleString()} chars
                    </span>
                    <button
                      type="button"
                      onClick={() => void restore(version)}
                      disabled={disabled || restoring !== null}
                      aria-label={`Restore version ${version.number}`}
                      className="text-accent focus-visible:ring-foreground/30 ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md text-xs font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
                    >
                      {restoring === version.id ? (
                        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw aria-hidden className="h-3 w-3" />
                      )}
                      Restore
                    </button>
                  </div>
                  <p className="text-muted mt-0.5 text-xs">{replacedLabel(version)}</p>
                  <p className="text-foreground/80 mt-1 line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap wrap-break-word">
                    <span className="font-semibold">{version.hook}</span>
                    {version.body ? `\n${version.body}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {versions && pageInfo.pageCount > 1 && (
            <div className="mt-3">
              <Pagination
                {...pageInfo}
                noun="versions"
                onPageChange={setPage}
                scrollTarget={sectionRef}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
