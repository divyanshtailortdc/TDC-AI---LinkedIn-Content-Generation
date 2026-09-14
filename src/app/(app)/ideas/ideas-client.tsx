'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Check,
  X,
  Edit3,
  Sparkles,
  ExternalLink,
  AlertTriangle,
  Flame,
  ArrowRight,
  Filter,
  CheckCircle2,
  Clock,
  Layers
} from 'lucide-react'
import { approveIdea, rejectIdea, editAndApproveIdea, draftApprovedIdeas } from './actions'

interface IdeaData {
  id: string
  accountId: string
  accountName: string
  title: string | null
  thesis?: string | null
  perspectiveAngle?: string | null
  angle: string | null
  pillar: string | null
  whyNow: string | null
  hookConcept: string | null
  coreArgument: string | null
  audienceTakeaway: string | null
  supportingEvidence: any
  suggestedMedia: any
  noveltyNote: string | null
  score: number
  groundingScore?: number
  originalityScore?: number
  unsupportedClaims?: string[] | any
  sourceIds?: string[] | any
  risks: any
  status: string
  createdAt: Date | string
}

const formatAngleName = (angle?: string | null) => {
  if (!angle) return null
  const map: Record<string, { label: string; icon: string }> = {
    operational_problems: { label: 'Operational Problems', icon: '⚙️' },
    strategic_decisions: { label: 'Strategic Decisions', icon: '🎯' },
    industry_misconceptions: { label: 'Industry Misconceptions', icon: '🔍' },
    technology_architecture: { label: 'Tech Architecture', icon: '🏛️' },
    buyer_behavior: { label: 'Buyer Behavior', icon: '🛍️' },
    automation: { label: 'Automation Realities', icon: '⚡' },
    contrarian_viewpoints: { label: 'Contrarian POV', icon: '🧠' }
  }
  return map[angle] || { label: angle.replace(/_/g, ' '), icon: '💡' }
}

