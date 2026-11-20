'use client'

import { Button } from '@/components/button'
import { ConfirmPopover } from '@/components/confirm-popover'
import { FormAlert } from '@/components/form-alert'
import { PlatformMark } from '@/components/platform-mark'
import { FOCUS_RING } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { formatAbsoluteDateTime } from '@/lib/format-date'
import { getPlatform } from '@/lib/platforms'
import {
  ArrowRight,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  ExternalLink,
  Target,
  Trash2,
  Undo2,
  X,
  type LucideIcon
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { queuedFor, stageOf } from './post-stage'
import type { PlannedPost } from './schedule-data'
import { DayInput, QuickMoves, StageChip } from './schedule-parts'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps keyboard focus inside the dialog while it is open (Tab and
 * Shift+Tab wrap around) and closes it on Escape. Escape with a confirm
 * popover open inside it closes only the popover.
 */
function useModalKeys(
  panel: RefObject<HTMLDivElement | null>,
  onClose: () => void
) {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = panel.current
      if (!el) return
      if (e.key === 'Escape') {
        if (el.querySelector('[role="dialog"]')) return
        e.preventDefault()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        item => item.getClientRects().length > 0
      )
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) {
        e.preventDefault()
        el.focus()
        return
      }
      const active = document.activeElement
      // Focus left the dialog (its button was removed, say): bring it back.
      if (!el.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])
}

/** One fact about the post, as a quiet line with an icon. */
function Fact({
  icon: Icon,
  title,
  children
}: {
  icon: LucideIcon
  title?: string
  children: ReactNode
}) {
  return (
    <li title={title} className="text-muted flex min-w-0 items-center gap-2 text-xs">
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </li>
  )
}

/**
 * One post: where it goes, where it stands, and its day. Move it with the
 * quick days or a date, unschedule it, or mark it posted by hand.
 */
