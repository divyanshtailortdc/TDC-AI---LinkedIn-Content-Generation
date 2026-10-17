import { useState } from 'react'
import {
  Check,
  X,
  Edit3,
  Loader2,
  ExternalLink,
  AlertTriangle,
  ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { ConfirmPopover } from '@/components/confirm-popover'

export interface IdeaCardData {
  id: string
  title: string | null
  hookConcept: string | null
  whyNow: string | null
  angle: string | null
  audienceTakeaway: string | null
  supportingEvidence: any
  status: string
  thesis?: string | null
  coreArgument?: string | null
  noveltyNote?: string | null
  pillar?: string | null
  perspectiveAngle?: string | null
  score?: number | null
  groundingScore?: number | null
  originalityScore?: number | null
  /** Grounding problems found during validation. Shown before approval. */
  risks?: string[] | null
}

interface IdeaCardProps {
  idea: IdeaCardData
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onEditSave: (id: string, payload: { hookConcept: string; angle: string }) => Promise<void>
}

const STATUS_STYLE: Record<string, string> = {
  approved: 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-400',
  rejected: 'text-rose-600 bg-rose-500/10 dark:text-rose-400',
  proposed: 'text-muted bg-surface-hover'
}

/**
 * Decision actions only make sense while an idea is still at the gate.
 * - proposed: the full decision — Reject, Edit, Approve.
 * - approved / rejected: Edit stays available, but only the action that
 *   would move it back the other way makes sense (Reject an approved idea,
 *   Approve a rejected one) — not both.
 * - anything else (e.g. already drafted and moved past the gate): the gate
 *   decision is over, so no gate actions are shown at all.
 */
function gateActionsFor(status: string) {
  switch (status) {
    case 'proposed':
      return { canReject: true, canEdit: true, canApprove: true }
    case 'approved':
      return { canReject: true, canEdit: true, canApprove: false }
    case 'rejected':
      return { canReject: false, canEdit: true, canApprove: true }
    default:
      return { canReject: false, canEdit: false, canApprove: false }
  }
}

export function IdeaCard({ idea, onApprove, onReject, onEditSave }: IdeaCardProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [editHook, setEditHook] = useState(idea.hookConcept || '')
  const [editAngle, setEditAngle] = useState(idea.angle || '')
  const [showDetails, setShowDetails] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const evidence = (idea.supportingEvidence as any[]) || []
  const risks = idea.risks || []
  const title = idea.hookConcept || idea.title || 'Untitled Idea'
  const argument = idea.thesis || idea.coreArgument
  const { canReject, canEdit, canApprove } = gateActionsFor(idea.status)

  // Grounding is the number that should change an approve/reject decision, so
  // it is shown plainly rather than as a colour alone.
  const groundingTone =
    (idea.groundingScore ?? 0) >= 75
      ? 'text-emerald-700 dark:text-emerald-400'
      : (idea.groundingScore ?? 0) >= 60
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-rose-600 dark:text-rose-400'

  const handleSaveEdit = async () => {
    setIsBusy(true)
    try {
      await onEditSave(idea.id, { hookConcept: editHook, angle: editAngle })
      setMode('view')
    } finally {
      setIsBusy(false)
    }
  }

  const handleCancelEdit = () => {
    setEditHook(idea.hookConcept || '')
    setEditAngle(idea.angle || '')
    setMode('view')
  }

  const handleApproveClick = async () => {
    setIsBusy(true)
    try {
      await onApprove(idea.id)
    } finally {
      setIsBusy(false)
    }
  }

  const handleRejectClick = async () => {
    setIsBusy(true)
    try {
      await onReject(idea.id)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6 transition-colors hover:border-foreground/15">
      {/* Identity: the idea itself, front and center */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg sm:text-xl font-semibold text-foreground leading-snug text-balance">
          {title}
        </h3>
        {idea.status !== 'proposed' && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium capitalize',
              STATUS_STYLE[idea.status] || STATUS_STYLE.proposed
            )}
          >
            {idea.status}
          </span>
        )}
      </div>

      {mode === 'edit' ? (
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">
              Hook concept
            </label>
            <textarea
              rows={3}
              value={editHook}
              onChange={(e) => setEditHook(e.target.value)}
              autoFocus
              className="w-full resize-y rounded-xl border border-border bg-surface-hover p-3 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">Angle</label>
            <input
              type="text"
              value={editAngle}
              onChange={(e) => setEditAngle(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-hover p-3 text-sm text-foreground outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleCancelEdit}
              className="h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={handleSaveEdit}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-semibold text-background transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* The essentials: why it matters, the argument, who it's for, the angle */}
          <div className="mt-3 space-y-2.5 text-sm leading-relaxed">
            {idea.whyNow && (
              <p className="text-foreground/90">
                <span className="font-semibold text-foreground">Why it matters — </span>
                {idea.whyNow}
              </p>
            )}
            {argument && <p className="text-muted">{argument}</p>}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1.5 text-xs text-muted">
            {idea.audienceTakeaway && (
              <span>
                <span className="font-medium text-foreground">Audience — </span>
                {idea.audienceTakeaway}
              </span>
            )}
            {idea.angle && (
              <span>
                <span className="font-medium text-foreground">Angle — </span>
                {idea.angle.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          {/* Evidence summary only — the rest lives behind View Details */}
          {evidence.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              <span className="font-medium text-foreground">Evidence — </span>
              {evidence.length} supporting {evidence.length === 1 ? 'source' : 'sources'}
              {evidence[0]?.claim && <>: “{evidence[0].claim}”</>}
            </p>
          )}

          {/* Everything that isn't needed for a first read: scores, risks, full evidence, novelty note */}
          {(typeof idea.groundingScore === 'number' ||
            typeof idea.score === 'number' ||
            risks.length > 0 ||
            evidence.length > 0 ||
            idea.noveltyNote) && (
            <div className="mt-4 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
              >
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform', showDetails && 'rotate-180')}
                />
                {showDetails ? 'Hide details' : 'View details'}
              </button>

              {showDetails && (
                <div className="mt-3 space-y-4">
                  {/* Scores */}
                  {(typeof idea.groundingScore === 'number' || typeof idea.score === 'number') && (
                    <div className="flex flex-wrap gap-6 text-xs">
                      {typeof idea.groundingScore === 'number' && (
                        <div>
                          <div className="text-muted">Grounding score</div>
                          <div className={cn('mt-0.5 text-sm font-semibold', groundingTone)}>
                            {idea.groundingScore}/100
                          </div>
                        </div>
                      )}
                      {typeof idea.score === 'number' && (
                        <div>
                          <div className="text-muted">Strength score</div>
                          <div className="mt-0.5 text-sm font-semibold text-foreground">
                            {idea.score}/100
                          </div>
                        </div>
                      )}
                      {idea.pillar && (
                        <div>
                          <div className="text-muted">Pillar</div>
                          <div className="mt-0.5 text-sm font-semibold text-foreground">
                            {idea.pillar}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {idea.noveltyNote && (
                    <p className="text-xs leading-relaxed text-muted italic">
                      Why this is not the generic take: {idea.noveltyNote}
                    </p>
                  )}

                  {/* Full evidence */}
                  {evidence.length > 0 && (
                    <div>
                      <span className="mb-2 block text-[10px] font-semibold tracking-wider text-muted uppercase">
                        Grounded evidence
                      </span>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {evidence.map((ev, idx) => (
                          <div
                            key={idx}
                            className="rounded-xl border border-border bg-surface-hover p-2.5 text-xs"
                          >
                            <div className="mb-1.5 flex items-center justify-between gap-2">
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                                  ev.factType === 'inferred'
                                    ? 'bg-purple-500/10 text-purple-500'
                                    : ev.factType === 'sourced'
                                      ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                )}
                              >
                                {ev.factType === 'inferred'
                                  ? 'Inferred'
                                  : ev.factType === 'sourced'
                                    ? 'From the web'
                                    : 'Verified'}
                              </span>
                              {ev.sourceUrl && (
                                <a
                                  href={ev.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] text-accent hover:underline"
                                >
                                  Source <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                            </div>
                            <p className="font-medium text-foreground">{ev.claim}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Risks flagged during validation */}
                  {risks.length > 0 && (
                    <div>
                      <span className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-400">
                        <AlertTriangle className="h-3 w-3" />
                        Check before approving
                      </span>
                      <ul className="space-y-1">
                        {risks.map((risk, idx) => (
                          <li key={idx} className="text-xs leading-relaxed text-muted">
                            • {risk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Decision actions — kept visually distinct from one another, and only
              shown when the idea is still actionable at the gate */}
          {(canReject || canEdit || canApprove) && (
            <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-4">
              {canReject && (
                <ConfirmPopover
                  title="Reject this idea?"
                  description="It will move to Rejected. You can still edit it or approve it later."
                  confirmLabel="Reject"
                  tone="danger"
                  onConfirm={handleRejectClick}
                  disabled={isBusy}
                >
                  <button
                    type="button"
                    disabled={isBusy}
                    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted transition-colors hover:text-rose-600 disabled:opacity-60 dark:hover:text-rose-400"
                  >
                    <X className="h-3.5 w-3.5" />
                    Reject
                  </button>
                </ConfirmPopover>
              )}
              {canEdit && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setMode('edit')}
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-60"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </button>
              )}
              {canApprove && (
                <ConfirmPopover
                  title="Are you sure?"
                  description="It moves to Approved and becomes eligible for drafting."
                  confirmLabel="Yes"
                  tone="success"
                  onConfirm={handleApproveClick}
                  disabled={isBusy}
                >
                  <button
                    type="button"
                    disabled={isBusy}
                    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-700 px-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Approve
                  </button>
                </ConfirmPopover>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
