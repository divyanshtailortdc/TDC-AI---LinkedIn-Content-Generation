'use client'

import { ConfirmPopover } from '@/components/confirm-popover'
import { cn } from '@/lib/cn'
import { INACTIVE_ACCOUNT_MESSAGE } from '@/lib/inactive-account'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Edit3,
  ExternalLink,
  Flame,
  Loader2,
  Sparkles,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'

interface EvidenceItem {
  claim?: string
  sourceTitle?: string
  sourceUrl?: string
  factType?: string
}

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
  audienceTakeaway?: string | null
  noveltyNote?: string | null
  supportingEvidence?: unknown
  /** Grounding problems found during validation; worth checking before approval. */
  risks?: string[] | null
  score?: number | null
  originalityScore?: number | null
  status: string
}

interface RunIdeaCardProps {
  idea: RunIdeaCardData
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  /** Resolve to false to keep the editor open (the save failed). */
  onEditSave: (
    id: string,
    payload: { hookConcept: string; angle: string }
  ) => Promise<boolean | void>
  onDraft?: (id: string) => Promise<void>
  isBusy: boolean
  /** The idea's identity is deactivated: every action is disabled, Details still opens. */
  locked?: boolean
  /** Hide the status badge where the surrounding list already filters by it. */
  showStatus?: boolean
}

// Same rule as the Idea Gate: approve/reject only make sense while the idea
// is still proposed/approved/rejected — once it's moved past the gate (e.g.
// already drafted) neither action applies. A rejected idea can still be
// approved.
function gateActionsFor(status: string) {
  switch (status) {
    case 'proposed':
      return {
        canReject: true,
        canEdit: true,
        canApprove: true,
        canDraft: false
      }
    case 'approved':
      return {
        canReject: true,
        canEdit: true,
        canApprove: false,
        canDraft: true
      }
    case 'rejected':
      return {
        canReject: false,
        canEdit: true,
        canApprove: true,
        canDraft: false
      }
    default:
      return {
        canReject: false,
        canEdit: false,
        canApprove: false,
        canDraft: false
      }
  }
}

const STATUS_STYLE: Record<string, string> = {
  proposed: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  approved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  rejected: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  drafting: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  drafted: 'bg-accent/10 text-accent'
}

/** Matches the Idea Review & Approval tab names. */
export const IDEA_STATUS_LABEL: Record<string, string> = {
  proposed: 'To review',
  approved: 'Approved',
  rejected: 'Rejected',
  drafting: 'Drafting…',
  drafted: 'Drafted'
}

/** Below this grounding score the card warns that the idea is thinly sourced. */
const WEAK_GROUNDING = 60

function isWebUrl(url?: string): url is string {
  return !!url && /^https?:\/\//i.test(url)
}

/**
 * The idea card shown on the Idea Review & Approval and on a run's detail page,
 * so the same idea looks and behaves the same in both places. The face shows
 * only what a quick approve/reject needs; clicking it opens the rest.
 */
