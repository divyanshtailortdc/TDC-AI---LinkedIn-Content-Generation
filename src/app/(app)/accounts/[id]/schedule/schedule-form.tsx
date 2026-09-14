'use client'

import { useState } from 'react'
import { Calendar, Clock, Sparkles, CheckCircle2, Save, Loader2 } from 'lucide-react'
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
  const [enabled, setEnabled] = useState<boolean>(initialSchedule?.enabled ?? false)
  const [frequency, setFrequency] = useState<string>(initialSchedule?.frequency || 'weekly')
  const [selectedDays, setSelectedDays] = useState<number[]>(
    (initialSchedule?.daysOfWeek as number[]) || [1, 3, 5]
  )
  const [timeOfDay, setTimeOfDay] = useState<string>(initialSchedule?.timeOfDay || '09:00')
  const [postsPerRun, setPostsPerRun] = useState<number>(initialSchedule?.postsPerRun || 1)
  const [ideasPerRun, setIdeasPerRun] = useState<number>(initialSchedule?.ideasPerRun || 3)
  const [isSaving, setIsSaving] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)

  const toggleDay = (dayId: number) => {
    if (selectedDays.includes(dayId)) {
      if (selectedDays.length > 1) {
        setSelectedDays(selectedDays.filter((d) => d !== dayId))
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
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Schedule saved successfully! Automated background runs will trigger at configured times.</span>
        </div>
      )}

      {/* Main Schedule Card */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-6 shadow-xs">
        {/* Enable Schedule Toggle */}
        <div className="flex items-center justify-between pb-6 border-b border-[var(--border)]">
          <div>
            <span className="font-semibold text-sm text-[var(--foreground)] block">
              Automated Background Cadence
            </span>
            <span className="text-xs text-[var(--muted)] mt-0.5 block">
              Runs research and ideation overnight so fresh ideas are waiting in your queue each morning.
            </span>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-[var(--surface-hover)] border border-[var(--border)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)]"></div>
          </label>
        </div>

        {/* Days of week selector */}
        <div>
          <label className="block text-xs font-semibold text-[var(--foreground)] mb-2">
            Target Publishing Days
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {DAYS.map((day) => {
              const isSelected = selectedDays.includes(day.id)
              return (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => toggleDay(day.id)}
                  className={`w-12 h-10 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
                    isSelected
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-xs'
                      : 'bg-[var(--surface-hover)] border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {day.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Time of day & volumes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--foreground)] mb-1.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[var(--muted)]" />
              Target Time (Local)
            </label>
            <input
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-2.5 text-xs text-[var(--foreground)] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--foreground)] mb-1.5">
              Posts Per Run
            </label>
            <input
              type="number"
              min={1}
              max={5}
              value={postsPerRun}
              onChange={(e) => setPostsPerRun(Number(e.target.value) || 1)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-2.5 text-xs text-[var(--foreground)] outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--foreground)] mb-1.5 flex items-center gap-1">
              <span>Ideas Per Run</span>
              <span className="text-[10px] text-[var(--muted)] font-normal">(Choice)</span>
            </label>
            <input
              type="number"
              min={2}
              max={10}
              value={ideasPerRun}
              onChange={(e) => setIdeasPerRun(Number(e.target.value) || 3)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-2.5 text-xs text-[var(--foreground)] outline-none"
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
        >
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span>Save Schedule Settings</span>
        </button>
      </div>
    </form>
  )
}
