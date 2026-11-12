'use client'

import {
  FORMATS,
  PLATFORMS,
  hashtagLine,
  isFormatId,
  splitThread,
  toPlainText,
  videoScriptOf,
  type FormatId
} from '@/lib/formats'
import {
  Bookmark,
  Clapperboard,
  Heart,
  ImageOff,
  MessageCircle,
  Repeat2,
  Send,
  ThumbsUp,
  ZoomIn
} from 'lucide-react'
import { useState } from 'react'

/**
 * How a post in any format other than LinkedIn reads where it will be
 * published: an X post or thread, a Threads post, a Facebook post or an
 * Instagram caption under its image. Plain renderings, close enough to judge
 * length, the fold and the shape; LinkedIn keeps its own preview.
 */

interface VariantPreviewProps {
  formatId: string
  authorName: string
  authorInitials: string
  hook: string
  body: string
  cta?: string | null
  hashtags?: string[]
  firstComment?: string | null
  payload?: Record<string, unknown> | null
  mediaUrl?: string | null
  mediaAltText?: string | null
  onMediaClick?: () => void
}

function Avatar({ initials, round = true }: { initials: string; round?: boolean }) {
  return (
    <div
      className={`bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 flex h-10 w-10 shrink-0 items-center justify-center text-sm font-bold ${round ? 'rounded-full' : 'rounded-lg'}`}
    >
      {initials}
    </div>
  )
}

