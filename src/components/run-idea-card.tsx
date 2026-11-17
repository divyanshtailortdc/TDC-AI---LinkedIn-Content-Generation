'use client'

import { ConfirmPopover } from '@/components/confirm-popover'
import { cn } from '@/lib/cn'
import { FormatChips } from '@/components/format-chips'
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
  Target,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import {
  DIMENSION_LABELS,
  hasWeakSources,
  type IdeaScorecard
} from '@/lib/idea-scorecard'
import { rateSource, type SourceRating } from '@/lib/research/source-credibility'

interface EvidenceItem {
  claim?: string
  sourceTitle?: string
  sourceUrl?: string
  factType?: string
  credibility?: SourceRating
  publisher?: string
  kind?: string
}

/** What a trend-scan source was for, as the evidence list says it. */
const KIND_LABEL: Record<string, string> = {
  news: 'in the news',
  trend: 'trend',
  conversation: 'what people say'
}

/** At or above this trend relevance the card face says the idea is on trend. */
const ON_TREND = 75

export interface RunIdeaCardData {
  id: string
  title: string | null
  angle: string | null
  perspectiveAngle?: string | null
  /** Every goal the idea serves, its main goal first (see ideaGoalTitles). */
  goalTitles?: string[] | null
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
  /** How well it achieves its goal, and why (the goal review). */
  goalFitScore?: number | null
  goalFitNote?: string | null
  /** The formats ideation judged it suits, when its run offered several. */
  formatFit?: string[] | null
  /** Every other score with its reason (src/lib/idea-scorecard); null for older ideas. */
  scorecard?: IdeaScorecard | null
  /** Claims dropped for lack of a source. */
  unsupportedClaims?: string[] | null
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
  /** Hide the status badge where the surrounding list already filters by it. */
  showStatus?: boolean
  /** Ticked for "Create posts"; with onSelectChange, the card shows a checkbox. */
  selected?: boolean
  onSelectChange?: (id: string, selected: boolean) => void
}

