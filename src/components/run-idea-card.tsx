'use client'

import { useState } from 'react'
import { Loader2, Flame, Check, X, Edit3 } from 'lucide-react'
import { ConfirmPopover } from '@/components/confirm-popover'

export interface RunIdeaCardData {
  id: string
  title: string | null
  angle: string | null
  perspectiveAngle?: string | null
  pillar?: string | null
  groundingScore?: number | null
  whyNow: string | null
  thesis?: string | null
  hookConcept: string | null
  coreArgument?: string | null
  status: string
}

interface RunIdeaCardProps {
  idea: RunIdeaCardData
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onEditSave: (id: string, payload: { hookConcept: string; angle: string }) => Promise<void>
  isBusy: boolean
}

// Same rule as the Idea Gate: approve/reject only make sense while the idea
// is still proposed/approved/rejected — once it's moved past the gate (e.g.
// already drafted) neither action applies. A rejected idea can still be
// approved.
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

/**
 * The idea card used for "Candidate Ideas Generated" — originally the Run
 * Detail page's own markup, now shared so the Ideas page shows the exact
 * same card for the exact same idea.
 */
export function RunIdeaCard({ idea, onApprove, onReject, onEditSave, isBusy }: RunIdeaCardProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [editHook, setEditHook] = useState(idea.hookConcept || '')
  const [editAngle, setEditAngle] = useState(idea.angle || '')
  const { canReject, canEdit, canApprove } = gateActionsFor(idea.status)

  const handleSaveEdit = async () => {
    await onEditSave(idea.id, { hookConcept: editHook, angle: editAngle })
    setMode('view')
  }

  const handleCancelEdit = () => {
    setEditHook(idea.hookConcept || '')
    setEditAngle(idea.angle || '')
    setMode('view')
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
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
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${
              idea.status === 'approved'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                : idea.status === 'rejected'
                  ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600'
            }`}
          >
            {idea.status}
          </span>
        </div>
      </div>

      {mode === 'edit' ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">
              Hook concept
            </label>
            <textarea
              rows={3}
              value={editHook}
              onChange={(e) => setEditHook(e.target.value)}
              autoFocus
              className="w-full resize-y rounded-lg border border-border bg-surface-hover p-2.5 text-xs text-foreground outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-foreground">Angle</label>
            <input
              type="text"
              value={editAngle}
              onChange={(e) => setEditAngle(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-hover p-2.5 text-xs text-foreground outline-none focus:border-accent"
            />
          </div>
          <div className="pt-2 border-t border-border flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleCancelEdit}
              className="px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={handleSaveEdit}
              className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-accent text-background text-xs font-semibold transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Save Changes</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          {idea.whyNow && (
            <div className="rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>
                <strong>Why Now:</strong> {idea.whyNow}
              </span>
            </div>
          )}

          <h3 className="font-semibold text-sm text-foreground">{idea.title || idea.angle}</h3>

          {idea.thesis && (
            <div className="rounded-lg border border-border bg-surface-hover p-2.5 text-xs">
              <span className="font-semibold text-accent uppercase tracking-wider text-[10px] block mb-0.5">
                Underlying Thesis
              </span>
              <p className="text-xs text-foreground font-medium">{idea.thesis}</p>
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

          {(canReject || canEdit || canApprove) && (
            <div className="pt-2 border-t border-border flex items-center justify-end gap-2">
              {canReject && (
                <ConfirmPopover
                  title="Reject this idea?"
                  description="It will move to Rejected."
                  confirmLabel="Reject"
                  tone="danger"
                  onConfirm={() => onReject(idea.id)}
                  disabled={isBusy}
                >
                  <button
                    type="button"
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border hover:text-rose-600 text-xs font-medium transition-colors disabled:opacity-60"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                    <span>Reject</span>
                  </button>
                </ConfirmPopover>
              )}
              {canEdit && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setMode('edit')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium transition-colors hover:bg-surface-hover disabled:opacity-60"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              )}
              {canApprove && (
                <ConfirmPopover
                  title="Are you sure?"
                  description="It moves to Approved and becomes eligible for drafting."
                  confirmLabel="Yes"
                  tone="success"
                  onConfirm={() => onApprove(idea.id)}
                  disabled={isBusy}
                >
                  <button
                    type="button"
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-60"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    <span>Approve</span>
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
