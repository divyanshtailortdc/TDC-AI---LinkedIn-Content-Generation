'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  DollarSign,
  ArrowRight,
  RefreshCw,
  Plus
} from 'lucide-react'
import { triggerNewRun } from './actions'
import { PageHeader } from '@/components/page-header'
import type { RunSpendSummary } from '@/lib/run-spend'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import type { PageInfo } from '@/lib/pagination'
import { Pagination } from '@/components/pagination'

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
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * When a run started, formatted by hand: toLocaleString renders differently on
 * the server and in the browser. The time zone can still differ between the
 * two, so the element that shows it suppresses the hydration warning.
 */
function formatRunDate(value: Date | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`
}

export function RunsClient({
  initialRuns,
  pageInfo,
  activeAccount,
  hideHeader,
  spend
}: {
  /** One page of runs; pageInfo says which. */
  initialRuns: RunSummary[]
  pageInfo: PageInfo
  activeAccount: { id: string; name: string } | null
  hideHeader?: boolean
  /** Spend windows computed server-side; see getRunSpendSummary. */
  spend?: RunSpendSummary
}) {
  const router = useRouter()
  // Rendered straight from props so router.refresh() below shows fresh rows.
  const runs = initialRuns
  const [isTriggering, setIsTriggering] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)

  const openModal = () => {
    setTriggerError(null)
    setShowModal(true)
  }

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

  const handleGenerateNow = async () => {
    if (!activeAccount) return
    setIsTriggering(true)
    setTriggerError(null)
    try {
      const res = await triggerNewRun(activeAccount.id)
      if (res.success && res.runId) {
        setShowModal(false)
        router.push(`/runs/${res.runId}`)
      } else {
        setTriggerError(res.error || 'Failed to trigger run')
      }
    } catch (err) {
      // The action catches its own errors, so this is the request itself failing.
      setTriggerError(err instanceof Error ? err.message : 'Failed to trigger run')
    } finally {
      setIsTriggering(false)
    }
  }

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
      {/* Generate Now Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-xl space-y-4">
            <h3 className="text-sm font-semibold text-foreground">
              Trigger New Content Run
            </h3>
            <p className="text-xs text-muted">
              This initiates Stage 1 (Context synthesis &amp; research), generates fresh candidate ideas, and parks at the Idea Gate for your approval.
            </p>

            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Identity
              </label>
              <div className="w-full rounded-xl border border-border bg-surface-hover p-2.5 text-xs text-foreground">
                {activeAccount?.name || 'No active identity selected'}
              </div>
            </div>

            {triggerError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{triggerError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="h-8 rounded-lg px-3.5 text-[13px] font-medium text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateNow}
                disabled={isTriggering || !activeAccount}
                className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-accent hover:bg-accent-hover text-background text-[13px] font-semibold shadow-xs transition-colors disabled:opacity-60"
              >
                {isTriggering && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Launch Run</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Header (Only when PageHeader is hidden) */}
      {hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Pipeline Runs</h2>
          <button
            type="button"
            onClick={openModal}
            className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-accent text-background text-[13px] font-semibold shadow-xs hover:bg-accent-hover transition-colors"
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
            Click &quot;Generate Now&quot; above to fire your first background research and ideation run.
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
                    <time
                      dateTime={new Date(run.createdAt).toISOString()}
                      suppressHydrationWarning
                    >
                      {formatRunDate(run.createdAt)}
                    </time>
                    <span className="font-mono"> · ID: {run.id.slice(0, 8)}...</span>
                  </p>

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
        title="Run Engine & Observability"
        description="Track background pipeline execution, stages, token counts, and costs."
        actions={
          <button
            type="button"
            onClick={openModal}
            className="inline-flex h-8 items-center gap-1.5 px-3.5 rounded-lg bg-accent hover:bg-accent-hover text-background text-[13px] font-semibold shadow-xs transition-colors cursor-pointer"
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
