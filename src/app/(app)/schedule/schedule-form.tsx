'use client'

import { Button } from '@/components/button'
import { showToast } from '@/components/toast-notification'
import type { Schedule } from '@/db/schema'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Globe,
  Plus,
  Wand2,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { saveSchedule } from './actions'
import type { NextRun } from './schedule-data'

/** A goal a scheduled run can serve. */
export type ScheduleGoal = {
  id: string
  title: string
  objective: string
}

const DAYS = [
  { id: 1, label: 'Mon', name: 'Monday' },
  { id: 2, label: 'Tue', name: 'Tuesday' },
  { id: 3, label: 'Wed', name: 'Wednesday' },
  { id: 4, label: 'Thu', name: 'Thursday' },
  { id: 5, label: 'Fri', name: 'Friday' },
  { id: 6, label: 'Sat', name: 'Saturday' },
  { id: 0, label: 'Sun', name: 'Sunday' }
]

/** Goals by weekday, for the days the schedule runs on. */
type DayGoals = Record<number, string[]>

/** A goal's category as a quiet coloured label; unknown ones stay neutral. */
const OBJECTIVE_STYLES: Record<string, string> = {
  awareness: 'bg-brand/10 text-brand-strong',
  authority: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  engagement: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  lead_gen: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  recruiting: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  community: 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
}

/** "GMT+05:30" for a zone right now; empty when the runtime cannot say. */
function gmtOffset(zone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        timeZoneName: 'longOffset'
      })
        .formatToParts(new Date())
        .find(part => part.type === 'timeZoneName')?.value ?? ''
    )
  } catch {
    return ''
  }
}

/**
 * When runs start on their own, and for which goals on each day. A scheduled
 * run only generates ideas, which wait for review like any other run: choosing
 * the day a post goes out is the calendar above, and nothing is published.
 */
