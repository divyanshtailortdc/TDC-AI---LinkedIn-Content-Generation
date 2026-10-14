'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  Clock,
  Hourglass,
  Sparkles,
  ExternalLink,
  ArrowRight,
  Search,
  BookOpen,
  FileText
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { RunCostPanel } from '@/components/run-cost-panel'
import { ConfirmPopover } from '@/components/confirm-popover'
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

const ACTIVE_STATUSES = ['queued', 'running', 'researching', 'ideating']

const STAGES: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'gathering_context', label: 'Gathering context', icon: BookOpen },
  { key: 'researching', label: 'Researching web & KB', icon: Search },
  { key: 'generating_ideas', label: 'Generating ideas', icon: Sparkles },
  { key: 'drafting', label: 'Drafting posts', icon: FileText }
]

// Every stage a step can record, for labelling errors.
const STEP_LABELS: Record<string, string> = {
  gathering_context: 'Gathering context',
  researching: 'Research',
  generating_ideas: 'Ideation',
  drafting: 'Drafting',
  linting: 'Revision pass',
  media: 'Media'
}

const SOURCES_PREVIEW = 6

type StageState = 'completed' | 'partial' | 'running' | 'failed' | 'incomplete' | 'waiting' | 'pending'

const STAGE_STYLE: Record<StageState, string> = {
  completed: 'border-emerald-500/30 bg-emerald-500/5',
  partial: 'border-amber-500/30 bg-amber-500/5',
  running: 'border-accent/50 bg-accent/5',
  failed: 'border-rose-500/30 bg-rose-500/5',
  incomplete: 'border-border bg-surface-hover/50',
  waiting: 'border-border bg-surface-hover/50',
  pending: 'border-border bg-surface-hover/50'
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/** The site name to show for a source link, or null when it isn't a web URL. */
function sourceHost(url?: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/**
 * A stage can hold several steps (drafting records one per post), so its
 * state is summarised over all of them rather than read from the latest.
 */
function summarizeStage(
  key: string,
  steps: any[],
  options: { isRunning: boolean; isNextStage: boolean; awaitingApproval: boolean }
) {
  const stageSteps = steps.filter(s => s.stage === key)
  const done = stageSteps.filter(s => s.status === 'completed').length
  const failed = stageSteps.filter(s => s.status === 'failed').length
  const running = stageSteps.filter(s => s.status === 'running').length
  const durationMs = stageSteps.reduce((sum, s) => sum + (s.durationMs || 0), 0)

  let state: StageState
  if (running > 0 && options.isRunning) state = 'running'
  else if (done > 0 && failed > 0) state = 'partial'
  else if (done > 0) state = 'completed'
  else if (failed > 0) state = 'failed'
  else if (running > 0) state = 'incomplete'
  else if (options.isRunning && options.isNextStage) state = 'running'
  else if (key === 'drafting' && options.awaitingApproval) state = 'waiting'
  else state = 'pending'

  const duration = durationMs > 0 ? formatDuration(durationMs) : null
  const detail: Record<StageState, string> = {
    completed:
      key === 'drafting'
        ? `${done} post${done === 1 ? '' : 's'}${duration ? ` · ${duration}` : ''}`
        : duration || 'Done',
    partial: `${done} done · ${failed} failed`,
    running: 'In progress…',
    failed: 'Failed',
    incomplete: 'Did not finish',
    waiting: 'Waiting for idea approval',
    pending: 'Not started'
  }

  return { state, detail: detail[state], hasSteps: stageSteps.length > 0, durationMs }
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
  const [isApprovingAll, setIsApprovingAll] = useState(false)
  const [draftStatus, setDraftStatus] = useState<DraftingStatus>('idle')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [showAllSources, setShowAllSources] = useState(false)

  const isRunning = ACTIVE_STATUSES.includes(run.status)

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

        if (!ACTIVE_STATUSES.includes(res.run.status)) {
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
      return res.success
    } finally {
      setIdeaActionBusyId(null)
    }
  }

  // Approves each idea by its own id, so it works whichever account is active.
  const handleApproveAll = async () => {
    const proposedIds = ideas.filter((i) => i.status === 'proposed').map((i) => i.id)
    if (proposedIds.length === 0) return
    setIsApprovingAll(true)
    try {
      const results = await Promise.all(proposedIds.map((id) => approveIdea(id)))
      const approvedIds = proposedIds.filter((_, idx) => results[idx]?.success)
      setIdeas((prev) =>
        prev.map((i) => (approvedIds.includes(i.id) ? { ...i, status: 'approved' } : i))
      )
      const failedCount = proposedIds.length - approvedIds.length
      if (failedCount > 0) {
        showToast({
          title: 'Some approvals failed',
          message: `${approvedIds.length} approved, ${failedCount} could not be approved.`,
          type: 'error'
        })
      } else {
        showToast({
          title: 'Approved All',
          message: `Approved ${approvedIds.length} idea${approvedIds.length === 1 ? '' : 's'}.`,
          type: 'success'
        })
      }
    } finally {
      setIsApprovingAll(false)
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

  const awaitingApproval = run.status === 'awaiting_idea_approval'
  const statusCount = (status: string) => ideas.filter((i) => i.status === status).length
  const approvedCount = statusCount('approved')
  const proposedCount = statusCount('proposed')
  const isBusy = isDrafting || isApprovingAll

  // While the run is active and no step is mid-flight, the first stage with
  // nothing recorded yet is the one starting. Drafting only starts after
  // approval, so it is never inferred here.
  const stepInFlight = isRunning && steps.some((s) => s.status === 'running')
  const nextStageKey = stepInFlight
    ? undefined
    : STAGES.find(({ key }) => key !== 'drafting' && !steps.some((s) => s.stage === key))?.key
  const stages = STAGES.map((stage) => ({
    ...stage,
    ...summarizeStage(stage.key, steps, {
      isRunning,
      isNextStage: stage.key === nextStageKey,
      awaitingApproval
    })
  }))
  const totalDurationMs = stages.reduce((sum, s) => sum + s.durationMs, 0)
  const failedSteps = steps.filter((s) => s.status === 'failed' && s.error)

  const ideaSummary = [
    proposedCount > 0 && `${proposedCount} to review`,
    approvedCount > 0 && `${approvedCount} approved`,
    statusCount('drafted') > 0 && `${statusCount('drafted')} drafted`,
    statusCount('rejected') > 0 && `${statusCount('rejected')} rejected`
  ]
    .filter(Boolean)
    .join(' · ')

  const visibleFindings = showAllSources ? findings : findings.slice(0, SOURCES_PREVIEW)

  return (
    <div className="flex flex-col h-full lg:h-[calc(100vh-4rem)]">
      <PageHeader
        title={`Run for ${account.name}`}
        badge={run.status.replace(/_/g, ' ')}
        description={`${run.trigger === 'manual' ? 'Manual' : run.trigger} run · ${run.model || 'claude-opus-5'}`}
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
          awaitingApproval && (proposedCount > 0 || approvedCount > 0 || isDrafting) ? (
            <>
              {proposedCount > 0 && (
                <ConfirmPopover
                  title={`Approve all ${proposedCount} ideas?`}
                  description="Every idea in this run waiting for review moves to Approved."
                  confirmLabel="Approve all"
                  tone="success"
                  onConfirm={handleApproveAll}
                  disabled={isBusy}
                >
                  <button
                    type="button"
                    disabled={isBusy}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/30 px-4 py-2.5 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/10 disabled:opacity-60 dark:text-emerald-400"
                  >
                    {isApprovingAll ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCheck className="h-4 w-4" />
                    )}
                    <span>Approve all ({proposedCount})</span>
                  </button>
                </ConfirmPopover>
              )}
              {(approvedCount > 0 || isDrafting) && (
                <button
                  type="button"
                  onClick={handleDraftApproved}
                  disabled={isBusy}
                  aria-busy={isDrafting}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-75"
                >
                  <Sparkles className={cn('w-4 h-4', isDrafting && 'animate-pulse')} />
                  <span>{isDrafting ? 'Generating posts…' : `Create ${approvedCount} post${approvedCount === 1 ? '' : 's'}`}</span>
                  {!isDrafting && <ArrowRight className="w-4 h-4" />}
                </button>
              )}
            </>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto space-y-6">
          <AiDraftingStatus
            status={draftStatus}
            subject="this run's approved ideas"
            successMessage="Posts generated! Opening the review queue…"
            errorMessage={draftError}
            onRetry={handleDraftApproved}
            retryDisabled={isDrafting}
          />

          {run.error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">This run failed</p>
                <p className="mt-0.5 text-xs leading-relaxed wrap-break-word">{run.error}</p>
              </div>
            </div>
          )}

          {/* Progress */}
          <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6 shadow-xs">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Progress</h2>
              <span className="text-muted inline-flex items-center gap-1.5 text-xs tabular-nums">
                {isRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Updating live
                  </>
                ) : totalDurationMs > 0 ? (
                  <>
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(totalDurationMs)} total
                  </>
                ) : null}
              </span>
            </div>

            <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stages.map(({ key, label, icon: Icon, state, detail }) => (
                <li key={key} className={cn('rounded-xl border p-3.5', STAGE_STYLE[state])}>
                  <div className="flex items-center justify-between">
                    <Icon className="text-muted h-4 w-4" />
                    <StageIcon state={state} />
                  </div>
                  <p className="text-foreground mt-2 text-sm font-semibold">{label}</p>
                  <p className="text-muted mt-0.5 text-xs tabular-nums">{detail}</p>
                </li>
              ))}
            </ol>

            {failedSteps.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {failedSteps.length} step{failedSteps.length === 1 ? '' : 's'} failed
                </p>
                <ul className="space-y-1.5">
                  {failedSteps.map((step) => (
                    <li
                      key={step.id}
                      className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs"
                    >
                      <span className="text-foreground font-medium">
                        {STEP_LABELS[step.stage] || step.stage}
                      </span>
                      {step.requestSummary && (
                        <span className="text-muted"> · {step.requestSummary}</span>
                      )}
                      <p className="text-muted mt-0.5 line-clamp-2 wrap-break-word" title={step.error}>
                        {step.error}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <RunCostPanel
            steps={steps}
            draftCount={
              steps.filter((s) => s.stage === 'drafting' && s.status === 'completed').length
            }
            legacyCostUsd={run.costUsd}
          />

          {/* Ideas generated by this run */}
          {ideas.length > 0 ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    Ideas ({ideas.length})
                  </h2>
                  {ideaSummary && <p className="text-muted mt-0.5 text-xs">{ideaSummary}</p>}
                </div>
                <Link
                  href="/ideas"
                  className="text-xs text-accent hover:underline flex items-center gap-1"
                >
                  <span>Open in Ideas</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {ideas.map((idea) => (
                  <RunIdeaCard
                    key={idea.id}
                    idea={idea}
                    onApprove={handleApproveIdea}
                    onReject={handleRejectIdea}
                    onEditSave={handleEditIdeaSave}
                    isBusy={ideaActionBusyId === idea.id || isBusy}
                  />
                ))}
              </div>
            </section>
          ) : (
            isRunning && (
              <section className="border-border text-muted flex items-center gap-3 rounded-2xl border border-dashed p-6 text-sm">
                <Hourglass className="h-4 w-4 shrink-0" />
                Ideas appear here once ideation finishes.
              </section>
            )
          )}

          {/* Research sources the ideas were grounded in */}
          {findings.length > 0 && (
            <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6 space-y-4 shadow-xs">
              <h2 className="text-sm font-semibold text-foreground">
                Research sources ({findings.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {visibleFindings.map((f, idx) => (
                  <div
                    key={f.id ?? idx}
                    className="p-3 rounded-xl border border-border bg-surface-hover/60 text-xs space-y-1"
                  >
                    <p className="font-medium text-foreground line-clamp-1" title={f.title}>
                      {f.title}
                    </p>
                    {f.snippet && <p className="text-muted line-clamp-2">{f.snippet}</p>}
                    {sourceHost(f.url) ? (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 pt-1 text-accent hover:underline"
                      >
                        <span className="truncate">{sourceHost(f.url)}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <p className="text-muted pt-1">Knowledge base</p>
                    )}
                  </div>
                ))}
              </div>
              {findings.length > SOURCES_PREVIEW && (
                <button
                  type="button"
                  onClick={() => setShowAllSources((v) => !v)}
                  className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
                >
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', showAllSources && 'rotate-180')}
                  />
                  {showAllSources ? 'Show fewer' : `Show all ${findings.length}`}
                </button>
              )}
            </section>
          )}

          {/* Settings frozen at run start, for auditing */}
          <details className="group rounded-2xl border border-border bg-surface shadow-xs">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-5 sm:px-6 text-sm font-semibold text-foreground">
              Run configuration
              <ChevronDown className="text-muted h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 px-5 pb-5 sm:px-6 sm:pb-6">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                <dt className="text-muted">Run ID</dt>
                <dd className="text-foreground font-mono break-all">{run.id}</dd>
                <dt className="text-muted">Trigger</dt>
                <dd className="text-foreground">{run.trigger}</dd>
                <dt className="text-muted">Model</dt>
                <dd className="text-foreground">{run.model || 'claude-opus-5'}</dd>
              </dl>
              <p className="text-xs text-muted">
                The research and media settings active when this run started:
              </p>
              <pre className="p-4 rounded-xl bg-neutral-950 text-neutral-300 text-[11px] font-mono overflow-x-auto max-h-64">
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
          </details>
        </div>
      </div>
    </div>
  )
}

function StageIcon({ state }: { state: StageState }) {
  switch (state) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    case 'partial':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />
    case 'running':
      return <Loader2 className="text-accent h-4 w-4 animate-spin" />
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-rose-500" />
    case 'waiting':
      return <Hourglass className="text-muted h-4 w-4" />
    default:
      return <Clock className="text-muted h-4 w-4" />
  }
}
