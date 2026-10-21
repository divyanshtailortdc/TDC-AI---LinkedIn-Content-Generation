'use client'

import type { Schedule } from '@/db/schema'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Wand2
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { saveSchedule } from './actions'

const DAYS = [
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
  { id: 0, label: 'Sun' }
]

/**
 * When runs start on their own. A scheduled run generates ideas for the
 * active goals and waits for review like any other run; it never publishes.
 */
export function ScheduleForm({
  accountId,
  initialSchedule,
  activeGoalCount
}: {
  accountId: string
  initialSchedule: Schedule | null
  /** Scheduled runs serve every active goal; with none they are skipped. */
  activeGoalCount: number
}) {
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)
  const [enabled, setEnabled] = useState<boolean>(
    initialSchedule?.enabled ?? false
  )
  const [selectedDays, setSelectedDays] = useState<number[]>(
    (initialSchedule?.daysOfWeek as number[]) || [1, 3, 5]
  )
  const [timeOfDay, setTimeOfDay] = useState<string>(
    initialSchedule?.timeOfDay || '09:00'
  )
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleDay = (dayId: number) => {
    if (selectedDays.includes(dayId)) {
      if (selectedDays.length > 1) {
        setSelectedDays(selectedDays.filter(d => d !== dayId))
      }
    } else {
      setSelectedDays([...selectedDays, dayId])
    }
  }

  // Untouched settings are not saved, so visiting the page never creates a
  // schedule the user did not ask for.
  const initialKey = JSON.stringify({
    enabled: initialSchedule?.enabled ?? false,
    days: [...((initialSchedule?.daysOfWeek as number[]) || [1, 3, 5])].sort(),
    time: initialSchedule?.timeOfDay || '09:00'
  })
  const isDirty =
    JSON.stringify({
      enabled,
      days: [...selectedDays].sort(),
      time: timeOfDay
    }) !== initialKey

  const save = async () => {
    if (!isDirty) return
    setIsSaving(true)
    setSavedSuccess(false)
    setError(null)
    try {
      const res = await saveSchedule(accountId, {
        daysOfWeek: selectedDays,
        timeOfDay,
        enabled
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
    setSelectedDays((initialSchedule?.daysOfWeek as number[]) || [1, 3, 5])
    setTimeOfDay(initialSchedule?.timeOfDay || '09:00')
    setSavedSuccess(false)
    setError(null)
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      className="space-y-6"
    >
      {/* Main Schedule Card */}
      <div
        id="automatic-runs"
        className="border-border bg-surface scroll-mt-4 space-y-5 rounded-2xl border p-5 shadow-xs"
      >
        <div>
          <h2 className="text-foreground flex items-center gap-2.5 text-base font-semibold">
            <span className="bg-accent/10 rounded-lg p-1.5">
              <Wand2 className="text-accent h-4 w-4" />
            </span>
            Automatic idea generation
            <span className="rounded bg-amber-100 px-1.5 text-[10px] leading-4 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              Optional
            </span>
          </h2>
          <p className="text-muted mt-1 text-xs leading-relaxed">
            Starts a run on the days below for every active goal. Its ideas wait
            for your review like any other run. Nothing is published to
            LinkedIn.
          </p>
        </div>

        {enabled && activeGoalCount === 0 && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              You have no active goals, so scheduled runs are skipped.{' '}
              <Link href="/goals" className="font-medium underline">
                Add or resume a goal
              </Link>
              .
            </span>
          </div>
        )}

        {/* Enable Schedule Toggle */}
        <div className="border-border flex items-center justify-between border-b pb-5">
          <span
            id="schedule-enabled-label"
            className="text-foreground text-sm font-semibold"
          >
            Generate ideas automatically
          </span>

          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              aria-labelledby="schedule-enabled-label"
              className="peer sr-only"
            />
            <div className="bg-surface-hover border-border peer peer-checked:after:border-background after:bg-background after:border-border peer-checked:bg-accent h-6 w-11 rounded-full border peer-focus:outline-none after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:border after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
          </label>
        </div>

        {/* Days of week selector */}
        <div>
          <p className="text-foreground mb-2 block text-xs font-semibold">
            Days
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map(day => {
              const isSelected = selectedDays.includes(day.id)
              return (
                <button
                  key={day.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleDay(day.id)}
                  className={`h-8 w-11 cursor-pointer rounded-lg border text-xs font-semibold transition-all ${
                    isSelected
                      ? 'bg-accent text-background border-accent shadow-xs'
                      : 'bg-surface-hover border-border text-muted hover:text-foreground'
                  }`}
                >
                  {day.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Time of day */}
        <div className="max-w-xs">
          <label
            htmlFor="schedule-time"
            className="text-foreground mb-1.5 flex items-center gap-1.5 text-xs font-semibold"
          >
            <Clock className="text-muted h-3.5 w-3.5" />
            Time
          </label>
          <input
            id="schedule-time"
            type="time"
            value={timeOfDay}
            onChange={e => setTimeOfDay(e.target.value)}
            className="border-border bg-surface-hover text-foreground w-full rounded-xl border p-2.5 text-xs outline-none"
          />
          <p className="text-muted mt-1 text-[11px]">
            Uses the server&apos;s time zone.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400"
          >
            {error}
          </div>
        )}

        <div className="border-border flex items-center justify-end gap-2 border-t pt-4">
          {savedSuccess && !isDirty && (
            <span className="mr-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Schedule saved.
            </span>
          )}
          {isDirty && (
            <button
              type="button"
              onClick={reset}
              disabled={isSaving}
              className="text-muted hover:text-foreground h-8 rounded-lg px-3.5 text-[13px] font-medium disabled:opacity-60"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={!isDirty || isSaving}
            className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save schedule
          </button>
        </div>
      </div>
    </form>
  )
}
