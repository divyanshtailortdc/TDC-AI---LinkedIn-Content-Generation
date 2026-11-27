'use client'

import { PlatformMark } from '@/components/platform-mark'
import { FIELD_CLASS } from '@/components/ui/field'
import { StatusChip } from '@/components/ui/status-chip'
import { FOCUS_RING, TONES } from '@/components/ui/tone'
import { dayLabel } from '@/lib/calendar'
import { cn } from '@/lib/cn'
import { getPlatform } from '@/lib/platforms'
import { AlertTriangle, Info } from 'lucide-react'
import { useId, useState, type DragEvent } from 'react'
import {
  queuedLabel,
  shiftDay,
  stageLabel,
  stageOf,
  STAGES,
  type Stage
} from './post-stage'
import type { PlannedPost } from './schedule-data'

/**
 * An explanation kept off the page: an info icon whose text shows on hover
 * and is read by screen readers.
 */
export function InfoHint({ title }: { title: string }) {
  return (
    <span role="img" aria-label={title} title={title} className="text-muted inline-flex">
      <Info aria-hidden className="h-3.5 w-3.5" />
    </span>
  )
}

/** The stage's dot; it pulses while the post is being sent. */
function StageDot({ stage }: { stage: Stage }) {
  const dot = TONES[STAGES[stage].tone].dot
  return (
    <span aria-hidden className="relative flex h-2 w-2 shrink-0">
      {stage === 'publishing' && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none',
            dot
          )}
        />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', dot)} />
    </span>
  )
}

/** The post's stage as the shared pill, with its publish time when queued. */
export function StageChip({
  post,
  size = 'sm',
  withTime = false,
  mounted
}: {
  post: PlannedPost
  size?: 'xs' | 'sm' | 'md'
  withTime?: boolean
  mounted: boolean
}) {
  const stage = stageOf(post)
  const time = withTime && mounted ? queuedLabel(post) : null
  return (
    <StatusChip
      tone={STAGES[stage].tone}
      spinning={stage === 'publishing'}
      icon={stage === 'failed' ? AlertTriangle : undefined}
      size={size}
    >
      {stageLabel(post, stage)}
      {time && <span className="font-medium tabular-nums opacity-80">· {time}</span>}
    </StatusChip>
  )
}

/**
 * A post on the calendar: platform, stage dot and hook, and its publish time
 * where the cell has room. Everything else is in its title and dialog.
 * Opens the post's dialog; drags onto another day.
 */
