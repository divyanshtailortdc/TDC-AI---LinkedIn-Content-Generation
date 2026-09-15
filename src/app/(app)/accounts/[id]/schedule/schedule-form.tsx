'use client'

import { CheckCircle2, Clock, Loader2, Save } from 'lucide-react'
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
  const [frequency, setFrequency] = useState<string>(
    initialSchedule?.frequency || 'weekly'
  )
  const [selectedDays, setSelectedDays] = useState<number[]>(
    (initialSchedule?.daysOfWeek as number[]) || [1, 3, 5]
  )
  const [timeOfDay, setTimeOfDay] = useState<string>(
    initialSchedule?.timeOfDay || '09:00'
  )
  const [postsPerRun, setPostsPerRun] = useState<number>(
    initialSchedule?.postsPerRun || 1
  )
  const [ideasPerRun, setIdeasPerRun] = useState<number>(
    initialSchedule?.ideasPerRun || 3
  )
  const [isSaving, setIsSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)

  const toggleDay = (dayId: number) => {
    if (selectedDays.includes(dayId)) {
      if (selectedDays.length > 1) {
        setSelectedDays(selectedDays.filter(d => d !== dayId))
      }
    } else {
      setSelectedDays([...selectedDays, dayId])
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setSavedSuccess(false)
    try {
      const res = await saveSchedule(accountId, {
        frequency,
        daysOfWeek: selectedDays,
        timeOfDay,
        postsPerRun,
        ideasPerRun,
        enabled
      })
      if (res.success) {
        setSavedSuccess(true)
        setTimeout(() => setSavedSuccess(false), 3000)
      }
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      {savedSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Schedule saved successfully! Automated background runs will trigger
            at configured times.
          </span>
        </div>
      )}

      {/* Main Schedule Card */}
      <div className="border-border bg-surface space-y-6 rounded-2xl border p-6 shadow-xs">
        {/* Enable Schedule Toggle */}
        <div className="border-border flex items-center justify-between border-b pb-6">
          <div>
            <span className="text-foreground block text-sm font-semibold">
              Automated Background Cadence
            </span>
            <span className="text-muted mt-0.5 block text-xs">
              Runs research and ideation overnight so fresh ideas are waiting in
              your queue each morning.
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
            Target Publishing Days
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

        {/* Time of day & volumes */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="text-foreground mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
              <Clock className="text-muted h-3.5 w-3.5" />
              Target Time (Local)
            </label>
            <input
              type="time"
              value={timeOfDay}
              onChange={e => setTimeOfDay(e.target.value)}
              className="border-border bg-surface-hover text-foreground w-full rounded-xl border p-2.5 text-xs outline-none"
            />
          </div>

          <div>
            <label className="text-foreground mb-1.5 block text-xs font-semibold">
              Posts Per Run
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={postsPerRun}
              onChange={e => setPostsPerRun(Number(e.target.value) || 1)}
              className="border-border bg-surface-hover text-foreground w-full rounded-xl border p-2.5 text-xs outline-none"
            />
          </div>

          <div>
            <label className="text-foreground mb-1.5 flex items-center gap-1 text-xs font-semibold">
              <span>Ideas Per Run</span>
              <span className="text-muted text-[10px] font-normal">
                (Choice)
              </span>
            </label>
            <input
              type="number"
              min={2}
              max={10}
              value={ideasPerRun}
              onChange={e => setIdeasPerRun(Number(e.target.value) || 3)}
              className="border-border bg-surface-hover text-foreground w-full rounded-xl border p-2.5 text-xs outline-none"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving}
          className="bg-accent hover:bg-accent-hover text-background inline-flex cursor-pointer items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold shadow-xs transition-colors"
        >
          {isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          <span>Save Schedule Settings</span>
        </button>
      </div>
    </form>
  )
}
