'use client'

import {
  useStepSave,
  useStepView
} from '@/components/account-setup/setup-frame'
import { Calendar, CheckCircle2, Clock } from 'lucide-react'
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

export function ScheduleForm({
  accountId,
  initialSchedule
}: {
  accountId: string
  initialSchedule?: any
}) {
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

  // Untouched settings are not saved, so visiting Preferences never creates a
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

  // Runs from the header's Save & Next (after Preferences); false keeps the
  // user on this step.
  const save = async (): Promise<boolean> => {
    if (!isDirty) return true
    setSavedSuccess(false)
    setError(null)
    const res = await saveSchedule(accountId, {
      daysOfWeek: selectedDays,
      timeOfDay,
      enabled
    })
    if (!res.success) {
      setError(res.error || 'Failed to save schedule')
      return false
    }
    setSavedSuccess(true)
    return true
  }
  useStepSave(save)

  // The header's Cancel puts the schedule back to what is saved.
  useStepView({
    dirty: isDirty,
    onCancel: () => {
      setEnabled(initialSchedule?.enabled ?? false)
      setSelectedDays((initialSchedule?.daysOfWeek as number[]) || [1, 3, 5])
      setTimeOfDay(initialSchedule?.timeOfDay || '09:00')
      setSavedSuccess(false)
      setError(null)
    }
  })

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      className="space-y-6"
    >
      {savedSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Schedule saved successfully! Automated background runs will trigger
            at configured times.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {/* Main Schedule Card */}
      <div
        id="schedule"
        className="border-border bg-surface scroll-mt-4 space-y-6 rounded-2xl border p-6 shadow-xs sm:p-8"
      >
        <div>
          <h2 className="text-foreground flex items-center gap-2.5 text-base font-semibold">
            <span className="bg-accent/10 rounded-lg p-1.5">
              <Calendar className="text-accent h-4 w-4" />
            </span>
            Schedule
            <span className="rounded bg-amber-100 px-1.5 text-[10px] leading-4 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              Optional
            </span>
          </h2>
          <p className="text-muted mt-0.5 text-xs">
            Leave it off to start runs yourself from the Runs step.
          </p>
        </div>

        {/* Enable Schedule Toggle */}
        <div className="border-border flex items-center justify-between border-b pb-6">
          <div>
            <span className="text-foreground block text-sm font-semibold">
              Generate Ideas Automatically
            </span>
            <span className="text-muted mt-0.5 block text-xs">
              Fresh ideas wait in your queue on the days you pick. The number of
              ideas per run is set above.
            </span>
          </div>

          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <div className="bg-surface-hover border-border peer peer-checked:after:border-background after:bg-background after:border-border peer-checked:bg-accent h-6 w-11 rounded-full border peer-focus:outline-none after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:border after:transition-all after:content-[''] peer-checked:after:translate-x-full"></div>
          </label>
        </div>

        {/* Days of week selector */}
        <div>
          <label className="text-foreground mb-2 block text-xs font-semibold">
            Days
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map(day => {
              const isSelected = selectedDays.includes(day.id)
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => toggleDay(day.id)}
                  className={`h-10 w-12 cursor-pointer rounded-xl border text-xs font-semibold transition-all ${
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
          <label className="text-foreground mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
            <Clock className="text-muted h-3.5 w-3.5" />
            Time
          </label>
          <input
            type="time"
            value={timeOfDay}
            onChange={e => setTimeOfDay(e.target.value)}
            className="border-border bg-surface-hover text-foreground w-full rounded-xl border p-2.5 text-xs outline-none"
          />
          <p className="text-muted mt-1 text-[11px]">
            Uses the server&apos;s time zone.
          </p>
        </div>
      </div>
    </form>
  )
}
