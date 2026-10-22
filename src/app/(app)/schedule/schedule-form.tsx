'use client'

import { Button } from '@/components/button'
import type { Schedule } from '@/db/schema'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Globe,
  Wand2,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()
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

  /** One convenience, not a shared setting: each day stays its own after. */
  const copyToAllDays = (fromDay: number) =>
    setDayGoals(prev =>
      Object.fromEntries(
        selectedDays.map(day => [day, [...(prev[fromDay] ?? [])]])
      )
    )

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
    try {
      const res = await saveSchedule(accountId, {
        daysOfWeek: selectedDays,
        timeOfDay,
        enabled,
        dayGoals: Object.fromEntries(
          selectedDays.map(d => [String(d), dayGoals[d] ?? []])
        ),
        timezone: zone ?? browserZone ?? undefined
      })
      if (!res.success) {
        setError(res.error || 'Failed to save schedule')
        return
      }
      setSavedSuccess(true)
      router.refresh()
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
        {/* Header: what this is, and the on/off switch */}
        <div className="flex items-start justify-between gap-4 p-5 pb-4">
          <div className="min-w-0">
            <h2 className="text-foreground flex flex-wrap items-center gap-2.5 text-base font-semibold">
              <span className="bg-accent/10 rounded-lg p-1.5">
                <Wand2 className="text-accent h-4 w-4" />
              </span>
              Automatic idea generation
              <span className="rounded bg-amber-100 px-1.5 text-[10px] leading-4 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                Optional
              </span>
            </h2>
            <p className="text-muted mt-2 max-w-2xl text-xs leading-relaxed">
              Starts a run on the days you pick, for the goals you choose for
              each day. It only writes ideas, which wait on Ideas for your
              review; you decide which become posts. To plan the day a post goes
              out, use the calendar above. Nothing is published to LinkedIn.
            </p>
          </div>

          <label className="flex shrink-0 cursor-pointer items-center gap-2.5">
            <span
              id="schedule-enabled-label"
              className={cn(
                'text-xs font-semibold',
                enabled ? 'text-accent' : 'text-muted'
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
              <span className="bg-surface-hover border-border peer peer-checked:after:border-background after:bg-background after:border-border peer-checked:bg-accent peer-focus-visible:ring-accent/40 h-6 w-11 rounded-full border peer-focus-visible:ring-2 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:border after:transition-all after:content-[''] peer-checked:after:translate-x-full" />
            </span>
          </label>
        </div>

        <div className="space-y-5 px-5 pb-5">
          {!enabled && (
            <p className="bg-surface-hover/60 text-muted rounded-lg px-3 py-2 text-xs">
              Automatic runs are off. You can set this up now; nothing runs
              until you turn it on and save.
            </p>
          )}

          {initialSchedule?.lastError && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{initialSchedule.lastError}</span>
            </div>
          )}

          {/* 1. Days */}
          <section aria-labelledby="schedule-days-title">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h3
                id="schedule-days-title"
                className="text-foreground flex items-center gap-2 text-xs font-semibold"
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
                  className="text-muted hover:text-foreground text-[11px] font-medium"
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
                        ? 'bg-surface-hover border-border text-muted hover:text-foreground'
                        : count === 0
                          ? 'border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-300'
                          : 'bg-accent text-background border-accent shadow-xs',
                      isFocused && 'ring-accent/40 ring-2 ring-offset-1'
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
                        <span className="rounded bg-black/15 px-1 text-[10px] leading-4 dark:bg-white/20">
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
                        className="flex w-7 cursor-pointer items-center justify-center border-l border-current/25 opacity-75 transition-opacity hover:bg-black/15 hover:opacity-100 dark:hover:bg-white/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
            <p className="text-muted mt-2 text-[11px]">
              Click a day to add it and switch to its goals. The number is how
              many goals it writes for; ✕ removes the day.
            </p>
          </section>

          {/* 2. Goals of the day being viewed */}
          <section aria-labelledby="schedule-goals-title">
            <h3
              id="schedule-goals-title"
              className="text-foreground mb-2.5 flex items-center gap-2 text-xs font-semibold"
            >
              <StepNumber n={2} />
              Goals for each day
            </h3>

            {focusDay === null ? (
              <p
                role={needsDay ? 'alert' : undefined}
                className={cn(
                  'rounded-xl border border-dashed p-4 text-center text-xs',
                  needsDay
                    ? 'border-amber-500/40 text-amber-700 dark:text-amber-400'
                    : 'border-border text-muted'
                )}
              >
                {needsDay
                  ? 'No day is chosen. Pick at least one day above to schedule runs.'
                  : 'Pick a day above to choose its goals.'}
              </p>
            ) : (
              <div
                role="group"
                aria-label={`Goals for ${focusLabel}`}
                className="border-border overflow-hidden rounded-xl border"
              >
                <div className="bg-surface-hover/50 border-border flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3.5 py-2.5">
                  <label
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2.5',
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
                        setGoalsOf(
                          focusDay,
                          e.target.checked ? availableIds : []
                        )
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
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                          focusGoals.length === 0
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                            : 'bg-accent/10 text-accent'
                        )}
                      >
                        {focusGoals.length} of {goals.length} selected
                      </span>
                      <button
                        type="button"
                        onClick={() => setGoalsOf(focusDay, [])}
                        disabled={focusGoals.length === 0}
                        aria-label={`Clear all goals on ${focusLabel}`}
                        className="text-muted hover:text-foreground disabled:hover:text-muted rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {goals.length === 0 ? (
                  <p className="text-muted p-4 text-xs">
                    You have no goals to schedule yet.{' '}
                    <Link
                      href="/goals"
                      className="text-accent font-medium underline"
                    >
                      Add a goal
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="divide-border max-h-72 divide-y overflow-y-auto">
                    {goals.map(goal => {
                      const checked = focusGoals.includes(goal.id)
                      return (
                        <li key={goal.id}>
                          <label
                            className={cn(
                              'flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 text-xs transition-colors',
                              checked
                                ? 'bg-accent/5'
                                : 'hover:bg-surface-hover/60'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleGoal(focusDay, goal.id)}
                              className="accent-brand mt-0.5 h-4 w-4 shrink-0"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="text-foreground block leading-snug font-medium">
                                {goal.title}
                              </span>
                              <span className="text-muted mt-0.5 block text-[10px] font-semibold tracking-wide uppercase">
                                {goal.objective.replace(/_/g, ' ')}
                              </span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {(needsGoal && goals.length > 0) ||
                (selectedDays.length > 1 && goals.length > 0) ? (
                  <div className="border-border bg-surface-hover/30 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t px-3.5 py-2.5 text-[11px]">
                    {needsGoal ? (
                      <p
                        role="alert"
                        className="text-amber-700 dark:text-amber-400"
                      >
                        Pick at least one goal for{' '}
                        {daysWithoutGoal
                          .map(d => DAYS.find(x => x.id === d)?.name)
                          .join(', ')}
                        , or turn the automatic runs off.
                      </p>
                    ) : (
                      <span />
                    )}
                    {selectedDays.length > 1 && (
                      <button
                        type="button"
                        onClick={() => copyToAllDays(focusDay)}
                        className="text-accent font-medium hover:underline"
                      >
                        Use these goals on every day
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* 3. Time and zone */}
          <section aria-labelledby="schedule-time-title">
            <h3
              id="schedule-time-title"
              className="text-foreground mb-2.5 flex items-center gap-2 text-xs font-semibold"
            >
              <StepNumber n={3} />
              Time
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="schedule-time"
                  className="text-muted mb-1.5 flex items-center gap-1.5 text-[11px] font-medium"
                >
                  <Clock className="h-3.5 w-3.5" />
                  Start time
                </label>
                <input
                  id="schedule-time"
                  type="time"
                  value={timeOfDay}
                  onChange={e => setTimeOfDay(e.target.value)}
                  className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-xl border p-2.5 text-sm outline-none"
                />
              </div>
              <div>
                <p className="text-muted mb-1.5 flex items-center gap-1.5 text-[11px] font-medium">
                  <Globe className="h-3.5 w-3.5" />
                  Time zone
                </p>
                <p className="border-border bg-surface-hover/50 text-foreground rounded-xl border px-3 py-2.5 text-sm">
                  {zone ??
                    (initialSchedule
                      ? 'Server time zone'
                      : (browserZone ?? 'Your time zone'))}
                </p>
              </div>
            </div>
            <p className="text-muted mt-2 text-[11px]">
              {zone
                ? 'Days and time are read in this zone.'
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
                    className="text-accent font-medium hover:underline"
                  >
                    Use {browserZone}
                  </button>
                </>
              )}
            </p>
          </section>

          {/* What happens next, from the saved schedule */}
          {((nextRun && !isDirty) ||
            (initialSchedule?.lastRunAt && mounted)) && (
            <div className="bg-accent/5 border-accent/20 space-y-2 rounded-xl border p-3.5 text-xs">
              {nextRun && !isDirty && (
                <div className="flex items-start gap-2.5">
                  <CalendarClock className="text-accent mt-0.5 h-4 w-4 shrink-0" />
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
              className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400"
            >
              {error}
            </div>
          )}
        </div>

        {/* Save */}
        <div className="border-border bg-surface-hover/30 flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5">
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
        </div>
      </div>
    </form>
  )
}

/** The small numbered marker in front of each section's title. */
function StepNumber({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="bg-accent/10 text-accent flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
    >
      {n}
    </span>
  )
}
