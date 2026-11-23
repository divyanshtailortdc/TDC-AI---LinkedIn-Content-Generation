'use client'

import { PlatformMark } from '@/components/platform-mark'
import { cn } from '@/lib/cn'
import { isPlatformId } from '@/lib/formats'
import { describeReference } from '@/lib/reference-post/render'
import {
  REFERENCE_TEXT_MAX,
  REFERENCE_TEXT_MIN,
  type ReferencePost
} from '@/lib/reference-post/types'
import {
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Globe,
  Link2,
  Loader2,
  Sparkles
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { readReferenceAction } from '@/app/(app)/ideas/reference-actions'

/**
 * "A post like this one", first step: the user pastes a public post's link,
 * sees what could be read of it, and fixes or completes its text (a search
 * engine shows only a post's opening; some posts cannot be read at all).
 * Next hands the post on; where the new post goes is asked next, in
 * CreatePostsDialog, as for any post.
 */
export function SimilarPostDialog({
  onCancel,
  onNext
}: {
  onCancel: () => void
  onNext: (reference: ReferencePost) => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [link, setLink] = useState('')
  const [reading, setReading] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  // What was read (or, when nothing could be, where the link points).
  const [read, setRead] = useState<ReferencePost | null>(null)
  const [readNote, setReadNote] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [readLink, setReadLink] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Modal, as CreatePostsDialog: the page behind must not act on its keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const readPost = async () => {
    const value = link.trim()
    if (!value || reading) return
    setReading(true)
    setLinkError(null)
    try {
      const res = await readReferenceAction(value)
      if (res.success) {
        setRead(res.reference)
        setText(res.reference.text)
        setReadNote(null)
        setReadLink(value)
      } else if (res.needsText) {
        setRead({ ...res.reference, text: '', partial: false, via: 'pasted' })
        setText('')
        setReadNote(res.error)
        setReadLink(value)
      } else {
        setLinkError(res.error)
        setRead(null)
        setReadLink(null)
      }
    } catch {
      setLinkError('The link could not be read just now. Please try again.')
    } finally {
      setReading(false)
    }
  }

  // A link changed after it was read must be read again before going on.
  const stale = read !== null && readLink !== link.trim()
  const trimmed = text.trim()
  const ready = read !== null && !stale && trimmed.length >= REFERENCE_TEXT_MIN && !reading

  const next = () => {
    if (!read || !ready) return
    const edited = trimmed !== read.text.trim()
    onNext({
      ...read,
      text: trimmed,
      // Typed in or changed by the user: what was read no longer describes it.
      ...(edited ? { via: 'pasted' as const, partial: false } : {})
    })
  }

  const isVideo = read?.kind === 'reel' || read?.kind === 'video'

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs motion-safe:animate-[overlay-in_150ms_ease-out]"
      onClick={e => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="border-border bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-2xl border shadow-xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="border-border border-b px-6 pt-5 pb-4">
          <h2 id={titleId} className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Link2 aria-hidden className="text-brand h-4 w-4" />
            Create a post like one you saw
          </h2>
          <p id={descriptionId} className="text-muted mt-1 text-xs leading-relaxed">
            Paste the link to a public post, reel or video. A post like it is written in your
            voice, about your own field, without copying it.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <form
            onSubmit={e => {
              e.preventDefault()
              void readPost()
            }}
          >
            <label htmlFor={`${titleId}-link`} className="text-foreground mb-1.5 block text-xs font-semibold">
              Link
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                id={`${titleId}-link`}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={link}
                onChange={e => {
                  setLink(e.target.value)
                  setLinkError(null)
                }}
                placeholder="https://www.instagram.com/reel/…"
                aria-invalid={linkError ? true : undefined}
                aria-describedby={linkError ? `${titleId}-link-error` : undefined}
                className={cn(
                  'border-border bg-background text-foreground placeholder:text-muted/70 h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20',
                  linkError && 'border-rose-500/60'
                )}
              />
              <button
                type="submit"
                disabled={!link.trim() || reading}
                className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reading && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                {reading ? 'Reading…' : read && !stale ? 'Read again' : 'Read post'}
              </button>
            </div>
            {linkError ? (
              <p id={`${titleId}-link-error`} role="alert" className="mt-1.5 text-[11px] leading-snug text-rose-600 dark:text-rose-400">
                {linkError}
              </p>
            ) : (
              <p className="text-muted mt-1.5 text-[11px] leading-snug">
                Instagram, LinkedIn, X, Facebook, Threads, YouTube, TikTok, or any article.
              </p>
            )}
          </form>

          {read && !stale && (
            <div className="space-y-3">
              <a
                href={read.url}
                target="_blank"
                rel="noopener noreferrer"
                className="border-border hover:bg-surface-hover flex items-center gap-3 rounded-xl border p-3 transition-colors"
              >
                {read.imageUrl ? (
                  // The search engine's or the platform's own small copy, as shown to the model.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={read.imageUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="bg-surface-hover h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="bg-surface-hover flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
                    {isPlatformId(read.source) ? (
                      <PlatformMark platform={read.source} className="text-foreground h-5 w-5" />
                    ) : (
                      <Globe aria-hidden className="text-muted h-5 w-5" />
                    )}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-medium first-letter:uppercase">
                    {describeReference(read)}
                  </span>
                  <span className="text-muted block truncate text-[11px]">{read.title || read.url}</span>
                </span>
                <ExternalLink aria-hidden className="text-muted h-3.5 w-3.5 shrink-0" />
              </a>

              {readNote && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                  <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>{readNote}</span>
                </p>
              )}

              <div>
                <label htmlFor={`${titleId}-text`} className="text-foreground mb-1.5 block text-xs font-semibold">
                  {readNote ? 'Paste what the post says' : 'What the post says'}
                </label>
                <textarea
                  id={`${titleId}-text`}
                  value={text}
                  onChange={e => setText(e.target.value.slice(0, REFERENCE_TEXT_MAX))}
                  rows={6}
                  placeholder={isVideo ? 'Its caption, or what is said in it' : 'Its caption or text'}
                  className="border-border bg-background text-foreground placeholder:text-muted/70 w-full resize-y rounded-lg border px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
                />
                <p className="text-muted mt-1 text-[11px] leading-snug">
                  {readNote
                    ? 'Copy its caption or text from the post and paste it here.'
                    : isVideo
                      ? 'Only the caption or description can be read, not what is said in the video. Add the main points if they matter.'
                      : read.partial
                        ? 'Only the opening could be read. Paste the rest for a closer match.'
                        : 'Edit it if anything is missing.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
          <p aria-live="polite" className="text-muted mr-auto min-w-0 text-[11px] leading-snug">
            {!read || stale
              ? 'Read the post first.'
              : trimmed.length < REFERENCE_TEXT_MIN
                ? 'Add the post’s text.'
                : 'Next, choose where your post goes.'}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={next}
            className="bg-accent text-background hover:bg-accent-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" />
            Next
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
