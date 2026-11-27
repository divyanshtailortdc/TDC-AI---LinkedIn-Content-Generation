'use client'

import { Button } from '@/components/button'
import { FormAlert } from '@/components/form-alert'
import { Pagination } from '@/components/pagination'
import { PlatformMark } from '@/components/platform-mark'
import { showToast } from '@/components/toast-notification'
import { EmptyState } from '@/components/ui/empty-state'
import { FIELD_CLASS } from '@/components/ui/field'
import { StatusChip } from '@/components/ui/status-chip'
import { FOCUS_RING, TONES } from '@/components/ui/tone'
import type { Schedule } from '@/db/schema'
import { cn } from '@/lib/cn'
import {
  goalPlatformsLabel,
  goalServes,
  isPlatformId,
  PLATFORMS,
  type PlatformId
} from '@/lib/formats'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Plus,
  Target,
  Wand2,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useId, useRef, useState } from 'react'
import { saveSchedule } from './actions'
import type { NextRun } from './schedule-data'
import { InfoHint } from './schedule-parts'

/** A goal a scheduled run can serve. */
export type ScheduleGoal = {
  id: string
  title: string
  objective: string
  /** The platforms its posts go on; empty or absent is every platform. */
  platforms?: string[]
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
/** The one platform a weekday's run plans for; absent is every platform. */
type DayPlatforms = Record<number, PlatformId>

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
 * When runs start on their own, and on each day for which goals and which
 * platform. A scheduled run only generates ideas, which wait for review like
 * any other run: choosing the day a post goes out is the calendar above, and
 * nothing is published.
 */
export function ScheduleForm({
  accountId,
  initialSchedule,
  nextRun,
  goals,
  platforms = []
}: {
  accountId: string
  initialSchedule: Schedule | null
  /** When the saved schedule next starts a run; null when it is off. */
  nextRun: NextRun | null
  /** The goals a scheduled run can serve. */
  goals: ScheduleGoal[]
  /** The platforms the identity posts on: a day's run can plan for one. */
  platforms?: PlatformId[]
}) {
  const mounted = useHasMounted()
  const browserZone = mounted
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : null
  const availableIds = goals.map(g => g.id)
  const initialDays = (initialSchedule?.daysOfWeek as number[]) || [1, 3, 5]
  const initialDayPlatforms: DayPlatforms = Object.fromEntries(
    initialDays.flatMap(day => {
      const saved = initialSchedule?.dayPlatforms?.[String(day)]
      return isPlatformId(saved) ? [[day, saved]] : []
    })
  )
  /** The goals a day can serve: those meant for its platform, if it has one. */
  const goalIdsFor = (platform: PlatformId | undefined) =>
    goals.filter(g => !platform || goalServes(g, platform)).map(g => g.id)
  // A day the schedule has no goals for yet (one saved before days had their
  // own) serves every goal it can, as it did; a goal deleted since is dropped.
  const initialDayGoals: DayGoals = Object.fromEntries(
    initialDays.map(day => {
      const saved = initialSchedule?.dayGoals?.[String(day)]
      const fit = goalIdsFor(initialDayPlatforms[day])
      return [day, saved ? fit.filter(id => saved.includes(id)) : fit]
    })
  )
  // Platforms a day can be planned for: those the identity posts on, and one
  // a day was saved with before it was turned off.
  const platformChoices = [
    ...platforms,
    ...Object.values(initialDayPlatforms).filter(p => !platforms.includes(p))
  ]

  const [isSaving, setIsSaving] = useState(false)
  const [enabled, setEnabled] = useState<boolean>(
    initialSchedule?.enabled ?? false
  )
  const [selectedDays, setSelectedDays] = useState<number[]>(initialDays)
  const [dayGoals, setDayGoals] = useState<DayGoals>(initialDayGoals)
  const [dayPlatforms, setDayPlatforms] =
    useState<DayPlatforms>(initialDayPlatforms)
  // The day whose goals are shown below the days.
  const [focusDay, setFocusDay] = useState<number | null>(
    initialDays[0] ?? null
  )
  // The goals list, a page at a time; the same page for every day.
  const [goalPage, setGoalPage] = useState(1)
  const { rows: goalRows, pageInfo: goalPageInfo } = paginate(
    goals,
    goalPage,
    PAGE_SIZE
  )
  const goalListRef = useRef<HTMLDivElement>(null)
  const [timeOfDay, setTimeOfDay] = useState<string>(
    initialSchedule?.timeOfDay || '09:00'
  )
  // The zone the days and time are read in; null until a schedule that
  // predates zones is saved, which gives it the viewer's.
  const savedZone = initialSchedule?.timezone ?? null
  const [zone, setZone] = useState<string | null>(savedZone)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The form is secondary on this page: closed until asked for.
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const enabledId = useId()

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

  /**
   * Plans a day for one platform (or every one, with null). Goals not meant
   * for it are unticked, since its run would leave them out anyway.
   */
  const setPlatformOf = (dayId: number, platform: PlatformId | null) => {
    setDayPlatforms(prev => {
      const { [dayId]: _old, ...rest } = prev
      return platform ? { ...rest, [dayId]: platform } : rest
    })
    if (platform) {
      const fit = goalIdsFor(platform)
      setDayGoals(prev => ({
        ...prev,
        [dayId]: (prev[dayId] ?? []).filter(id => fit.includes(id))
      }))
    }
  }

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
    platformOf: DayPlatforms
    time: string
    zone: string | null
  }) =>
    JSON.stringify({
      enabled: v.enabled,
      days: [...v.days].sort(),
      goals: [...v.days].sort().map(d => [d, [...(v.perDay[d] ?? [])].sort()]),
      platforms: [...v.days].sort().map(d => [d, v.platformOf[d] ?? null]),
      time: v.time,
      zone: v.zone
    })
  const isDirty =
    stateKey({
      enabled,
      days: selectedDays,
      perDay: dayGoals,
      platformOf: dayPlatforms,
      time: timeOfDay,
      zone
    }) !==
    stateKey({
      enabled: initialSchedule?.enabled ?? false,
      days: initialDays,
      perDay: initialDayGoals,
      platformOf: initialDayPlatforms,
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
        dayPlatforms: Object.fromEntries(
          selectedDays.flatMap(d => {
            const platform = dayPlatforms[d]
            return platform ? [[String(d), platform]] : []
          })
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
    setDayPlatforms(initialDayPlatforms)
    setFocusDay(initialDays[0] ?? null)
    setTimeOfDay(initialSchedule?.timeOfDay || '09:00')
    setZone(savedZone)
    setSavedSuccess(false)
    setError(null)
  }

  const focusLabel = DAYS.find(d => d.id === focusDay)?.name ?? ''
  const focusGoals = focusDay === null ? [] : (dayGoals[focusDay] ?? [])
  const focusPlatform = focusDay === null ? undefined : dayPlatforms[focusDay]
  // The goals the day being viewed can serve: all, or its platform's.
  const focusFit = goalIdsFor(focusPlatform)
  const goalTitle = (id: string) => goals.find(g => g.id === id)?.title ?? ''
  const allSelected = focusFit.length > 0 && focusGoals.length === focusFit.length
  const someSelected = focusGoals.length > 0 && !allSelected
  // A day can be planned for one platform once there are several to choose from.
  const choosePlatform = platformChoices.length > 1

  const shownZone =
    zone ??
    (initialSchedule ? 'Server time zone' : (browserZone ?? 'Your time zone'))
  const offset = zone && mounted ? gmtOffset(zone) : ''

  // The saved schedule in one line, for the closed section.
  const savedOn = initialSchedule?.enabled ?? false
  const savedSummary = initialSchedule
    ? `${DAYS.filter(d => initialDays.includes(d.id))
        .map(d => d.label)
        .join(', ')} · ${initialSchedule.timeOfDay || '09:00'}`
    : 'Not set up'
  const nextRunLabel = nextRun
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: nextRun.zone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(nextRun.at))
    : null

  // Behind the summary, on hover: what the next run writes for, and the last run.
  const runDetails = [
    savedOn && nextRun && !isDirty
      ? `Next run writes for: ${
          (dayGoals[nextRun.weekday] ?? []).map(goalTitle).join(', ') || 'no goals'
        }${dayPlatforms[nextRun.weekday] ? ` (${PLATFORMS[dayPlatforms[nextRun.weekday]!].label} ideas only)` : ''}`
      : null,
    initialSchedule?.lastRunAt && mounted
      ? `Last run: ${new Date(initialSchedule.lastRunAt).toLocaleString()}`
      : null
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
    >
      <section
        id="automatic-runs"
        aria-labelledby="automatic-runs-title"
        className="border-border bg-surface scroll-mt-4 overflow-hidden rounded-2xl border shadow-xs"
      >
        {/* Closed by default: a summary of the saved schedule; the form opens below. */}
        <h2 id="automatic-runs-title">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(o => !o)}
            className={cn(
              'hover:bg-surface-hover/40 flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition-colors sm:px-5',
              FOCUS_RING,
              'focus-visible:ring-inset'
            )}
          >
            <Wand2 aria-hidden className="text-muted h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="text-foreground block text-sm font-semibold">
                Automatic ideas
              </span>
              <span
                className="text-muted mt-0.5 block truncate text-xs tabular-nums"
                title={runDetails || undefined}
              >
                {savedSummary}
                {savedOn && nextRunLabel && !isDirty && ` · Next ${nextRunLabel}`}
              </span>
            </span>
            {isDirty && !open && (
              <StatusChip tone="warning" size="sm">
                Unsaved
              </StatusChip>
            )}
            {initialSchedule?.lastError && !open && (
              <StatusChip tone="warning" size="sm" title={initialSchedule.lastError}>
                Last run failed
              </StatusChip>
            )}
            <StatusChip tone={savedOn ? 'brand' : 'neutral'} size="sm">
              {savedOn ? 'On' : 'Off'}
            </StatusChip>
            <ChevronDown
              aria-hidden
              className={cn(
                'text-muted h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none',
                open && 'rotate-180'
              )}
            />
          </button>
        </h2>

        {open && (
          <div id={bodyId}>
            <div className="border-border flex items-center justify-between gap-4 border-t px-4 py-4 sm:px-5">
              <span className="text-foreground inline-flex items-center gap-1.5 text-[13px] font-medium">
                <label htmlFor={enabledId} className="cursor-pointer">
                  Run automatically
                </label>
                <InfoHint title="Runs write ideas for your review on the days you pick. Nothing is published." />
              </span>
              <span className="relative inline-flex shrink-0 items-center">
                <input
                  id={enabledId}
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="bg-border peer peer-checked:bg-accent peer-focus-visible:ring-brand/50 h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-2 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:content-[''] peer-checked:after:translate-x-5 motion-reduce:after:transition-none" />
              </span>
            </div>

            {initialSchedule?.lastError && (
              <p
                role="status"
                className={cn(
                  'flex items-start gap-2 px-4 pb-4 text-xs sm:px-5',
                  TONES.warning.text
                )}
              >
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{initialSchedule.lastError}</span>
              </p>
            )}

            {/* Days */}
            <section
              aria-labelledby="schedule-days-title"
              className="border-border space-y-3 border-t px-4 py-4 sm:px-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  id="schedule-days-title"
                  className="text-foreground text-sm font-semibold"
                >
                  Days
                </h3>
                {selectedDays.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDays([])
                      setFocusDay(null)
                    }}
                    aria-label="Clear all days"
                    className={cn(
                      'text-muted hover:text-foreground cursor-pointer rounded text-xs font-medium transition-colors',
                      FOCUS_RING
                    )}
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {DAYS.map(day => {
                  const isSelected = selectedDays.includes(day.id)
                  const isFocused = isSelected && focusDay === day.id
                  const count = (dayGoals[day.id] ?? []).length
                  const dayPlatform = isSelected ? dayPlatforms[day.id] : undefined
                  return (
                    <span
                      key={day.id}
                      className={cn(
                        'inline-flex h-8 items-stretch overflow-hidden rounded-lg border text-xs font-medium transition-colors',
                        !isSelected
                          ? 'bg-surface border-border text-muted hover:border-foreground/30 hover:text-foreground'
                          : count === 0
                            ? TONES.warning.chip
                            : 'border-foreground/20 bg-surface-hover text-foreground',
                        isFocused && 'ring-brand/50 ring-2'
                      )}
                    >
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`${day.name}${isSelected ? `, ${count} goals${dayPlatform ? `, ${PLATFORMS[dayPlatform].label} ideas` : ''}` : ', not scheduled'}`}
                        onClick={() => openDay(day.id)}
                        className="flex min-w-12 cursor-pointer items-center justify-center gap-1.5 px-3 focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none focus-visible:ring-inset"
                      >
                        {dayPlatform && (
                          <PlatformMark platform={dayPlatform} className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {day.label}
                        {isSelected && (
                          <span className="text-muted text-[11px] tabular-nums">
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
                          className="hover:bg-foreground/10 flex w-7 cursor-pointer items-center justify-center border-l border-current/20 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none focus-visible:ring-inset"
                        >
                          <X aria-hidden className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            </section>

            {/* Goals of the day being viewed */}
            <section
              aria-labelledby="schedule-goals-title"
              className="border-border space-y-3 border-t px-4 py-4 sm:px-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h3
                  id="schedule-goals-title"
                  className="text-foreground text-sm font-semibold"
                >
                  {focusLabel ? `Goals on ${focusLabel}` : 'Goals'}
                </h3>
                <Link
                  href="/goals"
                  className={cn(
                    'text-brand-strong inline-flex items-center gap-1 rounded text-xs font-medium hover:underline',
                    FOCUS_RING
                  )}
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" />
                  Add goal
                </Link>
              </div>

              {focusDay === null ? (
                <p
                  role={needsDay ? 'alert' : undefined}
                  className={cn(
                    'text-xs',
                    needsDay ? TONES.warning.text : 'text-muted'
                  )}
                >
                  {needsDay ? 'Pick at least one day' : 'Pick a day'}
                </p>
              ) : (
                <div
                  ref={goalListRef}
                  role="group"
                  aria-label={`Goals for ${focusLabel}`}
                  className="scroll-mt-4 space-y-3"
                >
                  {choosePlatform && (
                    <fieldset className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <legend className="sr-only">Ideas on {focusLabel} are for</legend>
                      <span aria-hidden className="text-muted mr-1 text-xs">
                        Platform
                      </span>
                      {[null, ...platformChoices].map(option => {
                        const on = (focusPlatform ?? null) === option
                        return (
                          <button
                            key={option ?? 'all'}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setPlatformOf(focusDay, option)}
                            className={cn(
                              'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                              FOCUS_RING,
                              on
                                ? 'border-foreground/20 bg-surface-hover text-foreground'
                                : 'text-muted hover:text-foreground border-transparent'
                            )}
                          >
                            {option && (
                              <PlatformMark platform={option} className="h-3.5 w-3.5" />
                            )}
                            {option ? PLATFORMS[option].label : 'All'}
                          </button>
                        )
                      })}
                    </fieldset>
                  )}

                  {goals.length === 0 ? (
                    <EmptyState
                      compact
                      bordered={false}
                      icon={Target}
                      title="No goals yet"
                      action={
                        <Link
                          href="/goals"
                          className={cn(
                            'text-brand-strong rounded text-xs font-medium hover:underline',
                            FOCUS_RING
                          )}
                        >
                          Add goal
                        </Link>
                      }
                    />
                  ) : (
                    <div>
                      <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-2.5">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            ref={el => {
                              if (el) el.indeterminate = someSelected
                            }}
                            checked={allSelected}
                            disabled={focusFit.length === 0}
                            onChange={e =>
                              setGoalsOf(focusDay, e.target.checked ? focusFit : [])
                            }
                            aria-label={`All goals on ${focusLabel}`}
                            className="accent-brand h-4 w-4 shrink-0"
                          />
                          <span className="text-muted text-xs">All</span>
                        </label>
                        <span
                          className={cn(
                            'text-xs font-medium tabular-nums',
                            focusGoals.length === 0 ? TONES.warning.text : 'text-muted'
                          )}
                        >
                          {focusGoals.length}/{focusFit.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => setGoalsOf(focusDay, [])}
                          disabled={focusGoals.length === 0}
                          aria-label={`Clear all goals on ${focusLabel}`}
                          className={cn(
                            'text-muted hover:text-foreground disabled:hover:text-muted cursor-pointer rounded text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                            FOCUS_RING
                          )}
                        >
                          Clear
                        </button>
                      </div>
                      <ul
                        key={goalPageInfo.page}
                        className="divide-border max-h-80 divide-y overflow-y-auto"
                      >
                        {goalRows.map(goal => {
                          const fits = focusFit.includes(goal.id)
                          const checked = fits && focusGoals.includes(goal.id)
                          const where = goalPlatformsLabel(goal.platforms)
                          return (
                            <li key={goal.id}>
                              <label
                                className={cn(
                                  'flex items-center gap-3 py-2.5 transition-colors',
                                  fits ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!fits}
                                  onChange={() => toggleGoal(focusDay, goal.id)}
                                  className="accent-brand h-4 w-4 shrink-0"
                                />
                                <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">
                                  {goal.title}
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium capitalize',
                                    OBJECTIVE_STYLES[goal.objective] ??
                                      'bg-surface-hover text-muted'
                                  )}
                                >
                                  {goal.objective.replace(/_/g, ' ')}
                                </span>
                                {!fits && focusPlatform ? (
                                  <span className="text-muted shrink-0 text-xs">
                                    Not for {PLATFORMS[focusPlatform].label}
                                  </span>
                                ) : (
                                  where && (
                                    <span className="text-muted hidden shrink-0 text-xs sm:inline">
                                      {where}
                                    </span>
                                  )
                                )}
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                      {goalPageInfo.pageCount > 1 && (
                        <div className="border-border border-t pt-2.5">
                          <Pagination
                            {...goalPageInfo}
                            noun="goals"
                            onPageChange={setGoalPage}
                            scrollTarget={goalListRef}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {goals.length > 0 && needsGoal && (
                    <p role="alert" className={cn('text-xs', TONES.warning.text)}>
                      Pick a goal for{' '}
                      {daysWithoutGoal
                        .map(d => DAYS.find(x => x.id === d)?.name)
                        .join(', ')}
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Time and zone */}
            <section
              aria-labelledby="schedule-time-title"
              className="border-border space-y-3 border-t px-4 py-4 sm:px-5"
            >
              <h3
                id="schedule-time-title"
                className="text-foreground text-sm font-semibold"
              >
                Time
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="schedule-time"
                    className="text-muted mb-1.5 block text-xs"
                  >
                    Start time
                  </label>
                  <input
                    id="schedule-time"
                    type="time"
                    value={timeOfDay}
                    onChange={e => setTimeOfDay(e.target.value)}
                    className={cn(FIELD_CLASS, 'h-9 py-1.5 text-[13px]')}
                  />
                </div>
                <div>
                  <p className="text-muted mb-1.5 flex items-center gap-1.5 text-xs">
                    Time zone
                    <InfoHint
                      title={
                        zone
                          ? 'Days and time are read in this zone.'
                          : initialSchedule
                            ? "Runs in the server's zone until you save; saving switches it to yours."
                            : 'Days and time are read in your zone.'
                      }
                    />
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="border-border bg-surface-hover/50 text-foreground flex h-9 min-w-0 flex-1 items-center rounded-lg border px-3 text-[13px]">
                      <span className="truncate">{shownZone}</span>
                      {offset && (
                        <span className="text-muted ml-1.5 shrink-0">({offset})</span>
                      )}
                    </p>
                    {zone && browserZone && zone !== browserZone && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setZone(browserZone)}
                        title={`Your browser is in ${browserZone}`}
                        className={FOCUS_RING}
                      >
                        Use mine
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <FormAlert variant="error" className="rounded-xl px-3.5 py-2.5 text-xs">
                  {error}
                </FormAlert>
              )}
            </section>

            {/* Cancel and the primary Save */}
            <footer className="border-border flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3 sm:px-5">
              {savedSuccess && !isDirty && (
                <span
                  role="status"
                  className={cn(
                    'mr-auto flex items-center gap-1.5 text-xs font-medium',
                    TONES.success.text
                  )}
                >
                  <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                  Saved
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
                Save
              </Button>
            </footer>
          </div>
        )}
      </section>
    </form>
  )
}
