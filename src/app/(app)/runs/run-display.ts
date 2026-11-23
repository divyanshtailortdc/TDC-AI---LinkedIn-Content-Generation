import type { Tone } from '@/components/ui/tone'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'

/**
 * How runs read on the Run Details list and a run's page: the words and tone
 * for each status, the list's status filter, and the number formats. Pure,
 * so the server (the filter's where clause) and the browser share it.
 */

export type RunStatusDisplay = {
  label: string
  tone: Tone
  /** Moving right now: the chip shows a spinner. */
  spinning: boolean
}

const STATUS_DISPLAY: Record<string, RunStatusDisplay> = {
  queued: { label: 'Queued', tone: 'brand', spinning: true },
  running: { label: 'Running', tone: 'brand', spinning: true },
  researching: { label: 'Researching', tone: 'brand', spinning: true },
  ideating: { label: 'Generating ideas', tone: 'brand', spinning: true },
  drafting: { label: 'Drafting posts', tone: 'brand', spinning: true },
  awaiting_idea_approval: { label: 'Ideas to review', tone: 'warning', spinning: false },
  completed: { label: 'Completed', tone: 'success', spinning: false },
  failed: { label: 'Failed', tone: 'danger', spinning: false },
  stopped: { label: 'Stopped', tone: 'neutral', spinning: false }
}

export function runStatusDisplay(status: string): RunStatusDisplay {
  return (
    STATUS_DISPLAY[status] ?? {
      label: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
      tone: 'neutral',
      spinning: false
    }
  )
}

/** How a run was started, as the list and the run's page say it. */
export function triggerLabel(trigger: string | null | undefined): string {
  if (trigger === 'manual') return 'Manual'
  if (trigger === 'schedule' || trigger === 'scheduled') return 'Scheduled'
  if (!trigger) return 'Manual'
  return trigger.charAt(0).toUpperCase() + trigger.slice(1)
}

/**
 * The ideation stage a moving run is in, 1 to 3. The run's own step counter
 * moves when it is claimed and again when its ideas are saved, so it reads
 * 1 of 3 all through research and ideation; the status says more.
 */
const IDEATION_STAGE: Record<string, { stage: number; label: string }> = {
  queued: { stage: 0, label: 'Waiting to start' },
  running: { stage: 1, label: 'Gathering context' },
  researching: { stage: 2, label: 'Researching' },
  ideating: { stage: 3, label: 'Generating ideas' }
}
export const IDEATION_STAGES = 3

export function ideationStageOf(status: string) {
  return IDEATION_STAGE[status] ?? null
}

// ------------------------------------------------------------- list filter

export const RUN_FILTERS = ['all', 'active', 'review', 'completed', 'failed'] as const
export type RunFilter = (typeof RUN_FILTERS)[number]

/** The statuses each filter shows; "all" shows every run. */
export const RUN_FILTER_STATUSES: Record<Exclude<RunFilter, 'all'>, string[]> = {
  active: [...ACTIVE_RUN_STATUSES, 'drafting'],
  review: ['awaiting_idea_approval'],
  completed: ['completed'],
  failed: ['failed', 'stopped']
}

export const RUN_FILTER_LABELS: Record<RunFilter, string> = {
  all: 'All',
  active: 'In progress',
  review: 'Ideas to review',
  completed: 'Completed',
  failed: 'Failed & stopped'
}

export const RUN_FILTER_TONES: Partial<Record<RunFilter, Tone>> = {
  active: 'brand',
  review: 'warning',
  completed: 'success',
  failed: 'danger'
}

/** The filter asked for by a ?status= param; anything else is "all". */
export function parseRunFilter(value: string | string[] | undefined): RunFilter {
  const raw = Array.isArray(value) ? value[0] : value
  return RUN_FILTERS.find(filter => filter === raw) ?? 'all'
}

/** Runs per filter, from per-status counts. A status no filter names counts toward "all" only. */
export function runFilterCounts(
  rows: { status: string; n: number }[]
): Record<RunFilter, number> {
  const counts: Record<RunFilter, number> = {
    all: 0,
    active: 0,
    review: 0,
    completed: 0,
    failed: 0
  }
  for (const { status, n } of rows) {
    counts.all += n
    for (const filter of RUN_FILTERS) {
      if (filter !== 'all' && RUN_FILTER_STATUSES[filter].includes(status)) {
        counts[filter] += n
      }
    }
  }
  return counts
}

// ----------------------------------------------------------------- numbers

/** A spend total: cents, or four places below a cent. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

/** One run's cost, to the tenth of a cent: runs often cost a few cents. */
export function formatRunCost(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(3)}`
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  // Rounded first, so 119.6s reads "2m 0s" rather than "1m 60s".
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}m ${whole % 60}s`
}

/** "1 idea", "3 ideas". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