/** Only ideas still at the gate can be picked for posts. */
export function isSelectableIdea(status: string) {
  return status === 'proposed' || status === 'approved'
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
  showStatus = true,
  selected = false,
  onSelectChange
}: RunIdeaCardProps) {
  const actionsDisabled = isBusy
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
  const showCheckbox = !!onSelectChange && isSelectableIdea(idea.status)
  const goals = idea.goalTitles ?? []

  const evidence = Array.isArray(idea.supportingEvidence)
    ? (idea.supportingEvidence as EvidenceItem[]).filter(e => e?.claim)
    : []
  const risks = (idea.risks || []).filter(Boolean)
  // Only an idea whose facts rest on weak sources is warned about; one that
  // states no facts needs no sources (src/lib/idea-scorecard).
  const weakSources = isOpen && hasWeakSources(idea)
  const sourcesReason = idea.scorecard?.sources?.reason
  const trend = idea.scorecard?.trendRelevance
  const onTrend = isOpen && !!trend && trend.score >= ON_TREND
  const scoreRows = scoreRowsFor(idea, evidence.length)

  const hasDetails =
    !!idea.hookConcept ||
    !!idea.whyNow ||
    risks.length > 0 ||
    !!idea.coreArgument ||
    !!detailAngle ||
    !!detailThesis ||
    !!detailTakeaway ||
    !!idea.noveltyNote ||
    !!idea.goalFitNote ||
    evidence.length > 0 ||
    scoreRows.length > 0 ||
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
        'bg-surface flex min-w-0 flex-col rounded-2xl border p-5 shadow-xs transition-colors',
        selected && showCheckbox
          ? 'border-brand/60 ring-brand/20 ring-2'
          : 'border-border hover:border-foreground/15',
        collapsed ? 'h-64' : 'min-h-64'
      )}
    >
      {(showCheckbox || goals.length > 0 || weakSources || onTrend || showStatus) && (
        <div className="mb-2 flex min-w-0 items-center gap-2 text-xs">
          {showCheckbox && (
            <input
              type="checkbox"
              checked={selected}
              onChange={e => onSelectChange?.(idea.id, e.target.checked)}
              aria-label={`Select "${title}" for posts`}
              className="accent-accent h-4 w-4 shrink-0 cursor-pointer"
            />
          )}
          {goals.length > 0 && (
            // The main goal first, then any other goal the idea also moves.
            <span
              title={
                goals.length === 1
                  ? `Goal: ${goals[0]}`
                  : `Goals: ${goals[0]} (main), ${goals.slice(1).join(', ')}`
              }
              className="text-muted flex min-w-0 items-center gap-1"
            >
              <Target className="h-3 w-3 shrink-0" />
              {goals.map((goal, i) => (
                <span
                  key={goal}
                  className={cn(
                    'min-w-0 truncate',
                    i === 0 && goals.length > 1 && 'text-foreground/80 font-medium'
                  )}
                >
                  {i > 0 && '+ '}
                  {goal}
                </span>
              ))}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {onTrend && !weakSources && (
              <span
                title={trend!.reason}
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-amber-700 dark:text-amber-400"
              >
                <Flame className="h-3 w-3" />
                On trend
              </span>
            )}
            {weakSources && (
              <span
                title={
                  sourcesReason ??
                  'Some of the facts this idea states could not be backed by your knowledge base or research'
                }
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
          {(idea.formatFit?.length ?? 0) > 0 && (
            <div className="mt-2">
              <FormatChips formats={idea.formatFit} />
            </div>
          )}

          {showDetails && (
            <div className="border-border mt-4 space-y-3 border-t pt-4 text-sm">
              {goals.length > 1 && (
                <DetailRow label="Goals">
                  {goals[0]} (main goal; sets the call to action), also{' '}
                  {goals.slice(1).join(', ')}
                </DetailRow>
              )}
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
              {scoreRows.length > 0 && <ScoreList rows={scoreRows} />}

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
                          <span className="text-muted mt-1 flex flex-wrap items-center gap-x-1">
                            {isWebUrl(ev.sourceUrl) ? (
                              <a
                                href={ev.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent inline-flex min-w-0 items-center gap-1 hover:underline"
                              >
                                <span className="min-w-0 truncate">
                                  {ev.sourceTitle || ev.publisher || 'Source'}
                                </span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            ) : (
                              ev.sourceTitle
                            )}
                            {ev.publisher && ev.sourceTitle && (
                              <span>· {ev.publisher}</span>
                            )}
                            {evidenceRating(ev) && (
                              <span title={evidenceRating(ev)!.note}>
                                · {evidenceRating(ev)!.label}
                              </span>
                            )}
                            {ev.kind && KIND_LABEL[ev.kind] && (
                              <span>· {KIND_LABEL[ev.kind]}</span>
                            )}
                            {ev.factType === 'inferred' && (
                              <span>· inferred</span>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canEdit && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={actionsDisabled}
                    onClick={() => setMode('edit')}
                    className="border-border text-foreground hover:bg-surface-hover inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-60"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit hook &amp; angle
                  </button>
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
              <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
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
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
                      onClick={() => onApprove(idea.id)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60',
                        // A rejected idea is rarely brought back, so it stays quiet.
                        idea.status === 'rejected'
                          ? 'border-border text-foreground hover:bg-surface-hover border'
                          : 'bg-accent text-background hover:bg-accent-hover'
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
                      onClick={() => onDraft?.(idea.id)}
                      aria-label="Generate Post"
                      className="bg-accent text-background hover:bg-accent-hover inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold transition-colors disabled:opacity-60"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {/* Narrow cards (phones, two columns) drop "Generate". */}
                      <span className="max-sm:hidden lg:max-xl:hidden">
                        Generate
                      </span>
                      Post
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

/**
 * How far an evidence item's source can be trusted, for the evidence list:
 * as the validator rated it, or, for ideas saved before ratings, from its
 * address. Nothing for the account's own material, which needs no label.
 */
function evidenceRating(ev: EvidenceItem): SourceRating | null {
  if (ev.credibility) {
    return ev.credibility.tier === 'own' || ev.credibility.tier === 'knowledge'
      ? null
      : ev.credibility
  }
  if (ev.factType !== 'sourced' || !isWebUrl(ev.sourceUrl)) return null
  return rateSource({ url: ev.sourceUrl, origin: 'web' })
}

type ScoreRow = {
  key: string
  label: string
  /** 0-100; null shows `value` in its place with no bar. */
  score: number | null
  value?: string
  reason?: string
  /** Trend relevance is not a verdict: an evergreen idea is not a weak one. */
  neutral?: boolean
}

/**
 * The scores to show, each with its reason: goal fit, the judged ones, and
 * source quality. Ideas saved before the scorecard show what they have.
 */
function scoreRowsFor(idea: RunIdeaCardData, evidenceCount: number): ScoreRow[] {
  const card = idea.scorecard
  const rows: ScoreRow[] = []
  if (typeof idea.goalFitScore === 'number') {
    rows.push({
      key: 'goalFit',
      label: DIMENSION_LABELS.goalFit,
      score: idea.goalFitScore,
      reason: idea.goalFitNote ?? undefined
    })
  }
  for (const key of ['engagement', 'originality', 'trendRelevance', 'brandFit'] as const) {
    const judged = card?.[key]
    if (judged) {
      rows.push({
        key,
        label: DIMENSION_LABELS[key],
        score: judged.score,
        reason: judged.reason,
        neutral: key === 'trendRelevance'
      })
    }
  }
  if (!card?.originality && typeof idea.originalityScore === 'number') {
    rows.push({ key: 'originality', label: DIMENSION_LABELS.originality, score: idea.originalityScore })
  }
  const sources = card?.sources
  if (sources) {
    rows.push({
      key: 'sources',
      label: DIMENSION_LABELS.sources,
      score: sources.score,
      value: sources.score === null ? 'Not needed' : undefined,
      reason: sources.reason
    })
  } else if (typeof idea.groundingScore === 'number') {
    // Older ideas: their grounding score counted the idea's own reasoning,
    // so one with no claims at all is shown as needing no sources.
    const claims = evidenceCount + (idea.unsupportedClaims?.length ?? 0)
    rows.push(
      claims === 0
        ? {
            key: 'sources',
            label: DIMENSION_LABELS.sources,
            score: null,
            value: 'Not needed',
            reason: 'It states no facts that need a source.'
          }
        : {
            key: 'sources',
            label: DIMENSION_LABELS.sources,
            score: idea.groundingScore,
            reason: `${claims} factual ${claims === 1 ? 'claim' : 'claims'}${
              idea.unsupportedClaims?.length
                ? `; ${idea.unsupportedClaims.length} could not be verified and ${idea.unsupportedClaims.length === 1 ? 'was' : 'were'} dropped`
                : ''
            }.`
          }
    )
  }
  return rows
}

function scoreTone(row: ScoreRow): { text: string; bar: string } {
  if (row.neutral || row.score === null) {
    return { text: 'text-foreground/80', bar: 'bg-foreground/30' }
  }
  if (row.score >= 75) {
    return { text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' }
  }
  if (row.score >= 55) {
    return { text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500' }
  }
  return { text: 'text-rose-700 dark:text-rose-400', bar: 'bg-rose-500' }
}

function ScoreList({ rows }: { rows: ScoreRow[] }) {
  return (
    <div>
      <p className="text-muted mb-1.5 text-xs font-semibold">How it scores</p>
      <ul className="space-y-2.5">
        {rows.map(row => {
          const tone = scoreTone(row)
          return (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-foreground font-medium">{row.label}</span>
                <span className={cn('font-semibold tabular-nums', tone.text)}>
                  {row.score === null ? row.value : row.score}
                </span>
              </div>
              {row.score !== null && (
                <div
                  className="bg-surface-hover mt-1 h-1 overflow-hidden rounded-full"
                  role="presentation"
                >
                  <div
                    className={cn('h-full rounded-full', tone.bar)}
                    style={{ width: `${row.score}%` }}
                  />
                </div>
              )}
              {row.reason && (
                <p className="text-muted mt-1 text-xs leading-relaxed">{row.reason}</p>
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-muted mt-2 text-[11px] leading-relaxed">
        Scores estimate potential; none can promise reach.
      </p>
    </div>
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
