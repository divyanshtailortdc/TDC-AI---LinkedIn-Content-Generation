'use client'

import { Download, Film, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

type UploadedVideo = {
  videoUrl: string
  downloadUrl: string
  width: number
  height: number
  durationSeconds: number
  byteSize: number | null
  fileName: string | null
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`

/**
 * The video a post was made from (Create from media), in place of the image
 * tools and the video recorder: it goes out as uploaded, so it is only shown
 * and offered for download.
 */
export function UploadedVideoPanel({
  postId,
  locked
}: {
  postId: string
  /** Why the post can no longer change (published, posted); null when it can. */
  locked: string | null
}) {
  const [video, setVideo] = useState<UploadedVideo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Keyed by post on the page, so a new post starts with empty state.
    const controller = new AbortController()
    fetch(`/api/posts/${postId}/uploaded-video`, {
      signal: controller.signal,
      cache: 'no-store'
    })
      .then(async res => {
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          throw new Error(data?.error || 'The video could not be loaded.')
        }
        setVideo(data.video as UploadedVideo)
      })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : 'The video could not be loaded.'
          )
        }
      })
    return () => controller.abort()
  }, [postId])

  return (
    <div className="border-border bg-surface space-y-3 rounded-2xl border p-4 shadow-sm">
      <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
        <Film aria-hidden className="text-accent h-4 w-4" />
        Your video
      </p>
      {error ? (
        <p className="text-sm text-rose-700 dark:text-rose-300" role="alert">
          {error}
        </p>
      ) : !video ? (
        <div className="text-muted flex h-40 items-center justify-center gap-2 text-sm">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Loading the video…
        </div>
      ) : (
        <>
          <video
            src={video.videoUrl}
            controls
            playsInline
            preload="metadata"
            className="max-h-[28rem] w-full rounded-xl bg-black object-contain"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-muted min-w-0 truncate">
              {[
                video.fileName,
                video.width && video.height
                  ? `${video.width}×${video.height}`
                  : null,
                video.durationSeconds ? clock(video.durationSeconds) : null
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <a
              href={video.downloadUrl}
              className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium"
            >
              <Download aria-hidden className="h-3.5 w-3.5" />
              Download
            </a>
          </div>
          <p className="text-muted text-xs">
            {locked
              ? `${locked}.`
              : 'This post goes out with the video you uploaded, as it is.'}
          </p>
        </>
      )}
    </div>
  )
}