export function PostDialog({
  post,
  today,
  busy,
  failure,
  onRetry,
  onClose,
  onPlan,
  onPosted
}: {
  post: PlannedPost
  /** The viewer's today; null before mount. */
  today: string | null
  busy: boolean
  /** Why the last change to this post failed, with a retry. */
  failure: string | null
  onRetry: () => void
  onClose: () => void
  onPlan: (day: string | null) => void
  onPosted: (posted: boolean) => void
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useModalKeys(panelRef, onClose)
  // A button that went away while saving (Unschedule, Mark as posted) took
  // focus with it: keep it in the dialog.
  useEffect(() => {
    const panel = panelRef.current
    if (!busy && panel && !panel.contains(document.activeElement)) panel.focus()
  }, [busy])

  const stage = stageOf(post)
  const platform = getPlatform(post.platform)
  const publication = post.publication
  const queued = queuedFor(post)
  const posted = stage === 'posted'
  const retrying = stage === 'scheduled' && (publication?.attempts ?? 0) > 0
  // Only an approved post can be marked posted; one being sent right now is
  // refused by the server, so it is not offered.
  const canMarkPosted =
    post.status === 'approved' && !posted && stage !== 'publishing'
  const deletedAt =
    !posted && publication?.status === 'published' ? publication.deletedAt : null

  const markPosted = (
    <Button
      size="sm"
      onClick={stage === 'scheduled' ? undefined : () => onPosted(true)}
      loading={busy}
      title={`You published it on ${platform.name} yourself`}
      className={FOCUS_RING}
    >
      {!busy && <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />}
      Mark as posted
    </Button>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-xs sm:items-center sm:p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="border-border bg-surface max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border shadow-xl outline-none sm:max-w-md sm:rounded-2xl"
      >
        <div className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-foreground inline-flex items-center gap-1.5 text-[13px] font-medium">
                <PlatformMark platform={post.platform} colored className="h-4 w-4 shrink-0" />
                {platform.name}
              </span>
              <StageChip post={post} mounted />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              autoFocus
              className={cn(
                'text-muted hover:text-foreground hover:bg-surface-hover flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors',
                FOCUS_RING
              )}
            >
              <X aria-hidden className="h-4 w-4" />
            </button>
          </div>

          <h2
            id={titleId}
            className="text-foreground text-[15px] leading-relaxed font-semibold"
          >
            {post.hook}
          </h2>

          {(queued ||
            (posted && (publication?.publishedAt || post.postedAt)) ||
            deletedAt ||
            post.goalTitle) && (
            <ul className="space-y-1.5">
              {stage === 'scheduled' && queued && (
                <Fact
                  icon={CalendarClock}
                  title={
                    retrying && publication?.error
                      ? `Last attempt failed: ${publication.error}`
                      : publication?.trigger === 'auto'
                        ? 'Auto-publish'
                        : undefined
                  }
                >
                  <span className="tabular-nums">
                    {retrying ? 'Retrying' : 'Publishes'} {formatAbsoluteDateTime(queued)}
                  </span>
                </Fact>
              )}
              {posted && post.publishedFromApp && publication?.publishedAt && (
                <Fact icon={CheckCircle2}>
                  <span className="tabular-nums">
                    {formatAbsoluteDateTime(publication.publishedAt)}
                  </span>
                  {publication.postUrl && (
                    <a
                      href={publication.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        'text-brand-strong ml-2 inline-flex items-center gap-1 rounded font-medium hover:underline',
                        FOCUS_RING
                      )}
                    >
                      View
                      <ExternalLink aria-hidden className="h-3 w-3" />
                      <span className="sr-only">on {platform.name} (new tab)</span>
                    </a>
                  )}
                </Fact>
              )}
              {posted && !post.publishedFromApp && post.postedAt && (
                <Fact icon={CheckCircle2} title="Marked as posted">
                  <span className="tabular-nums">
                    {formatAbsoluteDateTime(post.postedAt)}
                  </span>
                </Fact>
              )}
              {deletedAt && (
                <Fact icon={Trash2} title="It can be published again from its page.">
                  Deleted from {platform.name}
                </Fact>
              )}
              {post.goalTitle && <Fact icon={Target}>{post.goalTitle}</Fact>}
            </ul>
          )}

          {stage === 'failed' && publication?.error && (
            <FormAlert variant="error" className="text-xs">
              {publication.error}
            </FormAlert>
          )}
          {failure && (
            <FormAlert variant="error" className="text-xs">
              {failure}{' '}
              <button
                type="button"
                onClick={onRetry}
                disabled={busy}
                className={cn('cursor-pointer rounded font-semibold underline', FOCUS_RING)}
              >
                Try again
              </button>
            </FormAlert>
          )}
        </div>

        <div className="border-border space-y-3 border-t px-5 py-4">
          {!posted && today && (
            <QuickMoves
              planned={post.plannedFor}
              today={today}
              busy={busy}
              onPlan={day => onPlan(day)}
              label={post.plannedFor ? 'Move to' : 'Plan for'}
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <DayInput
              label={posted ? 'Day it went out' : 'Day'}
              srOnlyLabel
              value={post.plannedFor}
              disabled={busy}
              onChange={day => onPlan(day)}
              className="min-w-40 flex-1"
            />
            {post.plannedFor && !posted && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onPlan(null)}
                disabled={busy}
                className={FOCUS_RING}
              >
                <CalendarX aria-hidden className="h-3.5 w-3.5" />
                Unschedule
              </Button>
            )}
          </div>
          {stage === 'scheduled' && (
            <p className="text-muted text-xs">
              Moving the day won’t move the queued publication.
            </p>
          )}
        </div>

        <div className="border-border flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
          <Link
            href={`/posts/${post.id}`}
            className={cn(
              'text-muted hover:text-foreground inline-flex h-8 items-center gap-1 rounded-lg px-1 text-[13px] font-medium',
              FOCUS_RING
            )}
          >
            Open post
            <ArrowRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {posted && !post.publishedFromApp && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onPosted(false)}
                disabled={busy}
                className={FOCUS_RING}
              >
                <Undo2 aria-hidden className="h-3.5 w-3.5" />
                Not posted yet
              </Button>
            )}
            {canMarkPosted &&
              (stage === 'scheduled' ? (
                // Marking it posted cancels the queued publication (setPostPosted).
                <ConfirmPopover
                  onConfirm={() => onPosted(true)}
                  title="Mark as posted?"
                  description="This cancels the queued publication."
                  confirmLabel="Mark as posted"
                  tone="neutral"
                  disabled={busy}
                >
                  {markPosted}
                </ConfirmPopover>
              ) : (
                markPosted
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
