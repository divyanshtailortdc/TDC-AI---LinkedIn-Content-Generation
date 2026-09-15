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
  Flame,
  Check,
  X,
  ArrowRight,
  Search,
  BookOpen,
  FileText
} from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { fetchRunStatus } from '../actions'
import { approveIdea, rejectIdea, draftApprovedIdeas } from '../../ideas/actions'

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
  const [actionMessage, setActionMessage] = useState<string | null>(null)

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

  const handleApproveIdea = async (ideaId: string) => {
    const res = await approveIdea(ideaId)
    if (res.success) {
      setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, status: 'approved' } : i)))
    }
  }

  const handleRejectIdea = async (ideaId: string) => {
    const res = await rejectIdea(ideaId)
    if (res.success) {
      setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, status: 'rejected' } : i)))
    }
  }

  const handleDraftApproved = async () => {
    setIsDrafting(true)
    setActionMessage('Drafting approved ideas into grounded LinkedIn posts...')
    try {
      const res = await draftApprovedIdeas({ runId: run.id })
      if (res.success) {
        setActionMessage(`Drafting complete! Redirecting to the review queue...`)
        setTimeout(() => {
          router.push(`/posts?runId=${run.id}`)
        }, 1200)
      } else {
        setActionMessage(res.error || 'Failed to draft')
      }
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
          run.status === 'awaiting_idea_approval' && approvedCount > 0 ? (
            <button
              type="button"
              onClick={handleDraftApproved}
              disabled={isDrafting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Draft Approved ({approvedCount})</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto space-y-8">

      {actionMessage && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

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
              <div
                key={idea.id}
                className="rounded-xl border border-border bg-surface p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {idea.perspectiveAngle && (
                      <span className="rounded-md bg-accent/10 text-accent px-2 py-0.5 text-[11px] font-medium capitalize">
                        {idea.perspectiveAngle.replace(/_/g, ' ')}
                      </span>
                    )}
                    <span className="font-semibold text-xs text-muted">
                      {idea.pillar || 'Thought Leadership'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {idea.groundingScore && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        🛡️ {idea.groundingScore}% Grounded
                      </span>
                    )}
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                      idea.status === 'approved'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                        : idea.status === 'rejected'
                          ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600'
                    }`}>
                      {idea.status}
                    </span>
                  </div>
                </div>

                {idea.whyNow && (
                  <div className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span><strong>Why Now:</strong> {idea.whyNow}</span>
                  </div>
                )}

                <h3 className="font-semibold text-sm text-foreground">
                  {idea.title || idea.angle}
                </h3>

                {idea.thesis && (
                  <div className="rounded-lg border border-border bg-surface-hover p-2.5 text-xs">
                    <span className="font-semibold text-accent uppercase tracking-wider text-[10px] block mb-0.5">
                      Underlying Thesis
                    </span>
                    <p className="text-xs text-foreground font-medium">
                      {idea.thesis}
                    </p>
                  </div>
                )}

                <p className="text-xs text-muted">
                  <strong className="text-foreground">Hook Concept: </strong>
                  &quot;{idea.hookConcept}&quot;
                </p>
                <p className="text-xs text-muted">
                  <strong className="text-foreground">Core Argument: </strong>
                  {idea.coreArgument}
                </p>

                <div className="pt-2 border-t border-border flex items-center justify-end gap-2">
                  {idea.status !== 'rejected' && (
                    <button
                      type="button"
                      onClick={() => handleRejectIdea(idea.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:text-rose-600 text-xs font-medium transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  )}
                  {idea.status !== 'approved' && (
                    <button
                      type="button"
                      onClick={() => handleApproveIdea(idea.id)}
                      className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>
                  )}
                </div>
              </div>
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