export function PostChip({
  post,
  busy,
  dragging,
  mounted,
  onOpen,
  onDragStart,
  onDragEnd
}: {
  post: PlannedPost
  busy: boolean
  dragging: boolean
  mounted: boolean
  onOpen: () => void
  onDragStart: (e: DragEvent) => void
  onDragEnd: () => void
}) {
  const stage = stageOf(post)
  const label = stageLabel(post, stage)
  const time = mounted ? queuedLabel(post) : null
  const name = getPlatform(post.platform).name
  return (
    <button
      type="button"
      draggable
      data-post-focus={post.id}
      aria-busy={busy || undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      title={`${name} · ${label}${time ? ` ${time}` : ''}: ${post.hook}`}
      className={cn(
        'bg-surface-hover/70 hover:bg-surface-hover flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs leading-tight transition-colors',
        FOCUS_RING,
        stage === 'posted' ? 'text-muted' : 'text-foreground',
        busy && 'opacity-60',
        dragging && 'opacity-40'
      )}
    >
      <StageDot stage={stage} />
      {/* A post and its X version share a hook: the mark tells them apart. */}
      <PlatformMark platform={post.platform} className="text-muted h-3 w-3 shrink-0" />
      <span className="sr-only">
        {name}, {label}
        {time ? ` ${time}` : ''}:{' '}
      </span>
      <span className="min-w-0 flex-1 truncate">{post.hook}</span>
      {/* Only where the day's cell has room for it; always in the title. */}
      {time && (
        <span
          aria-hidden
          className={cn(
            'hidden shrink-0 font-medium tabular-nums @min-[6.5rem]:inline',
            TONES.brand.text
          )}
        >
          {time}
        </span>
      )}
    </button>
  )
}

/**
 * A year the calendar can show (as parseMonthParam): typing one digit by
 * digit passes through 0002, 0020 and 0202, which are not days to plan.
 */
const isPlannableDay = (day: string) => {
  const year = Number(day.slice(0, 4))
  return year >= 2000 && year <= 2100
}

/**
 * A date field that reports a whole day, or null when cleared. What is typed
 * stays in the field until it is a day worth sending.
 */
export function DayInput({
  label,
  value,
  disabled,
  onChange,
  srOnlyLabel = false,
  className
}: {
  label: string
  value: string | null
  disabled?: boolean
  onChange: (day: string | null) => void
  srOnlyLabel?: boolean
  className?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState(value ?? '')
  // Back to the saved day when it changes, and when a save ends (a failed
  // one leaves the post as it was); kept while one is under way.
  const [seen, setSeen] = useState({ value, disabled })
  if (seen.value !== value || seen.disabled !== disabled) {
    setSeen({ value, disabled })
    if (seen.value !== value || !disabled) setDraft(value ?? '')
  }
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <label
        htmlFor={id}
        className={cn('text-muted shrink-0 text-xs', srOnlyLabel && 'sr-only')}
      >
        {label}
      </label>
      {/* Read-only rather than disabled while saving, so typing a date
          does not lose focus when the first full date is sent. */}
      <input
        id={id}
        type="date"
        value={draft}
        readOnly={disabled}
        aria-disabled={disabled || undefined}
        onChange={e => {
          const next = e.target.value
          setDraft(next)
          if (!next) onChange(null)
          else if (isPlannableDay(next)) onChange(next)
        }}
        // A half-typed year left behind shows the saved day again.
        onBlur={() => setDraft(value ?? '')}
        className={cn(
          FIELD_CLASS,
          'h-7 flex-1 px-2 py-0.5 text-xs tabular-nums aria-disabled:opacity-60'
        )}
      />
    </div>
  )
}

type QuickMove = { label: string; day: string }

/**
 * One-click days for a post: today and tomorrow, and from its planned day a
 * day earlier, a day later or a week later (a week from today when it has
 * none). The keyboard's way to reschedule, beside dragging.
 */
function quickMoves(
  planned: string | null,
  today: string,
  only?: string[]
): QuickMove[] {
  const moves: QuickMove[] = [
    { label: 'Today', day: today },
    { label: 'Tomorrow', day: shiftDay(today, 1) }
  ]
  if (planned) {
    moves.push(
      { label: '−1 day', day: shiftDay(planned, -1) },
      { label: '+1 day', day: shiftDay(planned, 1) }
    )
  }
  moves.push({ label: 'Next week', day: shiftDay(planned ?? today, 7) })
  return only ? moves.filter(m => only.includes(m.label)) : moves
}

/**
 * Quick-move buttons, as one quiet segmented control. One that would change
 * nothing (the planned day) or while the post is saving stays focusable but
 * does nothing (aria-disabled), so focus is not lost from under the keyboard.
 */
export function QuickMoves({
  planned,
  today,
  busy,
  onPlan,
  only,
  label = 'Move to'
}: {
  planned: string | null
  today: string
  busy: boolean
  onPlan: (day: string) => void
  /** Just these moves, by label. */
  only?: string[]
  label?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="border-border inline-flex flex-wrap gap-0.5 rounded-lg border p-0.5"
    >
      {quickMoves(planned, today, only).map(move => {
        const current = move.day === planned
        const off = busy || current
        return (
          <button
            key={move.label}
            type="button"
            aria-disabled={off || undefined}
            aria-label={`${move.label}: ${dayLabel(move.day)}${current ? ', its planned day' : ''}`}
            title={dayLabel(move.day)}
            onClick={() => {
              if (!off) onPlan(move.day)
            }}
            className={cn(
              'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium whitespace-nowrap tabular-nums transition-colors',
              FOCUS_RING,
              current
                ? 'bg-surface-hover text-foreground cursor-default'
                : 'text-muted hover:text-foreground hover:bg-surface-hover/60 cursor-pointer',
              busy && !current && 'cursor-wait opacity-60'
            )}
          >
            {move.label}
          </button>
        )
      })}
    </div>
  )
}

const isShown = (el: Element) => el.getClientRects().length > 0

/**
 * Puts focus back on a post once its dialog closes: on what opened it, or
 * where the post shows now (it may have moved to another day, or from the
 * unplanned list onto the calendar), else on `fallback`.
 */
export function focusPost(
  id: string,
  opener: HTMLElement | null,
  fallback: HTMLElement | null
) {
  if (opener?.isConnected && isShown(opener) && opener.dataset.postFocus === id) {
    opener.focus()
    return
  }
  const entry = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-post-focus="${CSS.escape(id)}"]`)
  ).find(isShown)
  ;(entry ?? fallback)?.focus()
}