export function RunIdeaCard({
  idea,
  onApprove,
  onReject,
  onEditSave,
  onDraft,
  isBusy,
  locked = false,
  showStatus = true
}: RunIdeaCardProps) {
  const actionsDisabled = isBusy || locked
  const lockedTitle = locked ? INACTIVE_ACCOUNT_MESSAGE : undefined
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [editHook, setEditHook] = useState(idea.hookConcept || '')
  const [editAngle, setEditAngle] = useState(idea.angle || '')
  const [showDetails, setShowDetails] = useState(false)
  const { canReject, canEdit, canApprove, canDraft } = gateActionsFor(
    idea.status
  )
  const showDraft = canDraft && !!onDraft
  // The face is the title plus what the idea is for, shown in full;
  // everything else sits behind Details. Rejected and drafted ideas are done,
  // so they're muted.
  const isOpen = idea.status === 'proposed' || idea.status === 'approved'
  const angleIsTitle = !idea.title && !!idea.angle
  const title = idea.title || idea.angle || 'Untitled idea'
  // The reader takeaway says what the post leaves the reader with, and is
  // usually two or three lines, so it fits without cutting off. Ideas without
  // one fall back to the angle, then the thesis.
  const summaryField = idea.audienceTakeaway
    ? 'audienceTakeaway'
    : idea.angle && !angleIsTitle
      ? 'angle'
      : idea.thesis
        ? 'thesis'
        : null
  const summary = summaryField ? idea[summaryField] : null
  // Detail rows that aren't already the heading or the summary.
  const detailAngle =
    !angleIsTitle && summaryField !== 'angle' ? idea.angle : null
  const detailThesis = summaryField !== 'thesis' ? idea.thesis : null
  const detailTakeaway =
    summaryField !== 'audienceTakeaway' ? idea.audienceTakeaway : null
  const showViewPost = idea.status === 'drafted'
  const collapsed = mode === 'view' && !showDetails

  const evidence = Array.isArray(idea.supportingEvidence)
    ? (idea.supportingEvidence as EvidenceItem[]).filter(e => e?.claim)
    : []
  const risks = (idea.risks || []).filter(Boolean)
  const grounding =
    typeof idea.groundingScore === 'number' ? idea.groundingScore : null
  const weakSources = isOpen && grounding !== null && grounding < WEAK_GROUNDING
  const scores = [
    grounding !== null && `Sources ${grounding}%`,
    typeof idea.score === 'number' && `Strength ${idea.score}/100`,
    typeof idea.originalityScore === 'number' &&
      `Originality ${idea.originalityScore}/100`
  ].filter(Boolean)

  const hasDetails =
    !!idea.hookConcept ||
    !!idea.whyNow ||
    risks.length > 0 ||
    !!idea.coreArgument ||
    !!detailAngle ||
    !!detailThesis ||
    !!detailTakeaway ||
    !!idea.noveltyNote ||
    evidence.length > 0 ||
    scores.length > 0 ||
    canEdit

  const handleSaveEdit = async () => {
    const saved = await onEditSave(idea.id, {
      hookConcept: editHook,
      angle: editAngle
    })
    if (saved !== false) setMode('view')
  }

  const handleCancelEdit = () => {
    setEditHook(idea.hookConcept || '')
    setEditAngle(idea.angle || '')
    setMode('view')
  }

  return (
    // A collapsed card has one fixed size (room for a two-line title and a
    // three-line summary) so every tab lines up; opening Details or the editor
    // lets just that card grow.
    <article
      className={cn(
        'border-border bg-surface hover:border-foreground/15 flex min-w-0 flex-col rounded-2xl border p-5 shadow-xs transition-colors',
        collapsed ? 'h-64' : 'min-h-64'
      )}
    >
      {(idea.pillar || weakSources || showStatus) && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          {idea.pillar && (
            <span className="text-muted truncate">{idea.pillar}</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {weakSources && (
              <span
                title={`Only ${grounding}% of this idea is backed by your knowledge base and research`}
                className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 font-semibold text-rose-700 dark:text-rose-400"
              >
                <AlertTriangle className="h-3 w-3" />
                Weak sources
              </span>
            )}
            {showStatus && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 font-semibold',
                  STATUS_STYLE[idea.status] || 'bg-surface-hover text-muted'
                )}
              >
                {IDEA_STATUS_LABEL[idea.status] || idea.status}
              </span>
            )}
          </span>
        </div>
      )}

      {mode === 'edit' ? (
        <>
          <h3 className="text-foreground text-base leading-snug font-semibold text-balance">
            {title}
          </h3>
          <div className="mt-4 space-y-3">
            <div>
              <label
                htmlFor={`hook-${idea.id}`}
                className="text-foreground mb-1.5 block text-xs font-semibold"
              >
                Hook
              </label>
              <textarea
                id={`hook-${idea.id}`}
                rows={3}
                value={editHook}
                onChange={e => setEditHook(e.target.value)}
                autoFocus
                className="border-border bg-surface-hover text-foreground focus:border-accent w-full resize-y rounded-lg border p-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label
                htmlFor={`angle-${idea.id}`}
                className="text-foreground mb-1.5 block text-xs font-semibold"
              >
                Angle
                <span className="text-muted ml-1.5 font-normal">
                  One line on the position the post takes
                </span>
              </label>
              <input
                id={`angle-${idea.id}`}
                type="text"
                value={editAngle}
                onChange={e => setEditAngle(e.target.value)}
                className="border-border bg-surface-hover text-foreground focus:border-accent w-full rounded-lg border p-2.5 text-sm outline-none"
              />
            </div>
            <div className="border-border flex items-center justify-end gap-2 border-t pt-3">
              <button
                type="button"
                disabled={isBusy}
                onClick={handleCancelEdit}
                className="text-muted hover:text-foreground h-7 rounded-lg px-2.5 text-xs font-medium transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                title={lockedTitle}
                onClick={handleSaveEdit}
                className="bg-accent text-background hover:bg-accent-hover inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60"
              >
                {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save changes
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <h3
            className={cn(
              'text-base leading-snug font-semibold text-balance',
              isOpen ? 'text-foreground' : 'text-foreground/70',
              collapsed && 'line-clamp-2'
            )}
          >
            {title}
          </h3>
          {summary && (
            <p
              className={cn(
                'text-muted mt-1.5 text-sm leading-relaxed',
                collapsed && 'line-clamp-3'
              )}
            >
              {summary}
            </p>
          )}

          {showDetails && (
            <div className="border-border mt-4 space-y-3 border-t pt-4 text-sm">
              {detailAngle && (
                <DetailRow label="Angle">{detailAngle}</DetailRow>
              )}
              {detailThesis && (
                <DetailRow label="Main point">{detailThesis}</DetailRow>
              )}
              {idea.hookConcept && (
                <div>
                  <p className="text-muted mb-1 text-xs font-semibold">Hook</p>
                  <blockquote className="border-accent/40 text-foreground border-l-2 pl-3 leading-relaxed">
                    “{idea.hookConcept}”
                  </blockquote>
                </div>
              )}
              {idea.whyNow && (
                <DetailRow label="Why now">
                  <Flame className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-amber-500" />
                  {idea.whyNow}
                </DetailRow>
              )}
              {risks.length > 0 && <RiskList risks={risks} />}
              {idea.coreArgument && (
                <DetailRow label="Argument">{idea.coreArgument}</DetailRow>
              )}
              {detailTakeaway && (
                <DetailRow label="Reader takeaway">{detailTakeaway}</DetailRow>
              )}
              {idea.noveltyNote && (
                <DetailRow label="Why it's not generic">
                  {idea.noveltyNote}
                </DetailRow>
              )}

              {evidence.length > 0 && (
                <div>
                  <p className="text-muted mb-1.5 text-xs font-semibold">
                    Evidence ({evidence.length})
                  </p>
                  <ul className="space-y-1.5">
                    {evidence.map((ev, idx) => (
                      <li
                        key={idx}
                        className="bg-surface-hover rounded-lg px-3 py-2 text-xs leading-relaxed"
                      >
                        <span className="text-foreground">{ev.claim}</span>
                        {(ev.sourceTitle || isWebUrl(ev.sourceUrl)) && (
                          <span className="text-muted mt-1 flex items-center gap-1">
                            {isWebUrl(ev.sourceUrl) ? (
                              <a
                                href={ev.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent inline-flex items-center gap-1 hover:underline"
                              >
                                {ev.sourceTitle || 'Source'}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              ev.sourceTitle
                            )}
                            {ev.factType === 'inferred' && (
                              <span>· inferred</span>
                            )}
                            {ev.factType === 'sourced' && (
                              <span>· from the web</span>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(scores.length > 0 || canEdit) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {scores.length > 0 && (
                    <p className="text-muted text-xs tabular-nums">
                      {scores.join(' · ')}
                    </p>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      title={lockedTitle}
                      onClick={() => setMode('edit')}
                      className="border-border text-foreground hover:bg-surface-hover ml-auto inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-60"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit hook &amp; angle
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {(hasDetails ||
            canReject ||
            canApprove ||
            showDraft ||
            showViewPost) && (
            // mt-auto pins the actions to the bottom edge of the fixed-height card.
            <div className="mt-auto pt-4">
              <div className="border-border flex items-center gap-2 border-t pt-3">
                {hasDetails && (
                  <button
                    type="button"
                    aria-expanded={showDetails}
                    onClick={() => setShowDetails(v => !v)}
                    className="text-muted hover:text-foreground hover:bg-surface-hover -ml-2 inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors"
                  >
                    {showDetails ? 'Hide details' : 'Details'}
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 transition-transform',
                        showDetails && 'rotate-180'
                      )}
                    />
                  </button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  {canReject && (
                    <ConfirmPopover
                      title="Reject this idea?"
                      description="It moves to Rejected. You can approve it again later."
                      confirmLabel="Reject"
                      tone="danger"
                      onConfirm={() => onReject(idea.id)}
                      disabled={actionsDisabled}
                    >
                      <button
                        type="button"
                        disabled={actionsDisabled}
                        title={lockedTitle}
                        className="text-muted inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-60 dark:hover:text-rose-400"
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </ConfirmPopover>
                  )}
                  {/* Approving is reversible, so it takes one click. */}
                  {canApprove && (
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      title={lockedTitle}
                      onClick={() => onApprove(idea.id)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60',
                        // A rejected idea is rarely brought back, so it stays quiet.
                        idea.status === 'rejected'
                          ? 'border-border text-foreground hover:bg-surface-hover border'
                          : 'bg-emerald-700 text-white hover:bg-emerald-800'
                      )}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Approve
                    </button>
                  )}
                  {showDraft && (
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      title={lockedTitle}
                      onClick={() => onDraft?.(idea.id)}
                      className="bg-accent text-background hover:bg-accent-hover inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      Create post
                    </button>
                  )}
                  {showViewPost && (
                    <Link
                      href="/posts"
                      className="text-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
                    >
                      View in Posts
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  )
}

function DetailRow({
  label,
  children
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <p className="text-muted mb-0.5 text-xs font-semibold">{label}</p>
      <p className="text-foreground/85 leading-relaxed">{children}</p>
    </div>
  )
}

function RiskList({ risks }: { risks: string[] }) {
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs">
      <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Check before approving
      </p>
      <ul className="text-foreground/80 list-disc space-y-0.5 pl-5 leading-relaxed">
        {risks.map((risk, idx) => (
          <li key={idx}>{risk}</li>
        ))}
      </ul>
    </div>
  )
}