function Media({
  url,
  alt,
  onClick,
  square
}: {
  url?: string | null
  alt?: string | null
  onClick?: () => void
  square?: boolean
}) {
  if (!url) return null
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`group relative block w-full overflow-hidden rounded-xl border border-neutral-200 dark:border-border ${onClick ? 'cursor-zoom-in' : 'cursor-default'}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt || 'Post image'}
        className={`w-full ${square ? 'aspect-square object-cover' : 'h-auto'}`}
      />
      {onClick && (
        <ZoomIn className="absolute right-2 bottom-2 h-5 w-5 rounded-full bg-black/50 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  )
}

/** Text with a "more" fold at `fold` characters, as the platform shows it. */
function Folded({ text, fold }: { text: string; fold: number | null }) {
  const [open, setOpen] = useState(false)
  if (!fold || text.length <= fold || open) {
    return <span className="whitespace-pre-wrap">{text}</span>
  }
  return (
    <span className="whitespace-pre-wrap">
      {text.slice(0, fold).trimEnd()}…{' '}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer font-semibold text-neutral-500 hover:underline"
      >
        more
      </button>
    </span>
  )
}

function joined(parts: Array<string | null | undefined>) {
  return parts
    .map(p => toPlainText(p))
    .filter(Boolean)
    .join('\n\n')
}

/** What to shoot for a casual or fun post, written with it. */
function ShotIdea({ payload }: { payload?: Record<string, unknown> | null }) {
  const idea = typeof payload?.visualIdea === 'string' ? payload.visualIdea.trim() : ''
  if (!idea) return null
  return (
    <div className="mt-3 flex gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600 dark:bg-surface-hover dark:text-neutral-300">
      <Clapperboard className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        <span className="font-semibold">What to shoot: </span>
        {idea}
      </span>
    </div>
  )
}

function LinkNote({ label, text }: { label: string; text?: string | null }) {
  const value = toPlainText(text)
  if (!value) return null
  return (
    <div className="mt-3 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs text-neutral-600 dark:border-border dark:text-neutral-300">
      <span className="font-semibold">{label}: </span>
      <span className="break-all whitespace-pre-wrap">{value}</span>
    </div>
  )
}

export function VariantPreview(props: VariantPreviewProps) {
  const formatId: FormatId = isFormatId(props.formatId) ? props.formatId : 'x.post'
  const spec = FORMATS[formatId]
  const tags = hashtagLine(props.hashtags)
  const handle = `@${props.authorName.toLowerCase().replace(/[^a-z0-9]+/g, '')}`

  const shell =
    'w-full overflow-hidden rounded-xl border border-[#e0e0e0] bg-white text-sm text-neutral-900 shadow-sm dark:border-border dark:bg-surface dark:text-neutral-100'

  if (spec.structure === 'script') {
    const script = videoScriptOf({
      hook: props.hook,
      body: props.body,
      cta: props.cta,
      payload: props.payload
    })
    const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    const maxSeconds = spec.limits.seconds?.max ?? 60
    return (
      <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* The video as it shows in the feed: vertical, caption over the picture. */}
        <div className="relative flex aspect-9/16 w-56 shrink-0 flex-col justify-end overflow-hidden rounded-2xl bg-neutral-900 text-white shadow-sm">
          {/* No video exists: the frame stands in for the one to be filmed. */}
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-neutral-400">
            <span className="inline-flex flex-col items-center gap-2">
              <Clapperboard className="h-6 w-6" />
              <span className="font-semibold text-neutral-200">Not filmed yet</span>
              <span>First shot: {script.shots[0]?.show || 'filmed by the author'}</span>
            </span>
          </div>
          <span className="absolute top-2.5 left-2.5 rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-semibold text-neutral-900">
            Script to film
          </span>
          {script.shots[0]?.onScreenText && (
            <div className="absolute inset-x-4 top-11 rounded-md bg-black/60 px-2 py-1 text-center text-xs font-semibold">
              {script.shots[0].onScreenText}
            </div>
          )}
          <div className="relative space-y-1 bg-linear-to-t from-black/80 to-transparent p-3 pt-10 text-[11px] leading-snug">
            <div className="font-semibold">{handle}</div>
            {script.title && <div className="font-semibold">{script.title}</div>}
            <Folded text={toPlainText(script.caption)} fold={spec.limits.foldChars ?? 90} />
            {tags && <div className="text-neutral-200">{tags}</div>}
          </div>
        </div>

        {/* The script, shot by shot, as the author will film it. */}
        <div className={`${shell} min-w-0 flex-1`}>
          <div className="flex items-baseline justify-between border-b border-neutral-100 px-4 py-2.5 dark:border-border">
            <span className="text-xs font-semibold">{spec.label} script · film these shots</span>
            <span
              className={`text-[11px] tabular-nums ${script.seconds > maxSeconds ? 'text-rose-600 dark:text-rose-400' : 'text-neutral-500'}`}
            >
              about {script.seconds}s spoken
            </span>
          </div>
          <ol className="divide-y divide-neutral-100 dark:divide-border">
            {script.shots.map((shot, i) => (
              <li key={i} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 px-4 py-3">
                <span className="pt-0.5 font-mono text-[11px] text-neutral-500 tabular-nums">
                  {clock(shot.startsAt)}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-[13px] leading-snug whitespace-pre-wrap wrap-break-word">
                    {toPlainText(shot.say)}
                  </p>
                  {shot.show && (
                    <p className="text-[11px] text-neutral-500">Show: {shot.show}</p>
                  )}
                  {shot.onScreenText && (
                    <p className="text-[11px] text-neutral-500">On screen: “{shot.onScreenText}”</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="px-4 pb-4">
            <LinkNote label={spec.commentLabel} text={props.firstComment} />
          </div>
        </div>
      </div>
    )
  }

  if (spec.platform === 'x' || spec.platform === 'threads') {
    const posts =
      spec.structure === 'thread'
        ? splitThread(props.hook, props.body).map(p => toPlainText(p))
        : [joined([props.hook, props.body, props.cta])]
    if (tags && posts.length > 0) posts[posts.length - 1] = `${posts[posts.length - 1]}\n\n${tags}`
    const Reply = spec.platform === 'x' ? Repeat2 : Send
    return (
      <div className={shell}>
        <ol className="divide-y divide-neutral-100 dark:divide-border">
          {posts.map((post, i) => (
            <li key={i} className="flex gap-3 p-4">
              <div className="flex flex-col items-center">
                <Avatar initials={props.authorInitials} />
                {i < posts.length - 1 && (
                  <div className="mt-1 w-0.5 flex-1 bg-neutral-200 dark:bg-border" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-semibold">{props.authorName}</span>
                  <span className="truncate text-xs text-neutral-500">{handle}</span>
                  {posts.length > 1 && (
                    <span className="ml-auto text-[11px] text-neutral-400 tabular-nums">
                      {i + 1}/{posts.length}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[15px] leading-normal whitespace-pre-wrap wrap-break-word">
                  {post}
                </p>
                {i === 0 && (
                  <div className="mt-3">
                    <Media url={props.mediaUrl} alt={props.mediaAltText} onClick={props.onMediaClick} />
                  </div>
                )}
                <div className="mt-2 flex gap-8 text-neutral-400">
                  <MessageCircle className="h-4 w-4" />
                  <Reply className="h-4 w-4" />
                  <Heart className="h-4 w-4" />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="px-4 pb-4">
          <LinkNote label={spec.commentLabel} text={props.firstComment} />
          <ShotIdea payload={props.payload} />
        </div>
      </div>
    )
  }

  if (spec.platform === 'instagram') {
    const caption = joined([props.hook, props.body, props.cta])
    const visualIdea =
      typeof props.payload?.visualIdea === 'string' ? props.payload.visualIdea : null
    return (
      <div className={`${shell} max-w-[470px]`}>
        <div className="flex items-center gap-2.5 p-3">
          <Avatar initials={props.authorInitials} />
          <span className="truncate text-sm font-semibold">{props.authorName}</span>
        </div>
        {props.mediaUrl ? (
          <Media url={props.mediaUrl} alt={props.mediaAltText} onClick={props.onMediaClick} square />
        ) : (
          <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-neutral-100 p-6 text-center text-xs text-neutral-500 dark:bg-surface-hover dark:text-neutral-400">
            <ImageOff className="h-6 w-6" />
            <span className="font-semibold">Instagram needs an image</span>
            {visualIdea && <span className="max-w-xs leading-snug">Suggested: {visualIdea}</span>}
          </div>
        )}
        <div className="flex gap-4 px-3 pt-3 text-neutral-800 dark:text-neutral-200">
          <Heart className="h-5 w-5" />
          <MessageCircle className="h-5 w-5" />
          <Send className="h-5 w-5" />
          <Bookmark className="ml-auto h-5 w-5" />
        </div>
        <div className="px-3 pt-2 pb-4 text-sm leading-snug wrap-break-word">
          <span className="mr-1.5 font-semibold">{props.authorName}</span>
          <Folded text={caption} fold={spec.limits.foldChars} />
          {tags && <p className="mt-2 text-[#00376b] dark:text-sky-300">{tags}</p>}
          {visualIdea && props.mediaUrl && (
            <p className="mt-3 text-[11px] text-neutral-500">Visual idea: {visualIdea}</p>
          )}
        </div>
      </div>
    )
  }

  // Facebook
  const text = joined([props.hook, props.body, props.cta])
  return (
    <div className={shell}>
      <div className="flex items-center gap-2.5 p-4 pb-2">
        <Avatar initials={props.authorInitials} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{props.authorName}</div>
          <div className="text-[11px] text-neutral-500">Just now · Public</div>
        </div>
      </div>
      <div className="px-4 pb-3 text-[15px] leading-normal wrap-break-word">
        <Folded text={text} fold={spec.limits.foldChars} />
        {tags && <p className="mt-2 text-[#1877f2]">{tags}</p>}
      </div>
      <Media url={props.mediaUrl} alt={props.mediaAltText} onClick={props.onMediaClick} />
      <div className="flex justify-around border-t border-neutral-100 py-2 text-xs font-semibold text-neutral-500 dark:border-border">
        <span className="inline-flex items-center gap-1.5"><ThumbsUp className="h-4 w-4" /> Like</span>
        <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-4 w-4" /> Comment</span>
        <span className="inline-flex items-center gap-1.5"><Send className="h-4 w-4" /> Share</span>
      </div>
      <div className="px-4 pb-4">
        <LinkNote label={spec.commentLabel} text={props.firstComment} />
        <ShotIdea payload={props.payload} />
      </div>
    </div>
  )
}

/** The header label above a preview, e.g. "X preview · X thread". */
export function previewTitle(formatId: string | null | undefined): string {
  if (!isFormatId(formatId) || formatId === 'linkedin.post') return 'LinkedIn Feed Appearance'
  // A video is a script to film; "preview" suggested a finished video.
  if (FORMATS[formatId].structure === 'script') return `${FORMATS[formatId].label} · script to film`
  return `${PLATFORMS[FORMATS[formatId].platform].label} preview · ${FORMATS[formatId].label}`
}
