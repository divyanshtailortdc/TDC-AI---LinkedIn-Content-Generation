'use client'

import { useEffect, useOptimistic, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Calculator,
  CalendarDays,
  ChevronRight,
  History,
  Play,
  SearchX,
  TrendingUp
} from 'lucide-react'
import {
  GenerateRunDialog,
  type RunPickerData
} from '@/components/generate-run-dialog'
import { Button } from '@/components/button'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { FilterChips } from '@/components/ui/filter-chips'
import { ProgressBar } from '@/components/ui/meter'
import { StatTile } from '@/components/ui/stat-tile'
import { StatusChip } from '@/components/ui/status-chip'
import { TimeAgo } from '@/components/ui/time-ago'
import { FOCUS_RING, TONES } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import type { PageInfo } from '@/lib/pagination'
import { isPlatformId, PLATFORMS } from '@/lib/platforms'
import type { RunSpendSummary } from '@/lib/run-spend'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import { pollRuns } from './actions'
import {
  formatRunCost,
  formatTokens,
  formatUsd,
  ideationStageOf,
  IDEATION_STAGES,
  plural,
  RUN_FILTER_LABELS,
  RUN_FILTER_TONES,
  RUN_FILTERS,
  runStatusDisplay,
  triggerLabel,
  type RunFilter
} from './run-display'
import type { RunIdeaCounts } from './runs-data'

interface RunSummary {
  id: string
  accountId: string
  accountName: string
  workflow: string
  trigger: string
  /** The one platform the run wrote for; null for every platform. */
  channel?: string | null
  status: string
  currentStep: number
  totalSteps: number
  costUsd: string | null
  tokenCounts?: {
    outputTokens?: number
    reasoningTokens?: number
    totalTokens?: number
    cacheReadTokens?: number
    inputTokens?: number
  } | null
  error: string | null
  createdAt: Date | string
  /** The goals the run was started for. */
  goalTitles?: string[] | null
  /** The run's ideas by status; absent while it has none. */
  ideaCounts?: RunIdeaCounts | null
}

/** What a filter that shows nothing says. */
const FILTERED_EMPTY: Record<Exclude<RunFilter, 'all'>, string> = {
  active: 'No runs in progress',
  review: 'No ideas to review',
  completed: 'No completed runs',
  failed: 'No failed runs'
}

/**
 * The runs whose row changes on its own, so the list polls them: the
 * pipeline's moving statuses, and drafting, while posts are being written.
 * ACTIVE_RUN_STATUSES leaves drafting out on purpose (the pipeline itself is
 * done), so the list keeps its own set.
 */
const MOVING_STATUSES = [...ACTIVE_RUN_STATUSES, 'drafting']

