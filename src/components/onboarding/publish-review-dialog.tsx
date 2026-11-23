'use client'

import { PlatformMark } from '@/components/platform-mark'
import { formatAbsoluteDateTime } from '@/lib/format-date'
import type { PlatformId } from '@/lib/platforms'
import { CalendarClock, Globe2, Loader2, Send, ShieldCheck } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The last look before a first post goes out on a real social account:
 * the exact text, what goes with it, the account it is published as and
 * when. Nothing happens until the user ticks that they have read it and
 * confirms. Used while the identity has never published (onboarding is not
 * complete), for Publish now and Schedule alike; later posts keep the short
 * confirmation.
 */
export function PublishReviewDialog({
  platform,
  platformName,
  accountName,
  when,
  text,
  imageUrl,
  attachments,
  pending,
  onCancel,
  onConfirm
}: {
  platform: PlatformId
  platformName: string
  /** The account it is published as; null when the name is not known. */
  accountName: string | null
  /** 'now', or the date and time it is scheduled for. */
  when: 'now' | Date
  /** The text as it will be published. */
  text: string
  imageUrl?: string | null
  /** What goes with the text, in words ("with its image", "text only"). */
  attachments: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const checkId = useId()
  const [checked, setChecked] = useState(false)
  const account = accountName ?? `your ${platformName} account`

  // Modal: keys must not reach the page's shortcuts (A approves a post).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape' && !pending) onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, onCancel])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs motion-safe:animate-[overlay-in_150ms_ease-out]"
      onClick={e => {
        if (e.target === e.currentTarget && !pending) onCancel()
      }}
    >
      <div className="border-border bg-surface flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl border shadow-2xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="border-border flex items-start gap-3.5 border-b p-5">
          <div className="bg-brand/15 text-brand-strong flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <ShieldCheck aria-hidden className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-foreground text-base leading-6 font-semibold"
            >
              Final check before your first post goes live
            </h2>
            <p className="text-muted mt-0.5 text-sm">
              This publishes to your real {platformName} account, where everyone
              can see it.
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <dl className="border-border divide-border grid divide-y rounded-xl border text-sm">
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <dt className="text-muted w-24 shrink-0 text-xs font-medium">
                Published as
              </dt>
              <dd className="text-foreground flex min-w-0 items-center gap-2 font-medium">
                <PlatformMark
                  platform={platform}
                  className="h-4 w-4 shrink-0"
                />
                <span className="truncate">
                  {account} on {platformName}
                </span>
              </dd>
            </div>
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <dt className="text-muted w-24 shrink-0 text-xs font-medium">
                When
              </dt>
              <dd className="text-foreground flex items-center gap-2 font-medium">
                {when === 'now' ? (
                  <>
                    <Send className="text-muted h-3.5 w-3.5" />
                    Right now
                  </>
                ) : (
                  <>
                    <CalendarClock className="text-muted h-3.5 w-3.5" />
                    {formatAbsoluteDateTime(when)}
                  </>
                )}
              </dd>
            </div>
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <dt className="text-muted w-24 shrink-0 text-xs font-medium">
                Who sees it
              </dt>
              <dd className="text-foreground flex items-center gap-2 font-medium">
                <Globe2 className="text-muted h-3.5 w-3.5" />
                Public
              </dd>
            </div>
          </dl>

          <div>
            <p className="text-muted mb-1.5 text-xs font-medium">
              The post, exactly as it goes out ({attachments})
            </p>
            <div className="border-border bg-surface-hover/40 rounded-xl border p-3.5">
              {imageUrl && (
                // A data or signed URL from the post's own media.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt="The image published with the post"
                  className="border-border mb-3 max-h-48 w-auto rounded-lg border object-contain"
                />
              )}
              <p className="text-foreground max-h-64 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap">
                {text}
              </p>
            </div>
          </div>

          <p className="text-muted text-xs leading-relaxed">
            Once it is out, changes have to be made on {platformName} itself. To
            change the wording now, cancel and click Edit text.
          </p>

          <label
            htmlFor={checkId}
            className="border-border hover:bg-surface-hover/60 flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm"
          >
            <input
              id={checkId}
              type="checkbox"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
              className="accent-accent mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="text-foreground">
              I have read this post and want it published publicly as {account}
              {when === 'now' ? ' now' : ' at the time above'}.
            </span>
          </label>
        </div>

        <div className="border-border flex justify-end gap-2 border-t p-4">
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onCancel}
            className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-9 cursor-pointer items-center rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!checked || pending}
            onClick={onConfirm}
            className="bg-accent hover:bg-accent-hover text-background inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            )}
            {pending
              ? when === 'now'
                ? 'Publishing…'
                : 'Scheduling…'
              : when === 'now'
                ? 'Publish now'
                : 'Schedule post'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
