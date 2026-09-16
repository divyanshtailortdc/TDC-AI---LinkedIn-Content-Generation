'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  ExternalLink,
  ArrowRight,
  Search,
  BookOpen,
  FileText
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { RunCostPanel } from '@/components/run-cost-panel'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { fetchRunStatus } from '../actions'
import { approveIdea, rejectIdea, editIdea, draftApprovedIdeas } from '../../ideas/actions'
import { AiDraftingStatus, DraftingStatus } from '~/components/ai-drafting-status'
import { RunIdeaCard } from '~/components/run-idea-card'

interface RunDetailProps {
  initialRun: any
  initialSteps: any[]
  initialFindings: any[]
  initialIdeas: any[]
  account: any
}

export function RunDetailClient({
  initialRun,
  initialSteps,
  initialFindings,
  initialIdeas,
  account
}: RunDetailProps) {
  const router = useRouter()
  const [run, setRun] = useState(initialRun)
  const [steps, setSteps] = useState(initialSteps)
  const [findings, setFindings] = useState(initialFindings)
  const [ideas, setIdeas] = useState(initialIdeas)
  const [isDrafting, setIsDrafting] = useState(false)
  const [draftStatus, setDraftStatus] = useState<DraftingStatus>('idle')
  const [draftError, setDraftError] = useState<string | null>(null)

  const isRunning =
    run.status === 'queued' ||
    run.status === 'running' ||
    run.status === 'researching' ||
    run.status === 'ideating'

  // Polling while run is active
  useEffect(() => {
    if (!isRunning) return

    const interval = setInterval(async () => {
      const res = await fetchRunStatus(run.id)
      if (res.success && res.run) {
        setRun(res.run)
        if (res.steps) setSteps(res.steps)
        if (res.findings) setFindings(res.findings)
        if (res.ideas) setIdeas(res.ideas)

        if (res.run.status !== 'queued' && res.run.status !== 'running' && res.run.status !== 'researching' && res.run.status !== 'ideating') {
          clearInterval(interval)
          router.refresh()
        }
      }
    }, 2500)

    return () => clearInterval(interval)
  }, [isRunning, run.id, router])

  const [ideaActionBusyId, setIdeaActionBusyId] = useState<string | null>(null)

  const handleApproveIdea = async (ideaId: string) => {
    setIdeaActionBusyId(ideaId)
    try {
      const res = await approveIdea(ideaId)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, status: 'approved' } : i)))
      } else {
        showToast({ title: 'Approve failed', message: res.error, type: 'error' })
      }
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  const handleRejectIdea = async (ideaId: string) => {
    setIdeaActionBusyId(ideaId)
    try {
      const res = await rejectIdea(ideaId)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, status: 'rejected' } : i)))
      } else {
        showToast({ title: 'Reject failed', message: res.error, type: 'error' })
      }
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  const handleEditIdeaSave = async (
    ideaId: string,
    payload: { hookConcept: string; angle: string }
  ) => {
    setIdeaActionBusyId(ideaId)
    try {
      const res = await editIdea(ideaId, {
        angle: payload.angle,
        hookConcept: payload.hookConcept
      })
      if (res.success) {
        setIdeas((prev) =>
          prev.map((i) =>
            i.id === ideaId
              ? { ...i, angle: payload.angle, hookConcept: payload.hookConcept }
              : i
          )
        )
        showToast({ title: 'Saved', message: 'Idea edits saved successfully', type: 'success' })
      } else {
        showToast({ title: 'Save failed', message: res.error, type: 'error' })
      }
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  const handleDraftApproved = async () => {
    const approvedIds = ideas.filter((i) => i.status === 'approved').map((i) => i.id)

    // Optimistically flip the drafted ideas to their terminal state right away so
    // the list reflects the action immediately, instead of sitting unchanged for
    // the full duration of the (multi-LLM-call) server action below.
    setIsDrafting(true)
    setDraftStatus('processing')
    setDraftError(null)
    setIdeas((prev) =>
      prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'drafted' } : i))
    )

    try {
      const res = await draftApprovedIdeas({ runId: run.id })
      if (res.success) {
        setDraftStatus('success')
        showToast({
          title: 'Posts generated',
          message: `${res.draftedCount} post${res.draftedCount === 1 ? '' : 's'} drafted and ready for review.`,
          type: 'success'
        })
        router.push(`/posts?runId=${run.id}`)
      } else {
        setIdeas((prev) =>
          prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'approved' } : i))
        )
        setDraftStatus('error')
        setDraftError(res.error || 'Drafting failed. Please try again.')
        showToast({
          title: 'Drafting failed',
          message: res.error || 'Drafting failed. Please try again.',
          type: 'error'
        })
      }
    } catch (err: any) {
      setIdeas((prev) =>
        prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'approved' } : i))
      )
      setDraftStatus('error')
      setDraftError(err?.message || 'Something went wrong while drafting posts.')
      showToast({
        title: 'Drafting failed',
        message: err?.message || 'Something went wrong while drafting posts.',
        type: 'error'
      })
    } finally {
      setIsDrafting(false)
    }
  }

  const stagesList = [
    { key: 'gathering_context', label: 'Gathering Context', icon: BookOpen },
    { key: 'researching', label: 'Researching Web & KB', icon: Search },
    { key: 'generating_ideas', label: 'Generating Ideas', icon: Sparkles },
    { key: 'drafting', label: 'Drafting Copy', icon: FileText }
  ]

  const approvedCount = ideas.filter((i) => i.status === 'approved').length

  return (
    <div className="flex flex-col h-full lg:h-[calc(100vh-4rem)]">
      <PageHeader
        title={`Run for ${account.name}`}
        badge={run.status.replace(/_/g, ' ')}
        description={`Run ID: ${run.id} • Trigger: ${run.trigger} • Model: ${run.model || 'claude-opus-5'}`}
        preTitle={
          <Link
            href="/runs"
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Runs</span>
          </Link>
        }
        actions={
          run.status === 'awaiting_idea_approval' && (approvedCount > 0 || isDrafting) ? (
            <button
              type="button"
              onClick={handleDraftApproved}
              disabled={isDrafting}
              aria-busy={isDrafting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-75"
            >
              <Sparkles className={cn('w-4 h-4', isDrafting && 'animate-pulse')} />
              <span>{isDrafting ? 'Generating posts…' : `Draft Approved (${approvedCount})`}</span>
              {!isDrafting && <ArrowRight className="w-4 h-4" />}
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto space-y-8">

      <AiDraftingStatus
        status={draftStatus}
        subject="this run's approved ideas"
        successMessage="Posts generated! Opening the review queue…"
        errorMessage={draftError}
        onRetry={handleDraftApproved}
        retryDisabled={isDrafting}
      />

      {/* Stage Progress Stepper */}
      <div className="rounded-2xl border border-border bg-surface p-6 space-y-4 shadow-xs">
        <h2 className="text-sm font-semibold text-foreground">Execution Stages</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stagesList.map(({ key, label, icon: Icon }) => {
            const stepRecord = steps.find((s) => s.stage === key)
            const isCompleted = stepRecord?.status === 'completed'
            const isStageRunning = stepRecord?.status === 'running' || (isRunning && !stepRecord)

            return (
              <div
                key={key}
                className={`p-3.5 rounded-xl border text-xs transition-colors ${
                  isCompleted
                    ? 'border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400'
                    : isStageRunning
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-surface-hover text-muted'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Icon className="w-4 h-4" />
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : isStageRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Clock className="w-4 h-4" />
                  )}
                </div>
                <p className="font-semibold">{label}</p>
                <p className="text-[11px] opacity-80 mt-0.5 capitalize">
                  {stepRecord?.status || 'Pending'}
                  {stepRecord?.durationMs ? ` (${stepRecord.durationMs}ms)` : ''}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      <RunCostPanel
        steps={steps}
        draftCount={
          steps.filter((s) => s.stage === 'drafting' && s.status === 'completed').length
        }
        legacyCostUsd={run.costUsd}
      />

      {/* Embedded Idea Approval Gate if parked */}
      {ideas.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-accent" />
              Candidate Ideas Generated ({ideas.length})
            </h2>
            <Link
              href="/ideas"
              className="text-xs text-accent hover:underline flex items-center gap-1"
            >
              <span>Open in Ideas Inbox</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid gap-4">
            {ideas.map((idea) => (
              <RunIdeaCard
                key={idea.id}
                idea={idea}
                onApprove={handleApproveIdea}
                onReject={handleRejectIdea}
                onEditSave={handleEditIdeaSave}
                isBusy={ideaActionBusyId === idea.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Harvested Research Sources */}
      {findings.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-6 space-y-4 shadow-xs">
          <h2 className="text-sm font-semibold text-foreground">
            Harvested Grounding Sources ({findings.length})
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {findings.map((f, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl border border-border bg-surface-hover text-xs space-y-1"
              >
                <p className="font-medium text-foreground truncate">{f.title}</p>
                <p className="text-[11px] text-muted line-clamp-2">{f.snippet}</p>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline pt-1"
                >
                  <span>Open URL</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Frozen Config Snapshot (Observability W11) */}
      <div className="rounded-2xl border border-border bg-surface p-6 space-y-3 shadow-xs">
        <h2 className="text-sm font-semibold text-foreground">
          Frozen Configuration Snapshots (Auditing)
        </h2>
        <p className="text-xs text-muted">
          The exact research and media policies active when this run was initiated:
        </p>
        <pre className="p-4 rounded-xl bg-neutral-950 text-neutral-300 text-[11px] font-mono overflow-x-auto max-h-48">
          {JSON.stringify(
            {
              researchConfig: run.researchConfig,
              mediaConfig: run.mediaConfig,
              timings: run.timings
            },
            null,
            2
          )}
        </pre>
      </div>
        </div>
      </div>
    </div>
  )
}