export function RunsClient({
  initialRuns,
  pageInfo,
  filter,
  counts,
  latestRunId,
  picker,
  hideHeader,
  spend
}: {
  /** One page of runs; pageInfo says which. */
  initialRuns: RunSummary[]
  pageInfo: PageInfo
  /** Which runs the list shows (?status=). */
  filter: RunFilter
  /** How many runs each filter shows. */
  counts: Record<RunFilter, number>
  /** The newest run of any status, to notice one started elsewhere. */
  latestRunId: string | null
  /** The goals a new run can serve, and how many ideas it makes. */
  picker: RunPickerData
  hideHeader?: boolean
  /** Spend windows computed server-side; see getRunSpendSummary. */
  spend?: RunSpendSummary
}) {
  const router = useRouter()
  const pathname = usePathname()
  // Rendered from props, so router.refresh() below shows fresh rows, with the
  // polled progress of moving runs laid over them. The overlay belongs to the
  // props it was polled for and is dropped when fresh ones arrive.
  const [progress, setProgress] = useState<{
    for: RunSummary[]
    byId: Record<string, Partial<RunSummary>>
  }>({ for: initialRuns, byId: {} })
  const runs =
    progress.for === initialRuns
      ? initialRuns.map(run => ({ ...run, ...progress.byId[run.id] }))
      : initialRuns
  const [showModal, setShowModal] = useState(false)
  const openModal = () => setShowModal(true)

  // The filter is a URL param, so the server counts and pages it. The chip
  // moves at once; the list dims until the new page arrives.
  const [isFiltering, startFiltering] = useTransition()
  const [shownFilter, setShownFilter] = useOptimistic(filter)
  const changeFilter = (next: RunFilter) => {
    if (next === shownFilter) return
    startFiltering(() => {
      setShownFilter(next)
      router.push(next === 'all' ? pathname : `${pathname}?status=${next}`, {
        scroll: false
      })
    })
  }

  // Poll a small action rather than re-rendering the page: progress of the
  // moving runs every 3s, otherwise only whether a new run has appeared.
  // The page itself is refreshed once, when a run finishes (spend changes
  // too) or a new one starts.
  const activeRunIds = runs
    .filter(run => MOVING_STATUSES.includes(run.status))
    .map(run => run.id)
    .join(',')
  const onFirstPage = pageInfo.page === 1
  useEffect(() => {
    const ids = activeRunIds ? activeRunIds.split(',') : []
    const interval = setInterval(
      async () => {
        if (document.visibilityState !== 'visible') return
        const res = await pollRuns(ids)
        if (!res.success) return
        const finished = res.runs.some(
          run => !MOVING_STATUSES.includes(run.status)
        )
        // Compared with the newest run of any status, not the first row:
        // under a filter the first row is rarely the newest run.
        if (finished || (onFirstPage && res.latestRunId !== latestRunId)) {
          router.refresh()
          return
        }
        setProgress({
          for: initialRuns,
          byId: Object.fromEntries(res.runs.map(run => [run.id, run]))
        })
      },
      ids.length > 0 ? 3000 : 30000
    )
    return () => clearInterval(interval)
  }, [activeRunIds, latestRunId, onFirstPage, initialRuns, router])

  const hasRuns = counts.all > 0
  const generateButton = (
    <Button className={FOCUS_RING} size="sm" onClick={openModal}>
      <Play aria-hidden className="h-3.5 w-3.5 fill-current" />
      Generate Now
    </Button>
  )

  const content = (
    <div className="space-y-6">
      {/* Inline header (only when PageHeader is hidden) */}
      {hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-foreground text-sm font-semibold">Pipeline Runs</h2>
          {generateButton}
        </div>
      )}

      {/* Spend over time is what shows whether a cost change actually worked. */}
      {spend && hasRuns && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Last 7 days"
            icon={CalendarDays}
            value={formatUsd(spend.week.costUsd)}
            hint={plural(spend.week.runs, 'run')}
          />
          <StatTile
            label="Last 30 days"
            icon={History}
            value={formatUsd(spend.month.costUsd)}
            hint={plural(spend.month.runs, 'run')}
          />
          <StatTile
            label="Average per run"
            icon={Calculator}
            value={formatUsd(spend.averageRunCostUsd)}
            hint={plural(spend.pricedRuns, 'priced run')}
          />
          <StatTile
            label="Projected monthly"
            icon={TrendingUp}
            // Last week's pace, so it reacts to a cost change within days.
            value={formatUsd((spend.week.costUsd / 7) * 30)}
            hint="At 7-day pace"
          />
        </div>
      )}

      <GenerateRunDialog
        open={showModal}
        onClose={() => setShowModal(false)}
        picker={picker}
      />

      {!hasRuns ? (
        // Generate Now sits in the header, so the empty list only points to it.
        <EmptyState icon={Play} tone="brand" title="No runs yet" description="Start one with Generate Now." />
      ) : (
        <div className="space-y-3">
          <FilterChips
            label="Show runs by status"
            value={shownFilter}
            onChange={changeFilter}
            className="w-fit max-w-full"
            options={RUN_FILTERS.map(value => ({
              value,
              label: RUN_FILTER_LABELS[value],
              count: counts[value],
              tone: RUN_FILTER_TONES[value]
            }))}
          />

          <div
            aria-busy={isFiltering || undefined}
            className={cn(
              'border-border bg-surface overflow-hidden rounded-2xl border shadow-xs transition-opacity',
              isFiltering && 'opacity-60'
            )}
          >
            {runs.length === 0 ? (
              <EmptyState
                compact
                bordered={false}
                icon={SearchX}
                title={filter === 'all' ? 'No runs here' : FILTERED_EMPTY[filter]}
                action={
                  filter === 'all' ? undefined : (
                    <Button
                      className={FOCUS_RING}
                      size="sm"
                      variant="secondary"
                      onClick={() => changeFilter('all')}
                    >
                      Show all runs
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="divide-border divide-y">
                {runs.map(run => (
                  <RunRow key={run.id} run={run} />
                ))}
              </ul>
            )}
          </div>

          <Pagination
            {...pageInfo}
            noun="runs"
            query={filter === 'all' ? {} : { status: filter }}
          />
        </div>
      )}
    </div>
  )

  if (hideHeader) {
    return content
  }

  return (
    // Fills the app's main area, top to bottom and edge to edge, as a run does.
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Run Details"
        description="Research, ideas and cost of every run"
        actions={generateButton}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{content}</div>
    </div>
  )
}

