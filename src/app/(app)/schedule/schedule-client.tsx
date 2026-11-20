'use client'

import { Button } from '@/components/button'
import { PageHeader } from '@/components/page-header'
import { PlatformMark } from '@/components/platform-mark'
import { showToast } from '@/components/toast-notification'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChips } from '@/components/ui/filter-chips'
import { StatTile } from '@/components/ui/stat-tile'
import { FOCUS_RING, type Tone } from '@/components/ui/tone'
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
import { getPlatform, PLATFORM_IDS, type PlatformId } from '@/lib/platforms'
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  type LucideIcon
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode
} from 'react'
import { planPost, setPostPosted } from './actions'
import { PostDialog } from './post-dialog'
import { stageOf, STAGE_ORDER, type Stage } from './post-stage'
import type { NextRun, PlannedPost } from './schedule-data'
import { ScheduleForm, type ScheduleGoal } from './schedule-form'
import { focusPost, InfoHint, PostChip, StageChip } from './schedule-parts'
import { UnplannedList } from './unplanned-list'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Calendar cells show this many posts, then "+N more". */
const CELL_LIMIT = 3

/** The month's figures that narrow the calendar, and the stages each covers. */
type StageFilter = 'all' | 'to_review' | 'scheduled' | 'posted' | 'failed'
const FILTER_STAGES: Record<Exclude<StageFilter, 'all'>, Stage[]> = {
  to_review: ['to_review'],
  scheduled: ['scheduled', 'publishing'],
  posted: ['posted'],
  failed: ['failed']
}
const FILTER_EMPTY: Record<Exclude<StageFilter, 'all'>, string> = {
  to_review: 'No posts to review',
  scheduled: 'No scheduled posts',
  posted: 'Nothing posted',
  failed: 'No failed posts'
}

type PlatformFilter = PlatformId | 'all'

/** What failed on a post, so its dialog can offer to try it again. */
type Failure = {
  id: string
  message: string
  retry: { kind: 'plan'; day: string | null } | { kind: 'posted'; posted: boolean }
}

const OFFLINE = 'Could not reach the server. Check your connection and try again.'

const monthOf = (day: string): Month => ({
  year: Number(day.slice(0, 4)),
  month: Number(day.slice(5, 7))
})

