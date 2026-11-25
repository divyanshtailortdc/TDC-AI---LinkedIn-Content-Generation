'use client'

import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import {
  describeVideoSpec,
  videoSpecOf,
  type VideoFormatId
} from '@/lib/video/formats'
import type { VideoState, VideoView } from '@/lib/video/post-video'
import {
  AlertTriangle,
  Clapperboard,
  Download,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A Reel's or Short's video on the post page, in place of the image tools:
 * Record video (recorded from the script on the server), progress while it
 * is made, then the video to watch, download or record again. The state
 * lives on the server (GET /api/posts/[id]/video), so leaving the page does
 * not stop a recording, and coming back picks it up.
 */

const POLL_MS = 5_000
/** What a recording usually takes, for the progress bar. */
const TYPICAL_SECONDS = 60

const primaryButton =
  'bg-accent text-background hover:bg-accent-hover inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

export function VideoPanel({
  postId,
  formatId,
  locked
}: {
  postId: string
  formatId: VideoFormatId
  /** Why the post can no longer change (published, posted); null when it can. */
  locked: string | null
}) {
  const spec = videoSpecOf(formatId)
  const [state, setState] = useState<VideoState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  // Set the moment Record video is clicked, before React re-renders, so a
  // second click cannot send a second request.
  const startingRef = useRef(false)

  // The state as the server has it; null when the request was stopped.
  const fetchState = useCallback(
    async (
      signal?: AbortSignal
    ): Promise<{ state: VideoState } | { error: string } | null> => {
      try {
        const res = await fetch(`/api/posts/${postId}/video`, {
          signal,
          cache: 'no-store'
        })
        const data = await res.json().catch(() => null)
        if (signal?.aborted) return null
        if (!res.ok || !data?.success) {
          return { error: data?.error || 'The video could not be loaded.' }
        }
        return { state: data.state as VideoState }
      } catch (err) {
        if (signal?.aborted) return null
        return {
          error:
            err instanceof Error
              ? err.message
              : 'The video could not be loaded.'
        }
      }
    },
    [postId]
  )
  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchState>>) => {
      if (!result) return
      if ('error' in result) {
        setLoadError(result.error)
      } else {
        setLoadError(null)
        setState(result.state)
      }
    },
    []
  )
  const load = useCallback(
    (signal?: AbortSignal) => fetchState(signal).then(apply),
    [fetchState, apply]
  )

  // First load, then a poll while a video is being made. Counted, so a poll
  // that failed (state unchanged) still schedules the next one.
  const running = state?.running ?? null
  const [polls, setPolls] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void fetchState(controller.signal).then(apply)
    return () => controller.abort()
  }, [fetchState, apply])
  useEffect(() => {
    if (!running) return
    const controller = new AbortController()
    const poll = setTimeout(
      () =>
        void load(controller.signal).finally(() => {
          if (!controller.signal.aborted) setPolls(n => n + 1)
        }),
      POLL_MS
    )
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      controller.abort()
      clearTimeout(poll)
      clearInterval(tick)
    }
  }, [running, polls, load])

  // A video that lands while the page is open says so once.
  const announced = useRef<string | null>(null)
  const readyId = state?.ready?.id ?? null
  const failedId = state?.failed?.id ?? null
  const watched = useRef<string | null>(null)
  useEffect(() => {
    if (running) watched.current = running.id
  }, [running])
  useEffect(() => {
    const id = watched.current
    if (!id || running || announced.current === id) return
    announced.current = id
    if (readyId === id) {
      showToast({
        type: 'success',
        title: 'Video ready',
        message: 'Watch it, then download it to post.'
      })
    } else if (failedId === id) {
      showToast({
        type: 'error',
        title: 'Video not recorded',
        message: state?.failed?.error || 'Try again.'
      })
    }
  }, [running, readyId, failedId, state?.failed?.error])

  const start = async () => {
    if (!state || startingRef.current) return
    startingRef.current = true
    setStarting(true)
    try {
      const res = await fetch(`/api/posts/${postId}/video`, {
        method: 'POST'
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.success) {
        // Started: the poll follows it.
      } else if (data?.alreadyRunning) {
        // Started elsewhere (another tab): follow that one.
        showToast({
          type: 'info',
          title: 'Already recording',
          message: data.error
        })
      } else {
        showToast({
          type: 'error',
          title: 'Video not started',
          message: data?.error || 'The video could not be started.'
        })
      }
    } catch {
      showToast({
        type: 'error',
        title: 'Video not started',
        message: 'Check your connection and try again.'
      })
    } finally {
      startingRef.current = false
      setStarting(false)
      await load()
    }
  }

  const blocked = locked ?? state?.locked ?? null
  const ready = state?.ready ?? null
  const failed = state?.failed ?? null
  const canRecord =
    Boolean(state) &&
    !state?.unavailable &&
    !blocked &&
    !state?.noScript &&
    !running

  return (
    <div className="border-border bg-surface space-y-4 rounded-2xl border p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
          <Clapperboard className="text-accent h-3.5 w-3.5" />
          {spec.label} video
        </span>
        <span className="text-muted bg-surface-hover rounded-full px-2 py-0.5 text-[10px] font-medium">
          {describeVideoSpec(spec)}
        </span>
      </div>

      {!state && !loadError && (
        <div className="text-muted flex items-center gap-2 py-6 text-xs">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading video…
        </div>
      )}
      {loadError && !state && (
        <Notice tone="error">
          {loadError}{' '}
          <button
            type="button"
            onClick={() => void load()}
            className="font-semibold underline"
          >
            Retry
          </button>
        </Notice>
      )}

      {state && (
        <>
          {running ? (
            <Progress view={running} now={now} />
          ) : ready ? (
            <Player view={ready} label={spec.label} />
          ) : (
            <div className="bg-surface-hover text-muted mx-auto flex aspect-9/16 max-h-80 flex-col items-center justify-center gap-2 rounded-xl px-6 text-center text-xs">
              <Clapperboard className="h-6 w-6 opacity-50" />
              No video yet. Record a vertical video of this script, as slides
              in your brand and the look of your posts.
            </div>
          )}

          {failed && !running && (
            <Notice tone="error">
              <span className="font-semibold">
                The last video was not recorded.
              </span>{' '}
              {failed.error}
            </Notice>
          )}
          {running && ready && (
            <p className="text-muted text-[11px]">
              Your current video stays until the new one is ready.
            </p>
          )}
          {state.unavailable && (
            <Notice tone="muted">{state.unavailable}</Notice>
          )}
          {blocked && (
            <Notice tone="muted">
              {blocked}. Its video can no longer change.
            </Notice>
          )}
          {state.noScript && !blocked && (
            <Notice tone="muted">
              Write the script first: the video is made from its spoken words.
            </Notice>
          )}

          {ready?.downloadUrl && !running && (
            <a
              href={ready.downloadUrl}
              className={cn(secondaryButton, 'w-full')}
            >
              <Download className="h-3.5 w-3.5" />
              Download MP4
            </a>
          )}

          {canRecord && (
            <button
              type="button"
              onClick={() => void start()}
              disabled={starting}
              className={cn(ready ? secondaryButton : primaryButton, 'w-full')}
            >
              {starting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : ready || failed ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Clapperboard className="h-3.5 w-3.5" />
              )}
              {starting
                ? 'Starting…'
                : ready
                  ? 'Record again'
                  : failed
                    ? 'Try again'
                    : 'Record video'}
            </button>
          )}

          {ready && !running && (
            <p className="text-muted text-[11px] leading-relaxed">
              {`Recorded from this script${ready.lookFrom ? `, in the look of your ${ready.lookFrom} posts` : ''}. Edit the script, then Record again to change it. `}
              Approve the post, then Publish posts this video with its caption
              to {spec.label}; or download it and post it yourself.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Progress({ view, now }: { view: VideoView; now: number }) {
  const elapsed = Math.max(0, (now - Date.parse(view.startedAt)) / 1000)
  // No percentage is reported: an estimate from the usual time, which slows
  // down near the end rather than claiming to be done.
  const estimate = Math.min(
    95,
    Math.round((1 - Math.exp(-elapsed / TYPICAL_SECONDS)) * 100)
  )
  return (
    <div className="bg-surface-hover mx-auto flex aspect-9/16 max-h-80 flex-col items-center justify-center gap-3 rounded-xl px-6 text-center">
      <Loader2 className="text-accent h-7 w-7 animate-spin" />
      <div>
        <p className="text-foreground text-sm font-semibold">
          Recording your video…
        </p>
        <p className="text-muted mt-1 text-xs">
          {clock(elapsed)} elapsed · usually about a minute
        </p>
      </div>
      <div
        className="bg-border h-1.5 w-full max-w-48 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="Estimated progress"
        aria-valuenow={estimate}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="bg-accent h-full rounded-full transition-[width] duration-1000"
          style={{ width: `${estimate}%` }}
        />
      </div>
      <p className="text-muted text-[11px]">
        You can leave this page; it keeps going.
      </p>
    </div>
  )
}

function Player({ view, label }: { view: VideoView; label: string }) {
  return (
    <video
      key={view.id}
      src={view.videoUrl ?? undefined}
      controls
      playsInline
      preload="metadata"
      aria-label={`${label} video, version ${view.version}`}
      className="mx-auto aspect-9/16 max-h-112 rounded-xl bg-black"
    />
  )
}

function Notice({
  tone,
  children
}: {
  tone: 'error' | 'muted'
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed',
        tone === 'error'
          ? 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-300'
          : 'border-border bg-surface-hover text-muted'
      )}
    >
      {tone === 'error' && (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0">{children}</span>
    </div>
  )
}
