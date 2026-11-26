'use client'

import { Button } from '@/components/button'
import { markDataChanged } from '@/components/refresh-on-back'
import {
  BLOG_GENERATION_STAGES,
  BLOG_STAGE_LABELS,
  type BlogBrief,
  type BlogGenerationStage,
  type BlogGenerationStatus
} from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { AlertTriangle, Check, Circle, Loader2, RotateCcw } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { fetchBlogStatus, retryBlogGeneration } from '../actions'

/** How often the page asks where a generation stands. */
const POLL_MS = 3000

type Progress = {
  status: BlogGenerationStatus
  stage: BlogGenerationStage | null
  error: string | null
  stale: boolean
}

/**
 * A blog being written: its stages as they pass, the time so far, and once
 * it is done, `onReady`. A failed or stopped generation can be tried again
 * from here.
 */
export function BlogProgress({
  blogId,
  brief,
  initial,
  startedAt,
  onReady,
  onDismiss,
  compact = false,
  sourcesReused = false
}: {
  blogId: string
  brief: BlogBrief
  initial: Progress
  startedAt: string | null
  onReady: () => void
  /**
   * For a regeneration of a blog that has text: leave a failed or stopped
   * run and go back to the text as it was.
   */
  onDismiss?: () => void
  /** Inside the editor's column rather than alone on the page. */
  compact?: boolean
  /** A regeneration writing from the sources it found before: no research. */
  sourcesReused?: boolean
}) {
  const [progress, setProgress] = useState<Progress>(initial)
  const [since, setSince] = useState(startedAt)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [retrying, startRetry] = useTransition()
  const running = progress.status === 'generating' && !progress.stale

  useEffect(() => {
    if (!running) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const result = await fetchBlogStatus(blogId).catch(() => null)
      if (cancelled) return
      if (result?.success) {
        const next = {
          status: result.status,
          stage: result.stage,
          error: result.error,
          stale: result.stale
        }
        setProgress(next)
        if (next.status === 'ready') {
          onReady()
          return
        }
        if (next.status !== 'generating' || next.stale) return
      }
      timer = setTimeout(poll, POLL_MS)
    }
    timer = setTimeout(poll, POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [running, blogId, onReady])

  const retry = () =>
    startRetry(async () => {
      setRetryError(null)
      const result = await retryBlogGeneration(blogId)
      if (!result.success) {
        setRetryError(result.error)
        return
      }
      markDataChanged()
      setSince(new Date().toISOString())
      setProgress({
        status: 'generating',
        stage: null,
        error: null,
        stale: false
      })
    })

  const skipped = (stage: BlogGenerationStage) =>
    (stage === 'research' && (sourcesReused || !brief.research)) ||
    (stage === 'knowledge' && (sourcesReused || !brief.knowledge))
  const current = progress.stage
    ? BLOG_GENERATION_STAGES.indexOf(progress.stage)
    : -1

  return (
    <div className={compact ? '' : 'mx-auto max-w-xl py-10'}>
      <div className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
        {running ? (
          <>
            <h2 className="text-foreground text-base font-semibold">
              {compact
                ? 'Writing a new version'
                : `Writing your ${brief.topic ? `piece on “${brief.topic}”` : 'blog'}`}
            </h2>
            <p className="text-muted mt-1 text-sm">
              This usually takes 1-3 minutes. You can leave this page; the blog
              keeps generating.
            </p>
            <ol className="mt-5 space-y-3" aria-live="polite">
              {BLOG_GENERATION_STAGES.map((stage, index) => {
                const state = skipped(stage)
                  ? 'skipped'
                  : index < current
                    ? 'done'
                    : index === current
                      ? 'current'
                      : 'waiting'
                return (
                  <li key={stage} className="flex items-center gap-3 text-sm">
                    {state === 'done' && (
                      <Check aria-hidden className="h-4 w-4 text-emerald-600" />
                    )}
                    {state === 'current' && (
                      <Loader2
                        aria-hidden
                        className="text-brand h-4 w-4 animate-spin"
                      />
                    )}
                    {(state === 'waiting' || state === 'skipped') && (
                      <Circle aria-hidden className="text-border h-4 w-4" />
                    )}
                    <span
                      className={cn(
                        state === 'current'
                          ? 'text-foreground font-medium'
                          : 'text-muted',
                        state === 'skipped' && 'line-through'
                      )}
                    >
                      {BLOG_STAGE_LABELS[stage]}
                      {state === 'skipped'
                        ? sourcesReused
                          ? ' (reused)'
                          : ' (off)'
                        : ''}
                    </span>
                  </li>
                )
              })}
            </ol>
            <Elapsed since={since} />
          </>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <AlertTriangle
                aria-hidden
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
              />
              <div>
                <h2 className="text-foreground text-base font-semibold">
                  {progress.stale
                    ? 'This generation stopped before it finished.'
                    : 'This blog could not be written.'}
                </h2>
                <p className="text-muted mt-1 text-sm">
                  {progress.stale
                    ? 'The server stopped while writing it. Nothing was lost; start it again.'
                    : progress.error ||
                      'Something went wrong while writing it.'}
                </p>
              </div>
            </div>
            {retryError && (
              <p
                role="alert"
                className="mt-4 text-sm text-rose-700 dark:text-rose-400"
              >
                {retryError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              {onDismiss && (
                <Button
                  variant="secondary"
                  onClick={onDismiss}
                  disabled={retrying}
                >
                  Back to the current version
                </Button>
              )}
              <Button onClick={retry} loading={retrying}>
                <RotateCcw aria-hidden className="h-4 w-4" />
                Try again
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Elapsed({ since }: { since: string | null }) {
  const mounted = useHasMounted()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  if (!mounted || !since) return null
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(since).getTime()) / 1000)
  )
  return (
    <p className="text-muted mt-5 text-xs tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} so far
    </p>
  )
}