export function ScheduleClient({
  accountId,
  month,
  planned,
  unscheduled,
  unscheduledTotal,
  schedule,
  nextRun,
  goals,
  platforms,
  initialPlatform = null
}: {
  accountId: string
  month: Month
  /** Posts planned on the days the month grid shows. */
  planned: PlannedPost[]
  /** Posts not planned yet, newest first (up to a limit, not all of them). */
  unscheduled: PlannedPost[]
  unscheduledTotal: number
  schedule: Schedule | null
  nextRun: NextRun | null
  /** The goals a scheduled run can serve. */
  goals: ScheduleGoal[]
  /** The platforms the identity posts on: a day's run can plan for one. */
  platforms: PlatformId[]
  /** The platform the address asks to show (?platform=), if any. */
  initialPlatform?: PlatformId | null
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
  const [failure, setFailure] = useState<Failure | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  // Days whose cell shows every post rather than the first few.
  const [expanded, setExpanded] = useState<string[]>([])
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [platformPick, setPlatformPick] = useState<PlatformFilter>(
    initialPlatform ?? 'all'
  )
  const monthHeadingRef = useRef<HTMLHeadingElement>(null)
  // What opened the dialog, to put focus back there (or on the post's new
  // place) once it closes.
  const lastOpen = useRef<{ id: string; opener: HTMLElement | null } | null>(
    null
  )

  // The platforms to filter by: the identity's, and any a post here is for.
  const platformOptions = PLATFORM_IDS.filter(
    id => platforms.includes(id) || posts.some(p => p.platform === id)
  )
  const platform: PlatformFilter =
    platformPick !== 'all' &&
    platformOptions.length > 1 &&
    platformOptions.includes(platformPick)
      ? platformPick
      : 'all'
  const ofPlatform = (post: PlannedPost) =>
    platform === 'all' || post.platform === platform

  const weeks = monthGrid(month)
  const gridFrom = weeks[0]![0]!
  const gridTo = weeks[weeks.length - 1]![6]!
  const inMonth = (day: string) => day.startsWith(monthParam(month))

  // The month's figures: its own days only, of the platform picked.
  const monthPosts = posts.filter(
    p => p.plannedFor && inMonth(p.plannedFor) && ofPlatform(p)
  )
  const counts = Object.fromEntries(STAGE_ORDER.map(s => [s, 0])) as Record<
    Stage,
    number
  >
  for (const post of monthPosts) counts[stageOf(post)]++
  const filterCount = (f: Exclude<StageFilter, 'all'>) =>
    FILTER_STAGES[f].reduce((n, s) => n + counts[s], 0)
  const plannedDays = new Set(monthPosts.map(p => p.plannedFor)).size

  const onCalendar = (post: PlannedPost) =>
    ofPlatform(post) &&
    (stageFilter === 'all' || FILTER_STAGES[stageFilter].includes(stageOf(post)))
  const byDay = new Map<string, PlannedPost[]>()
  for (const post of posts) {
    if (!post.plannedFor || !onCalendar(post)) continue
    byDay.set(post.plannedFor, [...(byDay.get(post.plannedFor) ?? []), post])
  }
  const notPlanned = posts.filter(p => !p.plannedFor)

  const openPost = posts.find(p => p.id === openId) ?? null
  // A post that left the page (moved past the days loaded) closes its dialog.
  if (openId && !openPost) setOpenId(null)

  useEffect(() => {
    if (openId || !lastOpen.current) return
    const { id, opener } = lastOpen.current
    lastOpen.current = null
    focusPost(id, opener, monthHeadingRef.current)
  }, [openId])

  const openDialog = (id: string) => {
    lastOpen.current = {
      id,
      opener:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    }
    setFailure(null)
    setOpenId(id)
  }
  const closeDialog = () => {
    setFailure(null)
    setOpenId(null)
  }

  const hrefFor = (next: Month, shown: PlatformFilter = platform) => {
    const params = new URLSearchParams({ month: monthParam(next) })
    if (shown !== 'all') params.set('platform', shown)
    return `/schedule?${params}`
  }
  const goToMonth = (next: Month) =>
    startNavigation(() => router.push(hrefFor(next)))
  const pickPlatform = (next: PlatformFilter) => {
    setPlatformPick(next)
    // In the address too, so a reload or another month keeps it.
    window.history.replaceState(null, '', hrefFor(month, next))
  }

  // A viewer whose day differs from the server's sees their own month.
  const todayMonth = today ? monthOf(today) : null

  const update = (id: string, patch: Partial<PlannedPost>) =>
    setPosts(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))

  const plan = async (id: string, day: string | null) => {
    const before = posts.find(p => p.id === id)
    if (!before || before.plannedFor === day) return
    setBusyId(id)
    setFailure(null)
    update(id, { plannedFor: day })
    const fail = (message: string) => {
      update(id, { plannedFor: before.plannedFor })
      showToast({ type: 'error', title: 'Not planned', message })
      setFailure({ id, message, retry: { kind: 'plan', day } })
    }
    try {
      const res = await planPost(id, day)
      if (!res.success) {
        fail(res.error || 'Failed to plan the post')
        return
      }
      // Past the days on screen it leaves the calendar: say where it went.
      if (day && (day < gridFrom || day > gridTo)) {
        showToast({
          type: 'success',
          title: `Planned for ${dayLabel(day)}`,
          message: `It is on the ${monthLabel(monthOf(day))} calendar.`
        })
      }
    } catch {
      fail(OFFLINE)
    } finally {
      setBusyId(null)
    }
  }

  const markPosted = async (id: string, posted: boolean) => {
    const before = posts.find(p => p.id === id)
    if (!before) return
    const day = localDay()
    setBusyId(id)
    setFailure(null)
    update(id, {
      postedAt: posted ? new Date() : null,
      plannedFor: posted ? (before.plannedFor ?? day) : before.plannedFor
    })
    const fail = (message: string) => {
      update(id, { postedAt: before.postedAt, plannedFor: before.plannedFor })
      showToast({ type: 'error', title: 'Not updated', message })
      setFailure({ id, message, retry: { kind: 'posted', posted } })
    }
    try {
      const res = await setPostPosted(id, posted, day)
      if (!res.success) {
        fail(res.error || 'Failed to update the post')
        return
      }
    } catch {
      fail(OFFLINE)
    } finally {
      setBusyId(null)
    }
  }

  const retry = () => {
    if (!failure) return
    const { id, retry: action } = failure
    if (action.kind === 'plan') void plan(id, action.day)
    else void markPosted(id, action.posted)
  }

  const startDrag = (id: string, e: DragEvent) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    // Once the browser has its drag image: changing the dragged element
    // during dragstart can cancel the drag.
    setTimeout(() => setDraggingId(id), 0)
  }
  const endDrag = () => {
    setDraggingId(null)
    setDropDay(null)
  }
  const onDrop = (day: string, e: DragEvent) => {
    e.preventDefault()
    endDrag()
    const id = e.dataTransfer.getData('text/plain')
    if (id) void plan(id, day)
  }
  const dragged = draggingId ? posts.find(p => p.id === draggingId) : null
  // Dropped on the list it is unscheduled, as Unschedule does: not once posted.
  const canDropToUnplan = Boolean(
    dragged?.plannedFor && stageOf(dragged) !== 'posted'
  )

  const platformName = platform === 'all' ? null : getPlatform(platform).name
  const monthName = monthLabel(month)
  // What the phone agenda says when it has nothing to list.
  const empty: { title: string; showAll?: () => void } =
    monthPosts.length === 0
      ? platformName && posts.some(p => p.plannedFor && inMonth(p.plannedFor))
        ? { title: `No ${platformName} posts`, showAll: () => pickPlatform('all') }
        : { title: 'Nothing planned' }
      : stageFilter !== 'all'
        ? {
            title: FILTER_EMPTY[stageFilter],
            showAll: () => setStageFilter('all')
          }
        : { title: 'Nothing planned' }

  const tiles: {
    key: StageFilter
    label: string
    value: number
    hint?: string
    icon: LucideIcon
    tone: Tone
  }[] = [
    {
      key: 'all',
      label: 'Planned',
      value: monthPosts.length,
      hint:
        plannedDays > 0
          ? `${plannedDays} ${plannedDays === 1 ? 'day' : 'days'}`
          : undefined,
      icon: CalendarDays,
      tone: 'neutral'
    },
    {
      key: 'to_review',
      label: 'To review',
      value: filterCount('to_review'),
      icon: ClipboardCheck,
      tone: 'warning'
    },
    {
      key: 'scheduled',
      label: 'Scheduled',
      value: filterCount('scheduled'),
      hint:
        counts.publishing > 0 ? `${counts.publishing} publishing` : undefined,
      icon: CalendarClock,
      tone: 'brand'
    },
    {
      key: 'posted',
      label: 'Posted',
      value: filterCount('posted'),
      icon: CheckCircle2,
      tone: 'success'
    },
    {
      key: 'failed',
      label: 'Failed',
      value: filterCount('failed'),
      icon: AlertTriangle,
      tone: 'danger'
    }
  ]

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Schedule"
        description="Plan when each post goes out."
      />

      <div className="relative flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Month: navigation, platform, and its figures */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => goToMonth(shiftMonth(month, -1))}
                  aria-label="Previous month"
                  className={cn(
                    'border-border bg-surface text-foreground hover:bg-surface-hover flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors',
                    FOCUS_RING
                  )}
                >
                  <ChevronLeft aria-hidden className="h-4 w-4" />
                </button>
                <h2
                  ref={monthHeadingRef}
                  tabIndex={-1}
                  aria-live="polite"
                  className="text-foreground min-w-36 text-center text-base font-semibold tracking-tight tabular-nums outline-none sm:text-lg"
                >
                  {monthName}
                </h2>
                <button
                  type="button"
                  onClick={() => goToMonth(shiftMonth(month, 1))}
                  aria-label="Next month"
                  className={cn(
                    'border-border bg-surface text-foreground hover:bg-surface-hover flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors',
                    FOCUS_RING
                  )}
                >
                  <ChevronRight aria-hidden className="h-4 w-4" />
                </button>
                {todayMonth && monthParam(todayMonth) !== monthParam(month) && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => goToMonth(todayMonth)}
                    className={cn('ml-1', FOCUS_RING)}
                  >
                    Today
                  </Button>
                )}
                <span className="ml-1 hidden md:inline-flex">
                  <InfoHint title="Drag a post onto a day to move it, or open it to pick a day." />
                </span>
                {isNavigating && (
                  <Loader2
                    role="status"
                    aria-label="Loading the month"
                    className="text-muted ml-1 h-4 w-4 animate-spin motion-reduce:animate-none"
                  />
                )}
              </div>
              {platformOptions.length > 1 && (
                <FilterChips<PlatformFilter>
                  label="Show posts for platform"
                  value={platform}
                  onChange={pickPlatform}
                  options={[
                    { value: 'all', label: 'All platforms' },
                    ...platformOptions.map(id => ({
                      value: id,
                      label: (
                        <span className="inline-flex items-center gap-1.5">
                          <PlatformMark
                            platform={id}
                            colored
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          {getPlatform(id).name}
                        </span>
                      )
                      // No counts: the month's figures below already count,
                      // and a row of zeros said nothing.
                    }))
                  ]}
                />
              )}
            </div>

            <div
              role="group"
              aria-label={`${monthName} at a glance. Pick one to show only those posts on the calendar.`}
              className={cn(
                'grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 xl:grid-cols-5',
                isNavigating && 'opacity-60'
              )}
            >
              {tiles.map(tile => (
                <StatTile
                  key={tile.key}
                  label={tile.label}
                  value={tile.value}
                  hint={tile.hint}
                  icon={tile.icon}
                  tone={tile.value > 0 ? tile.tone : 'neutral'}
                  active={stageFilter === tile.key}
                  onClick={() =>
                    setStageFilter(current =>
                      tile.key === 'all' || current === tile.key
                        ? 'all'
                        : tile.key
                    )
                  }
                  className={tile.key === 'all' ? 'col-span-2 sm:col-span-1' : undefined}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
            {/* Calendar */}
            <section
              aria-label={`Posts planned in ${monthName}`}
              className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs"
            >
              <div
                className={cn(
                  'transition-opacity',
                  isNavigating && 'opacity-60'
                )}
              >
                {/* Month grid, from tablet width up */}
                <div className="hidden md:block">
                  <div
                    aria-hidden
                    className="border-border grid grid-cols-7 border-b"
                  >
                    {WEEKDAYS.map((d, i) => (
                      <div
                        key={d}
                        className={cn(
                          'text-muted px-2 py-2 text-center text-xs font-medium',
                          i >= 5 && 'bg-surface-hover/25'
                        )}
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
                      {week.map((day, col) => {
                        const dayPosts = byDay.get(day) ?? []
                        const isToday = day === today
                        const isPast = today !== null && day < today
                        const open = expanded.includes(day)
                        const shown = open
                          ? dayPosts
                          : dayPosts.slice(0, CELL_LIMIT)
                        return (
                          <div
                            key={day}
                            onDragOver={e => {
                              e.preventDefault()
                              e.dataTransfer.dropEffect = 'move'
                              setDropDay(day)
                            }}
                            onDragLeave={e => {
                              // Moving onto a chip inside the cell is not leaving it.
                              if (e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                return
                              }
                              setDropDay(current =>
                                current === day ? null : current
                              )
                            }}
                            onDrop={e => onDrop(day, e)}
                            className={cn(
                              'border-border @container min-h-28 min-w-0 border-r p-1.5 transition-colors last:border-r-0',
                              !inMonth(day)
                                ? 'bg-surface-hover/50'
                                : isPast
                                  ? 'bg-surface-hover/30'
                                  : col >= 5 && 'bg-surface-hover/20',
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
                                    : !inMonth(day)
                                      ? 'text-muted/70'
                                      : isPast
                                        ? 'text-muted'
                                        : 'text-foreground font-medium'
                                )}
                              >
                                <span aria-hidden>{Number(day.slice(8))}</span>
                                <span className="sr-only">
                                  {dayLabel(day)}
                                  {isToday ? ', today' : ''}
                                </span>
                              </span>
                            </div>
                            {shown.length > 0 && (
                              <ul className="space-y-1">
                                {shown.map(post => (
                                  <li key={post.id}>
                                    <PostChip
                                      post={post}
                                      busy={busyId === post.id}
                                      dragging={draggingId === post.id}
                                      mounted={mounted}
                                      onOpen={() => openDialog(post.id)}
                                      onDragStart={e => startDrag(post.id, e)}
                                      onDragEnd={endDrag}
                                    />
                                  </li>
                                ))}
                              </ul>
                            )}
                            {dayPosts.length > CELL_LIMIT && (
                              <button
                                type="button"
                                aria-expanded={open}
                                aria-label={
                                  open
                                    ? `Show fewer posts on ${dayLabel(day)}`
                                    : `Show ${dayPosts.length - CELL_LIMIT} more posts on ${dayLabel(day)}`
                                }
                                onClick={() =>
                                  setExpanded(prev =>
                                    open
                                      ? prev.filter(d => d !== day)
                                      : [...prev, day]
                                  )
                                }
                                className={cn(
                                  'text-muted hover:text-foreground mt-1 cursor-pointer rounded px-1 text-xs font-medium',
                                  FOCUS_RING
                                )}
                              >
                                {open
                                  ? 'Show less'
                                  : `+${dayPosts.length - CELL_LIMIT} more`}
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
                    mounted={mounted}
                    onOpen={openDialog}
                    empty={
                      <EmptyState
                        compact
                        bordered={false}
                        icon={CalendarDays}
                        title={empty.title}
                        action={
                          empty.showAll && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={empty.showAll}
                              className={FOCUS_RING}
                            >
                              Show all
                            </Button>
                          )
                        }
                      />
                    }
                  />
                </div>
              </div>
            </section>

            <UnplannedList
              posts={notPlanned.filter(ofPlatform)}
              loaded={notPlanned.length}
              total={unscheduledTotal}
              platformName={platformName}
              today={today}
              mounted={mounted}
              busyId={busyId}
              draggingId={draggingId}
              canDropToUnplan={canDropToUnplan}
              onOpen={openDialog}
              onPlan={(id, day) => void plan(id, day)}
              onDragStart={startDrag}
              onDragEnd={endDrag}
              onDropToUnplan={id => {
                endDrag()
                void plan(id, null)
              }}
              onShowAllPlatforms={() => pickPlatform('all')}
            />
          </div>

          <ScheduleForm
            accountId={accountId}
            initialSchedule={schedule}
            nextRun={nextRun}
            goals={goals}
            platforms={platforms}
          />
        </div>
      </div>

      {openPost && (
        <PostDialog
          post={openPost}
          today={today}
          busy={busyId === openPost.id}
          failure={failure?.id === openPost.id ? failure.message : null}
          onRetry={retry}
          onClose={closeDialog}
          onPlan={day => void plan(openPost.id, day)}
          onPosted={posted => void markPosted(openPost.id, posted)}
        />
      )}
    </div>
  )
}

/** The month as a list of the days that have posts, for phones. */
function AgendaList({
  days,
  byDay,
  today,
  busyId,
  mounted,
  onOpen,
  empty
}: {
  days: string[]
  byDay: Map<string, PlannedPost[]>
  today: string | null
  busyId: string | null
  mounted: boolean
  onOpen: (id: string) => void
  /** Shown when no day has a post. */
  empty: ReactNode
}) {
  const withPosts = days.filter(day => (byDay.get(day) ?? []).length > 0)
  if (withPosts.length === 0) return empty
  return (
    <ol className="divide-border divide-y">
      {withPosts.map(day => {
        const dayPosts = byDay.get(day) ?? []
        const isPast = today !== null && day < today
        return (
          <li key={day} className="space-y-2 px-4 py-3">
            <h3
              className={cn(
                'flex items-center gap-2 text-xs font-semibold',
                isPast ? 'text-muted' : 'text-foreground'
              )}
            >
              {dayLabel(day)}
              {day === today && (
                <span className="text-brand-strong font-medium">Today</span>
              )}
            </h3>
            <ul className="space-y-1.5">
              {dayPosts.map(post => (
                <li key={post.id}>
                  <button
                    type="button"
                    data-post-focus={post.id}
                    aria-busy={busyId === post.id || undefined}
                    onClick={() => onOpen(post.id)}
                    className={cn(
                      'border-border bg-surface hover:bg-surface-hover flex w-full cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      FOCUS_RING,
                      busyId === post.id && 'opacity-60'
                    )}
                  >
                    <PlatformMark
                      platform={post.platform}
                      colored
                      className="mt-0.5 h-4 w-4 shrink-0"
                    />
                    <span className="sr-only">
                      {getPlatform(post.platform).name}:{' '}
                    </span>
                    <span className="min-w-0 flex-1 space-y-1.5">
                      <span className="text-foreground line-clamp-2 block text-[13px] leading-snug">
                        {post.hook}
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <StageChip post={post} withTime mounted={mounted} />
                        {post.goalTitle && (
                          <span className="text-muted min-w-0 truncate text-xs">
                            {post.goalTitle}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}