/**
 * What became of a run, in a few words for its row: the ideas still waiting
 * on the reader first, else how far they got. A failed run shows its error.
 */
function outcomeOf(run: RunSummary): { text: string; className?: string } | null {
  if (run.status === 'failed' && run.error) {
    return { text: run.error, className: TONES.danger.text }
  }
  const ideas = run.ideaCounts
  if (!ideas || ideas.total === 0) return null
  if (ideas.proposed > 0) {
    return { text: `${ideas.proposed} to review`, className: cn('font-medium', TONES.warning.text) }
  }
  if (ideas.approved > 0) return { text: `${ideas.approved} approved` }
  if (ideas.drafted > 0) return { text: plural(ideas.drafted, 'post') }
  return { text: plural(ideas.total, 'idea') }
}

/**
 * One run as a row; the whole row opens the run. It shows what the run was
 * for, what came of it and when; how it was started and what it cost are in
 * its hover text and on the run's page.
 */
function RunRow({ run }: { run: RunSummary }) {
  const mounted = useHasMounted()
  const status = runStatusDisplay(run.status)
  const stage = ACTIVE_RUN_STATUSES.includes(run.status)
    ? ideationStageOf(run.status)
    : null
  const goals = run.goalTitles ?? []
  const platform = isPlatformId(run.channel) ? PLATFORMS[run.channel].name : null
  const tokens = run.tokenCounts?.totalTokens || 0
  const outcome = outcomeOf(run)
  const hover = [
    goals.length > 2 ? goals.join(', ') : null,
    triggerLabel(run.trigger),
    platform,
    `as ${run.accountName}`,
    formatRunCost(Number(run.costUsd || 0)),
    tokens > 0 ? `${formatTokens(tokens)} tokens` : null,
    run.error
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li>
      <Link
        href={`/runs/${run.id}`}
        title={hover}
        className={cn(
          'group hover:bg-surface-hover/60 flex items-center gap-3 px-4 py-3.5 transition-colors focus-visible:ring-inset sm:gap-4 sm:px-5',
          FOCUS_RING
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate text-sm font-medium">
            {goals.length > 0 ? goals.slice(0, 2).join(', ') : run.accountName}
            {goals.length > 2 && (
              <span className="text-muted font-normal"> +{goals.length - 2}</span>
            )}
          </p>
          <p className="text-muted mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
            {outcome && <span className={cn('truncate', outcome.className)}>{outcome.text}</span>}
            {outcome && mounted && <span aria-hidden>·</span>}
            <TimeAgo value={run.createdAt} className="shrink-0" />
          </p>
          {stage && (
            <ProgressBar
              size="xs"
              className="mt-2 max-w-xs"
              value={Math.max(0, stage.stage - 1)}
              max={IDEATION_STAGES}
              label={`${stage.label}, ${Math.max(0, stage.stage - 1)} of ${IDEATION_STAGES} stages done`}
            />
          )}
        </div>
        <StatusChip tone={status.tone} spinning={status.spinning}>
          {status.label}
        </StatusChip>
        <ChevronRight
          aria-hidden
          className="text-muted h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
        />
      </Link>
    </li>
  )
}