export function IdeasClient({
  initialIdeas,
  accounts
}: {
  initialIdeas: IdeaData[]
  accounts: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [ideas, setIdeas] = useState<IdeaData[]>(initialIdeas)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('proposed')
  const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null)
  const [editAngle, setEditAngle] = useState('')
  const [editHook, setEditHook] = useState('')
  const [editMediaMode, setEditMediaMode] = useState<'ai_generated' | 'stock' | 'none'>('none')
  const [isActionBusy, setIsActionBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Filter ideas
  const filteredIdeas = ideas.filter((idea) => {
    const matchesAccount = selectedAccountId === 'all' || idea.accountId === selectedAccountId
    const matchesStatus =
      selectedStatus === 'all'
        ? true
        : selectedStatus === 'proposed'
          ? idea.status === 'proposed'
          : selectedStatus === 'approved'
            ? idea.status === 'approved'
            : selectedStatus === 'rejected'
              ? idea.status === 'rejected'
              : true
    return matchesAccount && matchesStatus
  })

  const approvedCount = ideas.filter((i) => i.status === 'approved').length

  const handleApprove = async (id: string) => {
    setIsActionBusy(true)
    setMessage(null)
    try {
      const res = await approveIdea(id)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'approved' } : i)))
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const handleReject = async (id: string) => {
    const reason = prompt('Rejection reason (helps future generations learn what to avoid):')
    setIsActionBusy(true)
    setMessage(null)
    try {
      const res = await rejectIdea(id, reason || undefined)
      if (res.success) {
        setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'rejected' } : i)))
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const startEditing = (idea: IdeaData) => {
    setEditingIdeaId(idea.id)
    setEditAngle(idea.angle || '')
    setEditHook(idea.hookConcept || '')
    setEditMediaMode((idea.suggestedMedia as any)?.mode || 'none')
  }

  const handleSaveEdit = async (id: string) => {
    setIsActionBusy(true)
    try {
      const res = await editAndApproveIdea(id, {
        angle: editAngle,
        hookConcept: editHook,
        mediaMode: editMediaMode
      })
      if (res.success) {
        setIdeas((prev) =>
          prev.map((i) =>
            i.id === id
              ? {
                  ...i,
                  angle: editAngle,
                  hookConcept: editHook,
                  suggestedMedia: { ...((i.suggestedMedia as any) || {}), mode: editMediaMode },
                  status: 'approved'
                }
              : i
          )
        )
        setEditingIdeaId(null)
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  const handleDraftApproved = async () => {
    setIsActionBusy(true)
    setMessage('Drafting approved ideas with grounded citations and platform rules...')
    try {
      const approvedIds = ideas.filter((i) => i.status === 'approved').map((i) => i.id)
      const res = await draftApprovedIdeas({ ideaIds: approvedIds })
      if (res.success) {
        setMessage(`Successfully drafted ${res.draftedCount} post(s)! Redirecting to review queue...`)
        setTimeout(() => {
          router.push('/posts')
        }, 1200)
      } else {
        setMessage(res.error || 'Drafting failed')
      }
    } finally {
      setIsActionBusy(false)
    }
  }

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
              Idea Approval Gate
            </h1>
            <span className="rounded-full bg-[var(--accent)]/10 text-[var(--accent)] px-2.5 py-0.5 text-xs font-semibold">
              The Gate
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            Steer angles early so the drafting stage only runs on ideas you genuinely believe in.
          </p>
        </div>

        {approvedCount > 0 && (
          <button
            type="button"
            onClick={handleDraftApproved}
            disabled={isActionBusy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Draft Approved ({approvedCount})</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {message && (
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{message}</span>
        </div>
      )}

      {/* Filter and Status Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Status Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-xs">
          {(['proposed', 'approved', 'rejected', 'all'] as const).map((st) => {
            const count =
              st === 'all'
                ? ideas.length
                : ideas.filter((i) => i.status === st).length

            return (
              <button
                key={st}
                type="button"
                onClick={() => setSelectedStatus(st)}
                className={`px-3 py-1.5 rounded-lg capitalize font-medium transition-colors ${
                  selectedStatus === st
                    ? 'bg-[var(--foreground)] text-[var(--background)] shadow-xs'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {st} ({count})
              </button>
            )
          })}
        </div>

        {/* Identity Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-[var(--muted)]" />
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--accent)]"
          >
            <option value="all">All Identities</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Ideas Card List */}
      {filteredIdeas.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border-2 border-dashed border-[var(--border)] bg-[var(--surface)]">
          <Sparkles className="w-8 h-8 text-[var(--muted)] mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-[var(--foreground)]">No ideas in this queue</h3>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-sm mx-auto">
            Generate now from your Dashboard or Run engine to populate new grounded angles.
          </p>
          <Link
            href="/runs"
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-xs font-medium"
          >
            View Runs
          </Link>
        </div>
      ) : (
        <div className="grid gap-6">
          {filteredIdeas.map((idea) => {
            const isEditing = editingIdeaId === idea.id
            const evidence = (idea.supportingEvidence as any[]) || []
            const risks = (idea.risks as string[]) || []
            const angleInfo = formatAngleName(idea.perspectiveAngle)
            const unsupported = (idea.unsupportedClaims as string[]) || []

            return (
              <div
                key={idea.id}
                className={`rounded-2xl border bg-[var(--surface)] p-6 transition-all shadow-xs ${
                  idea.status === 'approved'
                    ? 'border-emerald-500/40 dark:border-emerald-500/30'
                    : idea.status === 'rejected'
                      ? 'border-rose-500/30 opacity-70'
                      : 'border-[var(--border)] hover:border-[var(--accent)]/40'
                }`}
              >
                {/* Header info */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-xs text-[var(--accent)]">
                      {idea.accountName}
                    </span>
                    <span className="text-[var(--border)]">•</span>
                    {angleInfo && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)]/10 text-[var(--accent)] px-2 py-0.5 text-[11px] font-medium">
                        <span>{angleInfo.icon}</span>
                        <span>{angleInfo.label}</span>
                      </span>
                    )}
                    {idea.pillar && (
                      <span className="rounded-md bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground)]">
                        {idea.pillar}
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

                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      (idea.groundingScore ?? 80) >= 85
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : (idea.groundingScore ?? 80) >= 60
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    }`}>
                      🛡️ {idea.groundingScore ?? 80}% Grounded {(idea.groundingScore ?? 80) >= 85 ? '(Direct)' : '(Inferred)'}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                      💡 {idea.originalityScore ?? 85}% Original
                    </span>
                  </div>
                </div>

                {/* Why Now Highlight */}
                {idea.whyNow && (
                  <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-2 text-xs flex items-start gap-2 text-amber-800 dark:text-amber-300">
                    <Flame className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <span className="font-semibold">Why Now: </span>
                      <span>{idea.whyNow}</span>
                    </div>
                  </div>
                )}

                {/* Angle & Content */}
                {isEditing ? (
                  <div className="space-y-4 my-4 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)]">
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                        Angle / Thesis
                      </label>
                      <textarea
                        value={editAngle}
                        onChange={(e) => setEditAngle(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs text-[var(--foreground)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                        Hook Concept (the ~200-character fold)
                      </label>
                      <input
                        type="text"
                        value={editHook}
                        onChange={(e) => setEditHook(e.target.value)}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs text-[var(--foreground)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--muted)] mb-1">
                        Media Mode Override
                      </label>
                      <select
                        value={editMediaMode}
                        onChange={(e: any) => setEditMediaMode(e.target.value)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs text-[var(--foreground)]"
                      >
                        <option value="none">Text only (none)</option>
                        <option value="stock">Find stock photo</option>
                        <option value="ai_generated">Generate AI image</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setEditingIdeaId(null)}
                        className="px-3 py-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(idea.id)}
                        className="px-3.5 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium"
                      >
                        Save &amp; Approve
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <h2 className="text-base font-semibold text-[var(--foreground)]">
                      {idea.title || idea.angle}
                    </h2>

                    {/* Thesis Box */}
                    {idea.thesis && (
                      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-xs">
                        <span className="font-semibold text-[var(--accent)] uppercase tracking-wider text-[10px] block mb-1">
                          Underlying Thesis
                        </span>
                        <p className="text-xs text-[var(--foreground)] font-medium leading-relaxed">
                          {idea.thesis}
                        </p>
                      </div>
                    )}

                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      <span className="font-semibold text-[var(--foreground)]">Core Argument: </span>
                      {idea.coreArgument}
                    </p>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      <span className="font-semibold text-[var(--foreground)]">Hook Concept: </span>
                      <span className="font-mono text-[11px] bg-[var(--surface-hover)] px-1.5 py-0.5 rounded">
                        &quot;{idea.hookConcept}&quot;
                      </span>
                    </p>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">
                      <span className="font-semibold text-[var(--foreground)]">Reader Takeaway: </span>
                      {idea.audienceTakeaway}
                    </p>
                  </div>
                )}

                {/* Grounding Evidence Sources with Verified vs Inferred badges */}
                {evidence.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[var(--border)]">
                    <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider block mb-2">
                      Grounded Citations &amp; Proof ({evidence.length})
                    </span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {evidence.map((ev, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-3 text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                              ev.factType === 'inferred'
                                ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300'
                                : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            }`}>
                              {ev.factType === 'inferred' ? 'Inferred' : 'Verified'}
                            </span>
                            {ev.confidence && (
                              <span className="text-[10px] text-[var(--muted)] font-mono">
                                {Math.round(ev.confidence * 100)}% conf
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-[var(--foreground)] line-clamp-2">
                            {ev.claim}
                          </p>
                          {ev.quote && (
                            <p className="text-[11px] text-[var(--muted)] italic line-clamp-2">
                              &quot;{ev.quote}&quot;
                            </p>
                          )}
                          {ev.sourceUrl && (
                            <a
                              href={ev.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline"
                            >
                              <span>{ev.sourceTitle || 'View source'}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Excluded Unsupported Claims Badge */}
                {unsupported.length > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />
                    <span>Excluded {unsupported.length} ungrounded assertion(s) during validation</span>
                  </div>
                )}

                {/* Risks / Novelty */}
                {risks.length > 0 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Risk: {risks.join(', ')}</span>
                  </div>
                )}

                {/* Bottom Action Bar */}
                <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
                  <div className="text-[11px] text-[var(--muted)]">
                    {idea.noveltyNote && <span>{idea.noveltyNote}</span>}
                  </div>

                  <div className="flex items-center gap-2">
                    {idea.status !== 'rejected' && (
                      <button
                        type="button"
                        onClick={() => handleReject(idea.id)}
                        disabled={isActionBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] hover:border-rose-500/40 text-[var(--muted)] hover:text-rose-600 text-xs font-medium transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Reject</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => startEditing(idea)}
                      disabled={isActionBusy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--foreground)] text-xs font-medium transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit &amp; Approve</span>
                    </button>

                    {idea.status !== 'approved' && (
                      <button
                        type="button"
                        onClick={() => handleApprove(idea.id)}
                        disabled={isActionBusy}
                        className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
