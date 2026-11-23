'use client'

import { addUsage, cacheHitRate, type CallUsage } from '@/lib/ai/usage'
import { InfoTip } from '@/components/ui/info-tip'
import { ChevronDown, Coins } from 'lucide-react'
import type { ReactNode } from 'react'
import { SectionCard } from '@/components/ui/section-card'
import { FOCUS_RING, TONES } from '@/components/ui/tone'
import { cn } from '@/lib/cn'

interface StepLike {
  stage: string
  responseJson?: unknown
}

interface RunCostPanelProps {
  steps: StepLike[]
  /** Posts drafted in this run, for cost per post. */
  draftCount: number
  /** Fallback for runs recorded before per-step usage existed. */
  legacyCostUsd?: string | number | null
}

const STAGE_LABELS: Record<string, string> = {
  generating_ideas: 'Ideation',
  drafting: 'Drafting',
  linting: 'Revision pass',
  media: 'Media (brief + image)'
}

const STAGE_ORDER = ['generating_ideas', 'drafting', 'linting', 'media']

function usageOf(responseJson: unknown): CallUsage | null {
  const usage = (responseJson as { usage?: CallUsage } | null | undefined)?.usage
  return usage && typeof usage === 'object' ? usage : null
}

function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(3)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${Math.round(value / 1_000)}K`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/**
 * An explanation kept out of the card: an Info button that shows it on hover,
 * and on a click, tap or keyboard press (InfoTip), so it is reachable without
 * a mouse.
 */
function InfoNote({ title }: { title: string }) {
  return (
    <InfoTip label="About this figure" className="align-middle">
      {title}
    </InfoTip>
  )
}

export function RunCostPanel({ steps, draftCount, legacyCostUsd }: RunCostPanelProps) {
  const byStage = new Map<string, CallUsage>()
  for (const step of steps) {
    const usage = usageOf(step.responseJson)
    if (!usage) continue
    byStage.set(step.stage, addUsage(byStage.get(step.stage), usage))
  }

  const rows = STAGE_ORDER.filter(stage => byStage.has(stage)).map(stage => ({
    stage,
    label: STAGE_LABELS[stage] || stage,
    usage: byStage.get(stage)!
  }))

  const total = addUsage(...rows.map(r => r.usage))
  const hasRecordedUsage = total.calls > 0
  const legacyCost = Number(legacyCostUsd || 0)

  if (!hasRecordedUsage) {
    return (
      <SectionCard title="Tokens & cost" icon={Coins}>
        <p className="text-muted inline-flex items-center gap-1.5 text-[13px] tabular-nums">
          {legacyCost > 0 ? (
            <>
              {formatUsd(legacyCost)} recorded
              <InfoNote
                title={`This run predates per-stage tracking. Its recorded total was ${formatUsd(legacyCost)}, estimated at full input price, so treat it as approximate.`}
              />
            </>
          ) : (
            'No model calls yet'
          )}
        </p>
      </SectionCard>
    )
  }

  const costPerPost = draftCount > 0 ? total.costUsd / draftCount : null
  const hitRate = cacheHitRate(total)
  const unpricedCalls = total.estimatedCalls
  const thinkingShare =
    total.outputTokens > 0 ? total.reasoningTokens / total.outputTokens : 0
  // Columns that are empty for the whole run only add noise.
  const showCached = total.cacheReadTokens > 0
  const showThinking = total.reasoningTokens > 0

  return (
    <SectionCard
      title="Tokens & cost"
      icon={Coins}
      description={
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {total.billedCalls} of {total.calls} calls billed
          {unpricedCalls > 0 && (
            <InfoNote
              title={`${unpricedCalls} call${unpricedCalls === 1 ? '' : 's'} came back without a billed amount. Text calls fall back to Anthropic list prices; images without one are counted but not priced, so the total may be slightly low.`}
            />
          )}
        </span>
      }
    >
      <div className="space-y-5">
        {/* Headline numbers */}
        <dl className="divide-border grid grid-cols-2 gap-y-4 lg:grid-cols-4 lg:divide-x">
          <Figure label="Total cost" value={formatUsd(total.costUsd)} />
          <Figure
            label="Cost per post"
            value={costPerPost === null ? '—' : formatUsd(costPerPost)}
            hint={costPerPost === null ? undefined : `${draftCount} post${draftCount === 1 ? '' : 's'}`}
          />
          <Figure
            label="Output tokens"
            value={formatTokens(total.outputTokens)}
            hint={
              total.reasoningTokens > 0
                ? `${formatPercent(thinkingShare)} thinking`
                : `${formatTokens(total.inputTokens)} input`
            }
          />
          <Figure
            label="Cache hit rate"
            value={formatPercent(hitRate)}
            hint={`${formatTokens(total.cacheReadTokens)} cached`}
          />
        </dl>

        {/* Per-stage breakdown, folded */}
        <details className="group border-border border-y">
          <summary
            className={cn(
              'text-foreground flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-3 text-[13px] font-medium [&::-webkit-details-marker]:hidden',
              FOCUS_RING
            )}
          >
            By stage
            <ChevronDown
              aria-hidden
              className="text-muted h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <div className="overflow-x-auto pb-3">
            <table className="w-full min-w-130 text-xs">
              <thead>
                <tr className="text-muted border-border border-b text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">Stage</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Calls</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Input</th>
                  {showCached && (
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Cached</th>
                  )}
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Output</th>
                  {showThinking && (
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Thinking</th>
                  )}
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Cost</th>
                  <th scope="col" className="py-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ stage, label, usage }) => {
                  const share = total.costUsd > 0 ? usage.costUsd / total.costUsd : 0
                  return (
                    <tr key={stage} className="border-border/60 border-b last:border-b-0">
                      <th
                        scope="row"
                        className="text-foreground py-2.5 pr-3 text-left font-medium"
                      >
                        {label}
                      </th>
                      <td className="text-muted py-2.5 pr-3 text-right tabular-nums">
                        {usage.calls}
                      </td>
                      <td className="text-muted py-2.5 pr-3 text-right tabular-nums">
                        {formatTokens(usage.inputTokens)}
                      </td>
                      {showCached && (
                        <td className="text-muted py-2.5 pr-3 text-right tabular-nums">
                          {usage.cacheReadTokens > 0 ? formatTokens(usage.cacheReadTokens) : '—'}
                        </td>
                      )}
                      <td className="text-muted py-2.5 pr-3 text-right tabular-nums">
                        {formatTokens(usage.outputTokens)}
                      </td>
                      {showThinking && (
                        <td className="text-muted py-2.5 pr-3 text-right tabular-nums">
                          {usage.reasoningTokens > 0 ? formatTokens(usage.reasoningTokens) : '—'}
                        </td>
                      )}
                      <td className="text-foreground py-2.5 pr-3 text-right font-semibold tabular-nums">
                        {formatUsd(usage.costUsd)}
                      </td>
                      <td className="w-32 py-2.5">
                        <div className="flex items-center gap-2">
                          <div
                            aria-hidden
                            className="bg-surface-hover h-1.5 flex-1 overflow-hidden rounded-full"
                          >
                            <div
                              className={cn('h-full rounded-full', TONES.brand.bar)}
                              style={{ width: `${Math.max(2, share * 100)}%` }}
                            />
                          </div>
                          <span className="text-muted w-9 text-right tabular-nums">
                            {formatPercent(share)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </SectionCard>
  )
}

/** One headline number, with no box of its own: the card is the box. */
function Figure({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 lg:px-5 lg:first:pl-0">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-foreground mt-0.5 text-xl font-semibold tracking-tight tabular-nums">
        {value}
      </dd>
      {hint && <dd className="text-muted text-xs tabular-nums">{hint}</dd>}
    </div>
  )
}
