'use client'

import { PageHeader } from '@/components/page-header'
import { showToast } from '@/components/toast-notification'
import type { Schedule } from '@/db/schema'
import {
  dayLabel,
  localDay,
  monthGrid,
  monthLabel,
  monthParam,
  shiftMonth,
  type Month
} from '@/lib/calendar'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import {
  ArrowRight,
  CalendarClock,
  CalendarX,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Target,
  Undo2,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState, useTransition } from 'react'
import { planPost, setPostPosted } from './actions'
import type { NextRun, PlannedPost } from './schedule-data'
import { ScheduleForm, type ScheduleGoal } from './schedule-form'

type ShownStatus = 'awaiting_review' | 'approved' | 'posted'

/** Posted once the reviewer says so; otherwise where review stands. */
function shownStatus(post: PlannedPost): ShownStatus {
  if (post.postedAt) return 'posted'
  return post.status === 'approved' ? 'approved' : 'awaiting_review'
}

const STATUS: Record<
  ShownStatus,
  { label: string; dot: string; chip: string }
> = {
  awaiting_review: {
    label: 'To review',
    dot: 'bg-amber-500',
    chip: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
  },
  approved: {
    label: 'Approved',
    dot: 'bg-emerald-500',
    chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
  },
  posted: {
    label: 'Posted',
    dot: 'bg-brand',
    chip: 'border-brand/30 bg-brand/10 text-brand-strong'
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Calendar cells show this many posts, then "+N more". */
const CELL_LIMIT = 3

export function ScheduleClient({
  accountId,
  month,
  planned,
  unscheduled,
  unscheduledTotal,
  schedule,
  nextRun,
  goals
}: {
  accountId: string
  month: Month
  /** Posts planned on the days the month grid shows. */
  planned: PlannedPost[]
  /** Posts not planned yet, newest first (at most a page of them). */
  unscheduled: PlannedPost[]
  unscheduledTotal: number
  schedule: Schedule | null
  nextRun: NextRun | null
  /** The goals a scheduled run can serve. */
  goals: ScheduleGoal[]
}) {
  const router = useRouter()
  const mounted = useHasMounted()
  const today = mounted ? localDay() : null
  const [isNavigating, startNavigation] = useTransition()

  // Local copies hold optimistic moves until the server's next render
  // arrives, which replaces them (adjusted during render, as on Ideas).
  const [source, setSource] = useState({ planned, unscheduled })
  const [posts, setPosts] = useState<PlannedPost[]>([
    ...planned,
    ...unscheduled
  ])
  if (source.planned !== planned || source.unscheduled !== unscheduled) {
    setSource({ planned, unscheduled })
    setPosts([...planned, ...unscheduled])
  }
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  // Days whose cell shows every post rather than the first few.
  const [expanded, setExpanded] = useState<string[]>([])

  const weeks = monthGrid(month)
  const inMonth = (day: string) => day.startsWith(monthParam(month))
  const byDay = new Map<string, PlannedPost[]>()
  for (const post of posts) {
    if (!post.plannedFor) continue
    byDay.set(post.plannedFor, [...(byDay.get(post.plannedFor) ?? []), post])
  }
  const notPlanned = posts.filter(p => !p.plannedFor)
  const openPost = posts.find(p => p.id === openId) ?? null

  const goToMonth = (next: Month) =>
    startNavigation(() => router.push(`/schedule?month=${monthParam(next)}`))

  // A viewer whose day differs from the server's sees their own month.
  const todayMonth = today
    ? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }
    : null

  const update = (id: string, patch: Partial<PlannedPost>) =>
    setPosts(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))

  const plan = async (id: string, day: string | null) => {
    const before = posts.find(p => p.id === id)
    if (!before || before.plannedFor === day) return
    setBusyId(id)
    update(id, { plannedFor: day })
    try {
      const res = await planPost(id, day)
      if (!res.success) {
        update(id, { plannedFor: before.plannedFor })
        showToast({ type: 'error', title: 'Not planned', message: res.error })
        return
      }
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const markPosted = async (id: string, posted: boolean) => {
    const before = posts.find(p => p.id === id)
    if (!before) return
    const day = localDay()
    setBusyId(id)
    update(id, {
      postedAt: posted ? new Date() : null,
      plannedFor: posted ? (before.plannedFor ?? day) : before.plannedFor
    })
    try {
      const res = await setPostPosted(id, posted, day)
      if (!res.success) {
        update(id, { postedAt: before.postedAt, plannedFor: before.plannedFor })
        showToast({ type: 'error', title: 'Not updated', message: res.error })
        return
      }
      router.refresh()
    } finally {
      setBusyId(null)
    }
  }

  const onDrop = (day: string, e: React.DragEvent) => {
    e.preventDefault()
    setDropDay(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id) void plan(id, day)
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Schedule"
        description="Plan the day each post goes out. You publish on LinkedIn yourself; nothing is posted automatically."
      />

      <div className="relative flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            {/* Calendar */}
            <section
              aria-label={`Posts planned in ${monthLabel(month)}`}
              className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs"
            >
              <div className="border-border flex items-center gap-1.5 border-b px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => goToMonth(shiftMonth(month, -1))}
                  aria-label="Previous month"
                  className="border-border text-foreground hover:bg-surface-hover flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span
                  aria-live="polite"
                  className="text-foreground min-w-32 text-center text-sm font-semibold tabular-nums"
                >
                  {isNavigating ? (
                    <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" />
                  ) : (
                    monthLabel(month)
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => goToMonth(shiftMonth(month, 1))}
                  aria-label="Next month"
                  className="border-border text-foreground hover:bg-surface-hover flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                {todayMonth && monthParam(todayMonth) !== monthParam(month) && (
                  <button
                    type="button"
                    onClick={() => goToMonth(todayMonth)}
                    className="border-border text-foreground hover:bg-surface-hover h-8 rounded-lg border px-3.5 text-[13px] font-medium transition-colors"
                  >
                    Today
                  </button>
                )}
              </div>

              <div
                className={cn(
                  'transition-opacity',
                  isNavigating && 'opacity-60'
                )}
              >
                {/* Month grid, from tablet width up */}
                <div className="hidden md:block">
                  <div className="border-border grid grid-cols-7 border-b">
                    {WEEKDAYS.map(d => (
                      <div
                        key={d}
                        className="text-muted px-2 py-2 text-center text-[11px] font-semibold tracking-wider uppercase"
                      >
                        {d}
                      </div>
                    ))}
                  </div>
                  {weeks.map(week => (
                    <div
                      key={week[0]}
                      className="border-border grid grid-cols-7 border-b last:border-b-0"
                    >
                      {week.map(day => {
                        const dayPosts = byDay.get(day) ?? []
                        const isToday = day === today
                        const shown = expanded.includes(day)
                          ? dayPosts
                          : dayPosts.slice(0, CELL_LIMIT)
                        return (
                          <div
                            key={day}
                            onDragOver={e => {
                              e.preventDefault()
                              setDropDay(day)
                            }}
                            onDragLeave={() =>
                              setDropDay(current =>
                                current === day ? null : current
                              )
                            }
                            onDrop={e => onDrop(day, e)}
                            className={cn(
                              'border-border min-h-28 border-r p-1.5 last:border-r-0',
                              !inMonth(day) && 'bg-surface-hover/40',
                              dropDay === day &&
                                'bg-brand/10 ring-brand ring-2 ring-inset'
                            )}
                          >
                            <div className="mb-1 flex justify-end">
                              <span
                                className={cn(
                                  'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums',
                                  isToday
                                    ? 'bg-accent text-background font-semibold'
                                    : inMonth(day)
                                      ? 'text-foreground'
                                      : 'text-muted'
                                )}
                              >
                                {Number(day.slice(8))}
                              </span>
                            </div>
                            <ul className="space-y-1">
                              {shown.map(post => (
                                <li key={post.id}>
                                  <PostChip
                                    post={post}
                                    busy={busyId === post.id}
                                    onOpen={() => setOpenId(post.id)}
                                  />
                                </li>
                              ))}
                            </ul>
                            {dayPosts.length > shown.length && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpanded(prev => [...prev, day])
                                }
                                className="text-muted hover:text-foreground mt-1 px-1 text-[11px] font-medium"
                              >
                                +{dayPosts.length - shown.length} more
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>

                {/* Agenda, on phones */}
                <div className="md:hidden">
                  <AgendaList
                    days={weeks.flat().filter(inMonth)}
                    byDay={byDay}
                    today={today}
                    busyId={busyId}
                    onOpen={setOpenId}
                  />
                </div>
              </div>

              <div className="border-border text-muted flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2.5 text-[11px]">
                {(Object.keys(STATUS) as ShownStatus[]).map(key => (
                  <span key={key} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn('h-2 w-2 rounded-full', STATUS[key].dot)}
                    />
                    {STATUS[key].label}
                  </span>
                ))}
                <span className="ml-auto hidden md:inline">
                  Drag a post onto a day to plan it.
                </span>
              </div>
            </section>

            {/* Posts not planned yet */}
            <section
              aria-labelledby="unplanned-heading"
              className="border-border bg-surface rounded-2xl border shadow-xs"
            >
              <div className="border-border border-b px-4 py-3">
                <h2
                  id="unplanned-heading"
                  className="text-foreground flex items-center gap-2 text-sm font-semibold"
                >
                  <CalendarClock className="text-accent h-4 w-4" />
                  Not planned yet
                  <span className="text-muted font-normal tabular-nums">
                    ({unscheduledTotal})
                  </span>
                </h2>
                <p className="text-muted mt-0.5 text-[11px]">
                  Posts in review or approved. Pick a day for each.
                </p>
              </div>
              {notPlanned.length === 0 ? (
                <div className="text-muted p-6 text-center text-xs">
                  Every post is planned.{' '}
                  <Link href="/ideas" className="text-accent hover:underline">
                    Create posts from ideas
                  </Link>
                </div>
              ) : (
                <ul className="divide-border max-h-[32rem] divide-y overflow-y-auto">
                  {notPlanned.map(post => (
                    <li
                      key={post.id}
                      draggable
                      onDragStart={e =>
                        e.dataTransfer.setData('text/plain', post.id)
                      }
                      className="space-y-2 px-4 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <StatusBadge post={post} />
                        {post.goalTitle && (
                          <span className="text-muted inline-flex min-w-0 items-center gap-1 text-[11px]">
                            <Target className="h-3 w-3 shrink-0" />
                            <span className="truncate">{post.goalTitle}</span>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenId(post.id)}
                        className="text-foreground hover:text-accent line-clamp-2 text-left text-xs leading-relaxed"
                      >
                        {post.hook}
                      </button>
                      <DayInput
                        label="Plan for"
                        value={null}
                        disabled={busyId === post.id}
                        onChange={day => void plan(post.id, day)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {unscheduledTotal > notPlanned.length && (
                <p className="text-muted border-border border-t px-4 py-2 text-[11px]">
                  Showing the newest {notPlanned.length}. Plan these to see
                  more.
                </p>
              )}
            </section>
          </div>

          <ScheduleForm
            accountId={accountId}
            initialSchedule={schedule}
            nextRun={nextRun}
            goals={goals}
          />
        </div>
      </div>

      {openPost && (
        <PostDialog
          post={openPost}
          busy={busyId === openPost.id}
          onClose={() => setOpenId(null)}
          onPlan={day => void plan(openPost.id, day)}
          onPosted={posted => void markPosted(openPost.id, posted)}
        />
      )}
    </div>
  )
}

function StatusBadge({ post }: { post: PlannedPost }) {
  const status = STATUS[shownStatus(post)]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        status.chip
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', status.dot)}
      />
      {status.label}
    </span>
  )
}

function PostChip({
  post,
  busy,
  onOpen
}: {
  post: PlannedPost
  busy: boolean
  onOpen: () => void
}) {
  const status = STATUS[shownStatus(post)]
  return (
    <button
      type="button"
      draggable
      onDragStart={e => e.dataTransfer.setData('text/plain', post.id)}
      onClick={onOpen}
      title={`${status.label}: ${post.hook}`}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight transition-opacity hover:opacity-80',
        status.chip,
        busy && 'opacity-60'
      )}
    >
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)}
      />
      <span className="sr-only">{status.label}: </span>
      <span className="min-w-0 truncate">{post.hook}</span>
    </button>
  )
}

function AgendaList({
  days,
  byDay,
  today,
  busyId,
  onOpen
}: {
  days: string[]
  byDay: Map<string, PlannedPost[]>
  today: string | null
  busyId: string | null
  onOpen: (id: string) => void
}) {
  const withPosts = days.filter(day => (byDay.get(day) ?? []).length > 0)
  if (withPosts.length === 0) {
    return (
      <p className="text-muted p-6 text-center text-xs">
        No posts planned this month.
      </p>
    )
  }
  return (
    <ol className="divide-border divide-y">
      {withPosts.map(day => (
        <li key={day} className="space-y-1.5 px-4 py-3">
          <p className="text-foreground text-xs font-semibold">
            {dayLabel(day)}
            {day === today && (
              <span className="bg-accent text-background ml-2 rounded-full px-1.5 py-0.5 text-[10px]">
                Today
              </span>
            )}
          </p>
          <ul className="space-y-1">
            {(byDay.get(day) ?? []).map(post => (
              <li key={post.id}>
                <PostChip
                  post={post}
                  busy={busyId === post.id}
                  onOpen={() => onOpen(post.id)}
                />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}

/** A date field that reports a whole day, or null when cleared. */
function DayInput({
  label,
  value,
  disabled,
  onChange
}: {
  label: string
  value: string | null
  disabled?: boolean
  onChange: (day: string | null) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-muted shrink-0 text-[11px]">
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value ?? ''}
        disabled={disabled}
        onChange={e => onChange(e.target.value || null)}
        className="border-border bg-surface-hover text-foreground h-7 min-w-0 flex-1 rounded-lg border px-2 text-xs disabled:opacity-60"
      />
    </div>
  )
}

function PostDialog({
  post,
  busy,
  onClose,
  onPlan,
  onPosted
}: {
  post: PlannedPost
  busy: boolean
  onClose: () => void
  onPlan: (day: string | null) => void
  onPosted: (posted: boolean) => void
}) {
  const titleId = useId()
  const status = shownStatus(post)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-border bg-surface w-full max-w-md space-y-4 rounded-2xl border p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge post={post} />
            {post.goalTitle && (
              <span className="text-muted inline-flex min-w-0 items-center gap-1 text-xs">
                <Target className="h-3 w-3 shrink-0" />
                <span className="truncate">{post.goalTitle}</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            autoFocus
            className="text-muted hover:text-foreground hover:bg-surface-hover flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p
          id={titleId}
          className="text-foreground text-sm leading-relaxed font-medium"
        >
          {post.hook}
        </p>

        <div className="border-border space-y-3 border-t pt-4">
          <DayInput
            label="Planned for"
            value={post.plannedFor}
            disabled={busy}
            onChange={day => onPlan(day)}
          />
          {post.plannedFor && (
            <p className="text-muted text-xs">{dayLabel(post.plannedFor)}</p>
          )}

          {status === 'awaiting_review' && (
            <p className="text-muted flex items-start gap-1.5 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Approve this post on Posts before it goes out.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {post.plannedFor && status !== 'posted' && (
            <button
              type="button"
              onClick={() => onPlan(null)}
              disabled={busy}
              className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-60"
            >
              <CalendarX className="h-3.5 w-3.5" />
              Unschedule
            </button>
          )}
          {status === 'approved' && (
            <button
              type="button"
              onClick={() => onPosted(true)}
              disabled={busy}
              title="You published it on LinkedIn yourself"
              className="bg-accent text-background hover:bg-accent-hover inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Mark as posted
            </button>
          )}
          {status === 'posted' && (
            <button
              type="button"
              onClick={() => onPosted(false)}
              disabled={busy}
              className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-60"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Not posted yet
            </button>
          )}
          <Link
            href="/posts"
            className="text-accent inline-flex h-7 items-center gap-1 px-1 text-xs font-medium hover:underline"
          >
            Open Posts
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