export function ScheduleForm({
  accountId,
  initialSchedule,
  nextRun,
  goals
}: {
  accountId: string
  initialSchedule: Schedule | null
  /** When the saved schedule next starts a run; null when it is off. */
  nextRun: NextRun | null
  /** The goals a scheduled run can serve. */
  goals: ScheduleGoal[]
}) {
  const mounted = useHasMounted()
  const browserZone = mounted
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : null
  const availableIds = goals.map(g => g.id)
  const initialDays = (initialSchedule?.daysOfWeek as number[]) || [1, 3, 5]
  // A day the schedule has no goals for yet (one saved before days had their
  // own) serves every goal, as it did; a goal deleted since is dropped.
  const initialDayGoals: DayGoals = Object.fromEntries(
    initialDays.map(day => {
      const saved = initialSchedule?.dayGoals?.[String(day)]
      return [
        day,
        saved ? availableIds.filter(id => saved.includes(id)) : availableIds
      ]
    })
  )

  const [isSaving, setIsSaving] = useState(false)
  const [enabled, setEnabled] = useState<boolean>(
    initialSchedule?.enabled ?? false
  )
  const [selectedDays, setSelectedDays] = useState<number[]>(initialDays)
  const [dayGoals, setDayGoals] = useState<DayGoals>(initialDayGoals)
  // The day whose goals are shown below the days.
  const [focusDay, setFocusDay] = useState<number | null>(
    initialDays[0] ?? null
  )
  const [timeOfDay, setTimeOfDay] = useState<string>(
    initialSchedule?.timeOfDay || '09:00'
  )
  // The zone the days and time are read in; null until a schedule that
  // predates zones is saved, which gives it the viewer's.
  const savedZone = initialSchedule?.timezone ?? null
  const [zone, setZone] = useState<string | null>(savedZone)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Shows a day's goals, adding the day (with every goal) when it is new. */
  const openDay = (dayId: number) => {
    setFocusDay(dayId)
    if (selectedDays.includes(dayId)) return
    setSelectedDays([...selectedDays, dayId])
    setDayGoals(prev => ({ ...prev, [dayId]: availableIds }))
  }

  /** Takes a day off the schedule; its goals are forgotten with it. */
  const removeDay = (dayId: number) => {
    const left = selectedDays.filter(d => d !== dayId)
    setSelectedDays(left)
    if (focusDay === dayId) setFocusDay(left[0] ?? null)
  }

  const setGoalsOf = (dayId: number, ids: string[]) =>
    setDayGoals(prev => ({ ...prev, [dayId]: ids }))

  const toggleGoal = (dayId: number, goalId: string) =>
    setDayGoals(prev => {
      const current = prev[dayId] ?? []
      return {
        ...prev,
        [dayId]: current.includes(goalId)
          ? current.filter(id => id !== goalId)
          : [...current, goalId]
      }
    })

  // Untouched settings are not saved, so visiting the page never creates a
  // schedule the user did not ask for.
  const stateKey = (v: {
    enabled: boolean
    days: number[]
    perDay: DayGoals
    time: string
    zone: string | null
  }) =>
    JSON.stringify({
      enabled: v.enabled,
      days: [...v.days].sort(),
      goals: [...v.days].sort().map(d => [d, [...(v.perDay[d] ?? [])].sort()]),
      time: v.time,
      zone: v.zone
    })
  const isDirty =
    stateKey({
      enabled,
      days: selectedDays,
      perDay: dayGoals,
      time: timeOfDay,
      zone
    }) !==
    stateKey({
      enabled: initialSchedule?.enabled ?? false,
      days: initialDays,
      perDay: initialDayGoals,
      time: initialSchedule?.timeOfDay || '09:00',
      zone: savedZone
    })
  const daysWithoutGoal = enabled
    ? selectedDays.filter(d => (dayGoals[d] ?? []).length === 0)
    : []
  const needsGoal = daysWithoutGoal.length > 0
  const needsDay = selectedDays.length === 0

  const save = async () => {
    if (!isDirty || needsGoal || needsDay) return
    setIsSaving(true)
    setSavedSuccess(false)
    setError(null)
    const timezone = zone ?? browserZone ?? undefined
    try {
      const res = await saveSchedule(accountId, {
        daysOfWeek: selectedDays,
        timeOfDay,
        enabled,
        dayGoals: Object.fromEntries(
          selectedDays.map(d => [String(d), dayGoals[d] ?? []])
        ),
        timezone
      })
      if (!res.success) {
        const message = res.error || 'Failed to save schedule'
        setError(message)
        showToast({ title: 'Schedule not saved', message, type: 'error' })
        return
      }
      // The schedule now has the zone just sent. A first save had none in
      // state, which then read as "Server time zone" and an unsaved change.
      if (timezone) setZone(timezone)
      setSavedSuccess(true)
      const days = DAYS.filter(d => selectedDays.includes(d.id))
        .map(d => d.label)
        .join(', ')
      showToast({
        title: 'Schedule saved',
        message: enabled
          ? `Ideas will be generated on ${days} at ${timeOfDay}${timezone ? ` (${timezone})` : ''}.`
          : 'Automatic runs are off. Nothing runs until you turn them on and save.',
        type: 'success'
      })
    } catch {
      // The request itself failed (offline, server unreachable): nothing saved.
      const message =
        'Could not reach the server. Check your connection and try again.'
      setError(message)
      showToast({ title: 'Schedule not saved', message, type: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const reset = () => {
    setEnabled(initialSchedule?.enabled ?? false)
    setSelectedDays(initialDays)
    setDayGoals(initialDayGoals)
    setFocusDay(initialDays[0] ?? null)
    setTimeOfDay(initialSchedule?.timeOfDay || '09:00')
    setZone(savedZone)
    setSavedSuccess(false)
    setError(null)
  }

  const focusLabel = DAYS.find(d => d.id === focusDay)?.name ?? ''
  const focusGoals = focusDay === null ? [] : (dayGoals[focusDay] ?? [])
  const goalTitle = (id: string) => goals.find(g => g.id === id)?.title ?? ''
  const allSelected = goals.length > 0 && focusGoals.length === goals.length
  const someSelected = focusGoals.length > 0 && !allSelected

  const shownZone =
    zone ??
    (initialSchedule ? 'Server time zone' : (browserZone ?? 'Your time zone'))
  const offset = zone && mounted ? gmtOffset(zone) : ''

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      className="space-y-6"
    >
      <div
        id="automatic-runs"
        className="border-border bg-surface scroll-mt-4 overflow-hidden rounded-2xl border shadow-xs"
      >
        {/* Header: title, badge and description on the left; switch on the right */}
        <header className="space-y-4 px-5 pt-5 pb-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="bg-surface-hover border-border flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border">
                <Wand2 className="text-foreground h-4 w-4" />
              </span>
              <h2 className="text-foreground flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-base font-semibold">
                Automatic idea generation
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] leading-4 font-semibold text-amber-700 dark:text-amber-300">
                  Optional
                </span>
              </h2>
            </div>

            <label className="flex shrink-0 cursor-pointer items-center gap-2.5 pt-1.5">
              <span
                id="schedule-enabled-label"
                className={cn(
                  'text-[11px] font-semibold tracking-wide uppercase',
                  enabled ? 'text-foreground' : 'text-muted'
                )}
              >
                {enabled ? 'On' : 'Off'}
              </span>
              <span className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  aria-label="Generate ideas automatically"
                  className="peer sr-only"
                />
                <span className="bg-border peer peer-checked:bg-accent peer-focus-visible:ring-brand/50 h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:content-[''] peer-checked:after:translate-x-5" />
              </span>
            </label>
          </div>

          <p className="text-muted max-w-2xl text-[13px] leading-relaxed">
            Starts a run on the days you pick, for the goals you choose for each
            day. It only writes ideas, which wait on Ideas for your review; you
            decide which become posts. To plan the day a post goes out, use the
            calendar above. Nothing is published to LinkedIn.
          </p>

          {/* Status */}
          <div
            role="status"
            className={cn(
              'flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs leading-relaxed',
              enabled
                ? 'border-brand/25 bg-brand/5 text-foreground'
                : 'border-border bg-surface-hover/60 text-muted'
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                enabled ? 'bg-brand' : 'bg-muted/60'
              )}
            />
            <p>
              {enabled ? (
                <>
                  <span className="font-semibold">
                    Automatic runs are active.
                  </span>{' '}
                  <span className="text-muted">
                    Ideas are drafted on schedule and wait in your queue for
                    review.
                  </span>
                </>
              ) : (
                <>
                  <span className="text-foreground font-semibold">
                    Automatic runs are off.
                  </span>{' '}
                  You can set this up now; nothing runs until you turn it on and
                  save.
                </>
              )}
            </p>
          </div>

          {initialSchedule?.lastError && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{initialSchedule.lastError}</span>
            </div>
          )}
        </header>

        {/* 1. Days */}
        <section
          aria-labelledby="schedule-days-title"
          className="border-border space-y-3 border-t px-5 py-5 sm:px-6"
        >
          <div className="flex items-center justify-between gap-2">
            <h3
              id="schedule-days-title"
              className="text-foreground flex items-center gap-2.5 text-sm font-semibold"
            >
              <StepNumber n={1} />
              Days
            </h3>
            {selectedDays.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDays([])
                  setFocusDay(null)
                }}
                className="text-muted hover:text-foreground text-xs font-medium transition-colors"
              >
                Clear all days
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map(day => {
              const isSelected = selectedDays.includes(day.id)
              const isFocused = isSelected && focusDay === day.id
              const count = (dayGoals[day.id] ?? []).length
              return (
                <span
                  key={day.id}
                  className={cn(
                    'inline-flex h-9 items-stretch overflow-hidden rounded-lg border text-xs font-semibold transition-all',
                    !isSelected
                      ? 'bg-surface border-border text-muted hover:border-foreground/30 hover:text-foreground'
                      : count === 0
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                        : 'bg-accent text-background border-accent shadow-xs',
                    isFocused && 'ring-brand/50 ring-2 ring-offset-2'
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${day.name}${isSelected ? `, ${count} goals` : ', not scheduled'}`}
                    onClick={() => openDay(day.id)}
                    className="flex min-w-12 cursor-pointer items-center justify-center gap-1.5 px-3"
                  >
                    {day.label}
                    {isSelected && (
                      <span className="rounded bg-white/20 px-1.5 text-[10px] leading-4 tabular-nums">
                        {count}
                      </span>
                    )}
                  </button>
                  {isSelected && (
                    <button
                      type="button"
                      onClick={() => removeDay(day.id)}
                      aria-label={`Remove ${day.name} from the schedule`}
                      title={`Remove ${day.name}`}
                      className="flex w-7 cursor-pointer items-center justify-center border-l border-current/25 opacity-70 transition-opacity hover:bg-white/15 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              )
            })}
          </div>

          <p className="text-muted text-xs">
            Click a day to add it and switch to its goals. The number is how
            many goals it writes for; ✕ removes the day.
          </p>
        </section>

        {/* 2. Goals of the day being viewed */}
        <section
          aria-labelledby="schedule-goals-title"
          className="border-border space-y-3 border-t px-5 py-5 sm:px-6"
        >
          <div className="flex items-center justify-between gap-2">
            <h3
              id="schedule-goals-title"
              className="text-foreground flex items-center gap-2.5 text-sm font-semibold"
            >
              <StepNumber n={2} />
              Goals for each day
            </h3>
            <Link
              href="/goals"
              className="text-brand-strong inline-flex items-center gap-1 text-xs font-medium hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Add goal
            </Link>
          </div>

          {focusDay === null ? (
            <div
              role={needsDay ? 'alert' : undefined}
              className={cn(
                'flex flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center text-xs',
                needsDay
                  ? 'border-amber-500/50 bg-amber-500/5 text-amber-800 dark:text-amber-300'
                  : 'border-border text-muted'
              )}
            >
              <p className="text-sm font-semibold">
                {needsDay ? 'No day is chosen' : 'No day selected'}
              </p>
              <p>
                {needsDay
                  ? 'Pick at least one day above to schedule runs.'
                  : 'Pick a day above to choose its goals.'}
              </p>
            </div>
          ) : (
            <div
              role="group"
              aria-label={`Goals for ${focusLabel}`}
              className="border-border overflow-hidden rounded-xl border"
            >
              <div className="bg-surface-hover/50 border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
                <label
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-3',
                    goals.length === 0 ? 'cursor-default' : 'cursor-pointer'
                  )}
                >
                  <input
                    type="checkbox"
                    ref={el => {
                      if (el) el.indeterminate = someSelected
                    }}
                    checked={allSelected}
                    disabled={goals.length === 0}
                    onChange={e =>
                      setGoalsOf(focusDay, e.target.checked ? availableIds : [])
                    }
                    aria-label={`All goals on ${focusLabel}`}
                    title="All goals"
                    className="accent-brand h-4 w-4 shrink-0"
                  />
                  <span className="text-foreground truncate text-sm font-semibold">
                    Goals on {focusLabel}
                  </span>
                </label>
                {goals.length > 0 && (
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums',
                        focusGoals.length === 0
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-brand/10 text-brand-strong'
                      )}
                    >
                      {focusGoals.length} of {goals.length} selected
                    </span>
                    <button
                      type="button"
                      onClick={() => setGoalsOf(focusDay, [])}
                      disabled={focusGoals.length === 0}
                      aria-label={`Clear all goals on ${focusLabel}`}
                      className="text-muted hover:text-foreground disabled:hover:text-muted text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {goals.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-foreground text-sm font-semibold">
                    You have no goals yet
                  </p>
                  <p className="text-muted text-xs">
                    A run writes toward goals you set. Add one to schedule it.
                  </p>
                  <Link
                    href="/goals"
                    className="text-brand-strong text-xs font-medium hover:underline"
                  >
                    Add a goal
                  </Link>
                </div>
              ) : (
                <ul className="divide-border max-h-80 divide-y overflow-y-auto">
                  {goals.map(goal => {
                    const checked = focusGoals.includes(goal.id)
                    return (
                      <li key={goal.id}>
                        <label
                          className={cn(
                            'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors',
                            checked ? 'bg-brand/5' : 'hover:bg-surface-hover/60'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleGoal(focusDay, goal.id)}
                            className="accent-brand mt-0.5 h-4 w-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1 space-y-1.5">
                            <span className="text-foreground block text-[13px] leading-snug font-medium">
                              {goal.title}
                            </span>
                            <span
                              className={cn(
                                'inline-block rounded px-1.5 py-0.5 text-[10px] leading-3.5 font-semibold tracking-wide uppercase',
                                OBJECTIVE_STYLES[goal.objective] ??
                                  'bg-surface-hover text-muted'
                              )}
                            >
                              {goal.objective.replace(/_/g, ' ')}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              {goals.length > 0 && needsGoal && (
                <div className="border-border bg-surface-hover/30 border-t px-4 py-2.5 text-xs">
                  <p
                    role="alert"
                    className="text-amber-700 dark:text-amber-300"
                  >
                    Pick at least one goal for{' '}
                    {daysWithoutGoal
                      .map(d => DAYS.find(x => x.id === d)?.name)
                      .join(', ')}
                    , or turn the automatic runs off.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 3. Time and zone */}
        <section
          aria-labelledby="schedule-time-title"
          className="border-border space-y-3 border-t px-5 py-5 sm:px-6"
        >
          <h3
            id="schedule-time-title"
            className="text-foreground flex items-center gap-2.5 text-sm font-semibold"
          >
            <StepNumber n={3} />
            Time &amp; time zone
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="schedule-time"
                className="text-muted mb-1.5 flex items-center gap-1.5 text-xs font-medium"
              >
                <Clock className="h-3.5 w-3.5" />
                Start time
              </label>
              <input
                id="schedule-time"
                type="time"
                value={timeOfDay}
                onChange={e => setTimeOfDay(e.target.value)}
                className="border-border bg-surface text-foreground focus:border-brand focus:ring-brand/20 h-10 w-full rounded-lg border px-3 text-sm outline-none focus:ring-2"
              />
            </div>
            <div>
              <p className="text-muted mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                <Globe className="h-3.5 w-3.5" />
                Time zone
              </p>
              <p className="border-border bg-surface-hover/50 text-foreground flex h-10 items-center rounded-lg border px-3 text-sm">
                <span className="truncate">{shownZone}</span>
                {offset && (
                  <span className="text-muted ml-1.5 shrink-0">({offset})</span>
                )}
              </p>
            </div>
          </div>
          <p className="text-muted text-xs leading-relaxed">
            {zone
              ? 'Days and time are read in this zone. Scheduled runs start automatically on this clock.'
              : initialSchedule
                ? `This schedule runs in the server's time zone until you save; saving switches it to yours${browserZone ? ` (${browserZone})` : ''}.`
                : 'Days and time are read in your time zone.'}
            {zone && browserZone && zone !== browserZone && (
              <>
                {' '}
                Your browser is in {browserZone}.{' '}
                <button
                  type="button"
                  onClick={() => setZone(browserZone)}
                  className="text-brand-strong font-medium hover:underline"
                >
                  Use {browserZone}
                </button>
              </>
            )}
          </p>

          {/* What happens next, from the saved schedule */}
          {((nextRun && !isDirty) ||
            (initialSchedule?.lastRunAt && mounted)) && (
            <div className="border-brand/25 bg-brand/5 space-y-2 rounded-xl border px-3.5 py-3 text-xs">
              {nextRun && !isDirty && (
                <div className="flex items-start gap-2.5">
                  <CalendarClock className="text-brand-strong mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-foreground font-semibold">
                      Next run:{' '}
                      {new Intl.DateTimeFormat('en-US', {
                        timeZone: nextRun.zone,
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        hourCycle: 'h23'
                      }).format(new Date(nextRun.at))}{' '}
                      <span className="text-muted font-normal">
                        ({nextRun.zone})
                      </span>
                    </p>
                    <p className="text-muted mt-0.5 leading-relaxed">
                      Writes for:{' '}
                      {(dayGoals[nextRun.weekday] ?? [])
                        .map(goalTitle)
                        .join(', ') || 'no goals'}
                    </p>
                  </div>
                </div>
              )}
              {initialSchedule?.lastRunAt && mounted && (
                <p className="text-muted">
                  Last automatic run:{' '}
                  {new Date(initialSchedule.lastRunAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400"
            >
              {error}
            </div>
          )}
        </section>

        {/* Footer: Cancel and the primary Save */}
        <footer className="border-border bg-surface-hover/40 flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5 sm:px-6">
          {savedSuccess && !isDirty && (
            <span className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Schedule saved.
            </span>
          )}
          {isDirty && (
            <Button
              variant="secondary"
              size="sm"
              onClick={reset}
              disabled={isSaving}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            loading={isSaving}
            disabled={!isDirty || needsGoal || needsDay}
          >
            Save schedule
          </Button>
        </footer>
      </div>
    </form>
  )
}

/** The small numbered marker in front of each section's title. */
function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="bg-accent text-background flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
    >
      {n}
    </span>
  )
}
