import { useState } from 'react'
import { Check, X, Edit3, Loader2, ExternalLink, AlertTriangle } from 'lucide-react'

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

export function IdeaCard({ idea, onApprove, onReject, onEditSave }: IdeaCardProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [editHook, setEditHook] = useState(idea.hookConcept || '')
  const [editAngle, setEditAngle] = useState(idea.angle || '')
  const [isBusy, setIsBusy] = useState(false)

  const evidence = (idea.supportingEvidence as any[]) || []
  const risks = idea.risks || []

  // Grounding is the number that should change an approve/reject decision, so
  // it is shown plainly rather than as a colour alone.
  const groundingTone =
    (idea.groundingScore ?? 0) >= 75
      ? 'text-emerald-500'
      : (idea.groundingScore ?? 0) >= 60
        ? 'text-amber-500'
        : 'text-rose-500'

  const handleSaveEdit = async () => {
    setIsBusy(true)
    try {
      await onEditSave(idea.id, { hookConcept: editHook, angle: editAngle })
      setMode('view')
    } finally {
      setIsBusy(false)
    }
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

  if (mode === 'edit') {
    return (
      <div className="rounded-2xl border border-accent/20 bg-accent/5 p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Edit Hook Concept</label>
          <textarea
            rows={3}
            value={editHook}
            onChange={(e) => setEditHook(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-foreground focus:outline-none focus:border-accent resize-y"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-foreground mb-1.5">Edit Angle</label>
          <input
            type="text"
            value={editAngle}
            onChange={(e) => setEditAngle(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface p-3 text-sm text-foreground focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setMode('view')}
            className="px-4 py-2 text-xs font-medium text-muted hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={handleSaveEdit}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-background text-xs font-semibold transition-colors cursor-pointer"
          >
            {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface shadow-xs p-5 sm:p-6 transition-all hover:border-accent/30">
      {/* Top Header / Core Identity */}
      <div className="mb-4">
        <h3 className="text-lg font-bold text-foreground leading-snug">
          {idea.hookConcept || idea.title || 'Untitled Idea'}
        </h3>
        {idea.whyNow && (
          <p className="mt-2 text-sm text-muted leading-relaxed">
            <span className="font-semibold text-foreground">Why it matters: </span>
            {idea.whyNow}
          </p>
        )}
      </div>

      {/* The argument itself, so the gate is a real decision and not a coin flip */}
      {(idea.thesis || idea.coreArgument) && (
        <p className="text-foreground/90 mb-4 text-sm leading-relaxed">
          {idea.thesis || idea.coreArgument}
        </p>
      )}

      {idea.noveltyNote && (
        <p className="text-muted mb-4 text-xs leading-relaxed italic">
          Why this is not the generic take: {idea.noveltyNote}
        </p>
      )}

      {/* Meta Context */}
      <div className="flex flex-wrap items-center gap-3 mb-5 text-[11px] font-medium">
        {typeof idea.groundingScore === 'number' && (
          <span className="border-border bg-surface-hover text-muted inline-flex items-center rounded-full border px-2.5 py-1">
            Grounding:{' '}
            <span className={`ml-1 font-semibold ${groundingTone}`}>
              {idea.groundingScore}/100
            </span>
          </span>
        )}
        {typeof idea.score === 'number' && (
          <span className="border-border bg-surface-hover text-muted inline-flex items-center rounded-full border px-2.5 py-1">
            Strength: <span className="text-foreground ml-1">{idea.score}/100</span>
          </span>
        )}
        {idea.pillar && (
          <span className="border-border bg-surface-hover text-muted inline-flex items-center rounded-full border px-2.5 py-1">
            Pillar: <span className="text-foreground ml-1">{idea.pillar}</span>
          </span>
        )}
        {idea.angle && (
          <span className="inline-flex items-center rounded-full bg-surface-hover px-2.5 py-1 text-muted border border-border">
            Angle: <span className="text-foreground ml-1">{idea.angle.replace(/_/g, ' ')}</span>
          </span>
        )}
        {idea.audienceTakeaway && (
          <span className="inline-flex items-center rounded-full bg-surface-hover px-2.5 py-1 text-muted border border-border max-w-[300px] truncate">
            Audience: <span className="text-foreground ml-1 truncate">{idea.audienceTakeaway}</span>
          </span>
        )}
      </div>

      {/* Evidence */}
      {evidence.length > 0 && (
        <div className="mb-6">
          <span className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2 block">
            Grounded Evidence
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {evidence.slice(0, 2).map((ev, idx) => (
              <div key={idx} className="rounded-xl border border-border bg-surface-hover p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    ev.factType === 'inferred' 
                      ? 'bg-purple-500/10 text-purple-400' 
                      : 'bg-emerald-500/10 text-emerald-500'
                  }`}>
                    {ev.factType === 'inferred' ? 'Inferred' : 'Verified'}
                  </span>
                  {ev.sourceUrl && (
                    <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline flex items-center gap-1 text-[10px]">
                      Source <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  )}
                </div>
                <p className="text-foreground font-medium line-clamp-2">{ev.claim}</p>
              </div>
            ))}
            {evidence.length > 2 && (
              <div className="col-span-full text-[11px] text-muted italic pl-1">
                + {evidence.length - 2} more citations...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Anything the grounding checks flagged, before you commit to drafting */}
      {risks.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <span className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-amber-600 uppercase dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" />
            Check before approving
          </span>
          <ul className="space-y-1">
            {risks.slice(0, 4).map((risk, idx) => (
              <li key={idx} className="text-muted text-xs leading-relaxed">
                • {risk}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
        {idea.status !== 'rejected' && (
          <button
            type="button"
            disabled={isBusy}
            onClick={handleRejectClick}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border text-muted hover:text-rose-500 hover:border-rose-500/30 text-xs font-medium transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Reject
          </button>
        )}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => setMode('edit')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border text-foreground hover:bg-surface-hover text-xs font-medium transition-colors cursor-pointer"
        >
          <Edit3 className="w-3.5 h-3.5" />
          Edit
        </button>
        {idea.status !== 'approved' && (
          <button
            type="button"
            disabled={isBusy}
            onClick={handleApproveClick}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            Approve
          </button>
        )}
      </div>
    </div>
  )
}
