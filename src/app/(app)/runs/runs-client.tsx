'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Play, ArrowRight } from 'lucide-react'
import {
  GenerateRunDialog,
  type RunPickerData
} from '@/components/generate-run-dialog'
import { PageHeader } from '@/components/page-header'
import type { RunSpendSummary } from '@/lib/run-spend'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import type { PageInfo } from '@/lib/pagination'
import { Pagination } from '@/components/pagination'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { formatAbsoluteDateTime } from '@/lib/format-date'

interface RunSummary {
  id: string
  accountId: string
  accountName: string
  workflow: string
  trigger: string
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
}

export function RunsClient({
  initialRuns,
  pageInfo,
  picker,
  hideHeader,
  spend
}: {
  /** One page of runs; pageInfo says which. */
  initialRuns: RunSummary[]
  pageInfo: PageInfo
  /** The goals a new run can serve, and how many ideas it makes. */
  picker: RunPickerData
  hideHeader?: boolean
  /** Spend windows computed server-side; see getRunSpendSummary. */
  spend?: RunSpendSummary
}) {
  const router = useRouter()
  const hasMounted = useHasMounted()
  // Rendered straight from props so router.refresh() below shows fresh rows.
  const runs = initialRuns
  const [showModal, setShowModal] = useState(false)
  const openModal = () => setShowModal(true)

  // Re-fetch the server data (runs + spend) so progress and newly scheduled
  // runs show up without a reload: fast while a run is moving, slow otherwise.
  const hasActiveRun = runs.some(run => ACTIVE_RUN_STATUSES.includes(run.status))
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (document.visibilityState === 'visible') router.refresh()
      },
      hasActiveRun ? 3000 : 30000
    )
    return () => clearInterval(interval)
  }, [hasActiveRun, router])

  // Spend over time is what shows whether a cost change actually worked.
  const formatUsd = (value: number) =>
    value === 0 ? '$0.00' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`
  const formatTokens = (value: number) =>
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(2)}M`
      : value >= 1_000
        ? `${(value / 1_000).toFixed(1)}K`
        : String(value)

  const content = (
    <div className="space-y-8">
      {spend && runs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: 'Last 7 days',
              value: formatUsd(spend.week.costUsd),
              hint: `${spend.week.runs} run${spend.week.runs === 1 ? '' : 's'} · ${formatTokens(spend.week.outputTokens)} output tokens`
            },
            {
              label: 'Last 30 days',
              value: formatUsd(spend.month.costUsd),
              hint: `${spend.month.runs} run${spend.month.runs === 1 ? '' : 's'} · ${formatTokens(spend.month.outputTokens)} output tokens`
            },
            {
              label: 'Average per run',
              value: formatUsd(spend.averageRunCostUsd),
              hint: `across ${spend.pricedRuns} priced run${spend.pricedRuns === 1 ? '' : 's'}`
            },
            {
              label: 'Projected monthly',
              // Last week's pace, so it reacts to a cost change within days.
              value: formatUsd((spend.week.costUsd / 7) * 30),
              hint: 'at the last 7 days\' pace'
            }
          ].map(stat => (
            <div
              key={stat.label}
              className="rounded-xl border border-border bg-surface p-4 shadow-xs"
            >
              <p className="text-[10px] font-semibold tracking-wider text-muted uppercase">
                {stat.label}
              </p>
              <p className="mt-1 text-xl font-bold text-foreground tabular-nums">
                {stat.value}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">{stat.hint}</p>
            </div>
          ))}
        </div>
      )}
      <GenerateRunDialog
        open={showModal}
        onClose={() => setShowModal(false)}
        picker={picker}
      />

      {/* Inline Header (Only when PageHeader is hidden) */}
      {hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Pipeline Runs</h2>
          <button
            type="button"
            onClick={openModal}
            className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-accent text-background text-[13px] font-semibold shadow-xs hover:bg-accent-hover transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Generate Now</span>
          </button>
        </div>
      )}

      {/* Runs Table */}
      {runs.length === 0 ? (
        <div className="p-16 text-center rounded-2xl border-2 border-dashed border-border bg-surface">
          <Play className="w-8 h-8 text-muted mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No runs executed yet</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Click &quot;Generate Now&quot; above and pick the goals to write toward.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden shadow-xs">
          <div className="divide-y divide-border">
            {runs.map((run) => (
              <div
                key={run.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-surface-hover transition-colors"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-foreground">
                      {run.accountName}
                    </span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                      run.status === 'completed'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                        : run.status === 'awaiting_idea_approval'
                          ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                          : run.status === 'failed'
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                            : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                    }`}>
                      {run.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs capitalize text-muted font-mono bg-surface px-1.5 py-0.5 rounded">
                      {run.trigger}
                    </span>
                  </div>

                  <p className="text-xs text-muted">
                    <time dateTime={new Date(run.createdAt).toISOString()}>
                      {hasMounted ? formatAbsoluteDateTime(run.createdAt) : ''}
                    </time>
                    {' · ID: '}
                    <span title={run.id} className="font-mono cursor-help">
                      {run.id.slice(0, 8)}
                    </span>
                  </p>

                  {run.goalTitles && run.goalTitles.length > 0 && (
                    <p
                      className="text-xs text-muted truncate"
                      title={run.goalTitles.join(', ')}
                    >
                      {run.goalTitles.length === 1 ? 'Goal' : 'Goals'}:{' '}
                      <span className="text-foreground">{run.goalTitles.join(', ')}</span>
                    </p>
                  )}

                  {run.error && (
                    <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{run.error}</p>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right text-xs">
                    <span className="font-mono text-foreground block">
                      ${Number(run.costUsd || 0).toFixed(3)}
                    </span>
                    {(run.tokenCounts?.totalTokens || 0) > 0 && (
                      <span className="block text-[11px] text-muted tabular-nums">
                        {formatTokens(run.tokenCounts?.totalTokens || 0)} tokens
                      </span>
                    )}
                    <span className="text-[11px] text-muted">
                      Stage {run.currentStep}/{run.totalSteps}
                    </span>
                  </div>

                  <Link
                    href={`/runs/${run.id}`}
                    className="inline-flex h-7 items-center gap-1.5 px-2.5 rounded-lg border border-border hover:bg-surface text-xs font-medium text-foreground transition-colors"
                  >
                    <span>View Run</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Pagination {...pageInfo} noun="runs" />
    </div>
  )

  if (hideHeader) {
    return content
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Run History"
        description="Explore execution stages, run outcomes, token usage, and associated costs"
        actions={
          <button
            type="button"
            onClick={openModal}
            className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-accent hover:bg-accent-hover text-background text-[13px] font-semibold shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Generate Now</span>
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-surface-hover/30">
        {content}
      </div>
    </div>
  )
}
