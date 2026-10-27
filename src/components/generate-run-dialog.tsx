'use client'

import { triggerNewRun } from '@/app/(app)/runs/actions'
import { markDataChanged } from '@/components/refresh-on-back'
import { ideaTarget } from '@/lib/ai/idea-selection'
import { cn } from '@/lib/cn'
import {
  AlertCircle,
  ArrowRight,
  Loader2,
  Sparkles,
  Target
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'

/** A goal as the run picker lists it. */
export type RunGoalOption = {
  id: string
  title: string
  objective: string
  keyMessage: string | null
  isActive: boolean
}

/** What every run picker needs: the identity's goals and how many ideas a run makes. */
export type RunPickerData = {
  goals: RunGoalOption[]
  ideasPerRun: number
}

/**
 * Starts a run for the goals the user ticks. Only active goals are offered (a
 * paused goal never steers a run), and nothing starts until at least one is
 * ticked. The run sees these goals and no others: research, knowledge and
 * every idea are about them.
 */
export function GenerateRunDialog({
  open,
  onClose,
  picker,
  initialSelected,
  lockSelection = false
}: {
  open: boolean
  onClose: () => void
  picker: RunPickerData
  /** Ticked when the dialog opens; every active goal when left out. */
  initialSelected?: string[]
  /** When true, only shows the selected goals without checkboxes to pick/unpick other goals. */
  lockSelection?: boolean
}) {
  if (!open) return null
  // Mounted fresh each time it opens, so the ticks start from initialSelected.
  return (
    <PickerDialog
      onClose={onClose}
      picker={picker}
      initialSelected={initialSelected}
      lockSelection={lockSelection}
    />
  )
}

/** What the run will make for this many goals, as the run works it out. */
function describeRunSize(ideasPerRun: number, goalCount: number): string {
  const ideas = ideaTarget(ideasPerRun, goalCount)
  if (goalCount <= 1) return `${ideas} ideas for this goal.`
  return [
    `${ideas} ideas across ${goalCount} goals, each leading at least one`,
    ideas > ideasPerRun ? ` (more than your usual ${ideasPerRun}, one per goal).` : '.',
    ' An idea that also moves another goal is marked with it.'
  ].join('')
}

function PickerDialog({
  onClose,
  picker,
  initialSelected,
  lockSelection = false
}: {
  onClose: () => void
  picker: RunPickerData
  initialSelected?: string[]
  lockSelection?: boolean
}) {
  const router = useRouter()
  const titleId = useId()
  const active = picker.goals.filter(g => g.isActive)
  const pausedCount = picker.goals.length - active.length
  const [selected, setSelected] = useState<string[]>(() =>
    (initialSelected ?? active.map(g => g.id)).filter(id =>
      active.some(g => g.id === id)
    )
  )
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedGoals = active.filter(g => selected.includes(g.id))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isStarting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isStarting, onClose])

  const toggle = (id: string) =>
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )

  const start = async () => {
    if (selected.length === 0) return
    setIsStarting(true)
    setError(null)
    try {
      // In the order the goals are listed, so G1 is the first one shown.
      const goalIds = active.map(g => g.id).filter(id => selected.includes(id))
      const res = await triggerNewRun(goalIds)
      if (res.success && res.runId) {
        // The action no longer revalidates; Back still shows the new run.
        markDataChanged()
        router.push(`/runs/${res.runId}`)
        return
      }
      setError(res.error || 'The run could not be started.')
    } catch (err) {
      // The action catches its own errors, so this is the request itself failing.
      setError(
        err instanceof Error ? err.message : 'The run could not be started.'
      )
    }
    setIsStarting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-border bg-surface flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col rounded-2xl border shadow-xl"
      >
        <div className="border-border border-b px-6 pt-5 pb-4">
          <h3
            id={titleId}
            className="text-foreground flex items-center gap-2 text-sm font-semibold"
          >
            <Sparkles className="text-brand h-4 w-4" />
            Generate ideas
          </h3>
          <p className="text-muted mt-1 text-xs leading-relaxed">
            {lockSelection
              ? `This run will generate ideas for the ${selected.length} selected goal${selected.length === 1 ? '' : 's'}. Ideas wait for your approval before any post is written.`
              : 'Pick the goals this run works toward. Research, your knowledge base and every idea are about these goals only. Ideas wait for your approval before any post is written.'}
          </p>
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {active.length === 0 ? (
            <div className="border-border rounded-xl border border-dashed p-6 text-center">
              <Target className="text-muted mx-auto mb-2 h-6 w-6" />
              <p className="text-foreground text-sm font-medium">
                {picker.goals.length === 0
                  ? 'No goals yet'
                  : 'Every goal is paused'}
              </p>
              <p className="text-muted mx-auto mt-1 max-w-xs text-xs">
                {picker.goals.length === 0
                  ? 'A run writes toward goals you set. Add one first.'
                  : 'Resume a goal to use it in a run.'}
              </p>
              <Link
                href="/goals"
                className="bg-accent text-background hover:bg-accent-hover mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-medium transition-colors"
              >
                Go to Goals
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : lockSelection ? (
            <div className="space-y-3">
              <div className="text-foreground mb-2 flex items-center justify-between text-xs font-semibold">
                <span>Selected Goals ({selectedGoals.length})</span>
              </div>
              <ul className="space-y-2">
                {selectedGoals.map(goal => (
                  <li
                    key={goal.id}
                    className="border-brand/40 bg-brand/5 flex items-start gap-3 rounded-xl border p-3"
                  >
                    <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent">
                      <Target className="h-2.5 w-2.5" />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground text-sm font-medium">
                          {goal.title}
                        </span>
                        <span className="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase">
                          {goal.objective.replace(/_/g, ' ')}
                        </span>
                      </span>
                      {goal.keyMessage && (
                        <span className="text-muted mt-1 line-clamp-2 block text-xs leading-relaxed">
                          {goal.keyMessage}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <fieldset>
              <legend className="text-foreground mb-2 flex w-full items-center justify-between text-xs font-semibold">
                <span>Goals</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      selected.length === active.length
                        ? []
                        : active.map(g => g.id)
                    )
                  }
                  className="text-muted hover:text-foreground text-xs font-medium"
                >
                  {selected.length === active.length
                    ? 'Clear all'
                    : 'Select all'}
                </button>
              </legend>
              <ul className="space-y-2">
                {active.map(goal => {
                  const checked = selected.includes(goal.id)
                  return (
                    <li key={goal.id}>
                      <label
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                          checked
                            ? 'border-brand/50 bg-brand/5'
                            : 'border-border hover:bg-surface-hover'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(goal.id)}
                          className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-foreground text-sm font-medium">
                              {goal.title}
                            </span>
                            <span className="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase">
                              {goal.objective.replace(/_/g, ' ')}
                            </span>
                          </span>
                          {goal.keyMessage && (
                            <span className="text-muted mt-1 line-clamp-2 block text-xs leading-relaxed">
                              {goal.keyMessage}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {pausedCount > 0 && (
                <p className="text-muted mt-3 text-[11px]">
                  {pausedCount} paused goal{pausedCount === 1 ? ' is' : 's are'}{' '}
                  not listed.{' '}
                  <Link href="/goals" className="text-accent hover:underline">
                    Manage goals
                  </Link>
                </p>
              )}
            </fieldset>
          )}
        </div>

        <div className="border-border space-y-3 border-t px-6 py-4">
          {active.length > 0 && (
            <p className="text-muted text-[11px] leading-relaxed">
              {describeRunSize(picker.ideasPerRun, selected.length)}
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isStarting}
              className="text-muted hover:text-foreground h-8 rounded-lg px-3.5 text-[13px] font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            {active.length > 0 && (
              <button
                type="button"
                onClick={start}
                disabled={isStarting || selected.length === 0}
                className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStarting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {selected.length === 0
                  ? 'Pick a goal'
                  : `Generate for ${selected.length} goal${selected.length === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
