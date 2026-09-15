'use client'

import { useState } from 'react'
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
  model: string | null
  error: string | null
  createdAt: Date | string
}

export function RunsClient({
  initialRuns,
  accounts,
  hideHeader
}: {
  initialRuns: RunSummary[]
  accounts: Array<{ id: string; name: string }>
  hideHeader?: boolean
}) {
  const router = useRouter()
  const [runs, setRuns] = useState<RunSummary[]>(initialRuns)
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    accounts[0]?.id || ''
  )
  const [isTriggering, setIsTriggering] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const handleGenerateNow = async () => {
    if (!selectedAccountId) return
    setIsTriggering(true)
    try {
      const res = await triggerNewRun(selectedAccountId)
      if (res.success && res.runId) {
        setShowModal(false)
        router.push(`/runs/${res.runId}`)
      }
    } finally {
      setIsTriggering(false)
    }
  }

  const content = (
    <div className="max-w-7xl mx-auto space-y-8">
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
                Select Identity
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full rounded-xl border border-border bg-surface-hover p-2.5 text-xs text-foreground outline-none"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-xs text-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateNow}
                disabled={isTriggering}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-background text-xs font-semibold shadow-xs"
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
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-background text-xs font-semibold shadow-xs hover:bg-accent-hover transition-colors"
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
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                        : run.status === 'awaiting_idea_approval'
                          ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600'
                          : run.status === 'failed'
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600'
                            : 'bg-blue-50 dark:bg-blue-950/40 text-blue-600'
                    }`}>
                      {run.status.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs capitalize text-muted font-mono bg-surface px-1.5 py-0.5 rounded">
                      {run.trigger}
                    </span>
                  </div>

                  <p className="text-xs text-muted font-mono">
                    ID: {run.id.slice(0, 8)}... • Model: {run.model || 'claude-opus-5'}
                  </p>

                  {run.error && (
                    <p className="text-xs text-rose-500 font-medium">{run.error}</p>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right text-xs">
                    <span className="font-mono text-foreground block">
                      ${Number(run.costUsd || 0).toFixed(3)}
                    </span>
                    <span className="text-[11px] text-muted">
                      Stage {run.currentStep}/{run.totalSteps}
                    </span>
                  </div>

                  <Link
                    href={`/runs/${run.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-surface text-xs font-medium text-foreground transition-colors"
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
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-background text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Generate Now</span>
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        {content}
      </div>
    </div>
  )
}
