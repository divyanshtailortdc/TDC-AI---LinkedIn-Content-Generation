'use client'

import { addUsage, cacheHitRate, type CallUsage } from '@/lib/ai/usage'
import { Coins, Info } from 'lucide-react'

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
      <div className="border-border bg-surface rounded-2xl border p-6 shadow-xs">
        <h2 className="text-foreground mb-2 flex items-center gap-2 text-sm font-semibold">
          <Coins className="h-4 w-4" />
          Tokens &amp; cost
        </h2>
        <p className="text-muted text-xs leading-relaxed">
          {legacyCost > 0
            ? `This run predates per-stage tracking. Its recorded total was ${formatUsd(legacyCost)}, estimated at full input price, so treat it as approximate.`
            : 'No model calls have been recorded for this run yet.'}
        </p>
      </div>
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
    <div className="border-border bg-surface space-y-5 rounded-2xl border p-6 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <Coins className="h-4 w-4" />
          Tokens &amp; cost
        </h2>
        <span className="text-muted text-[11px]">
          {total.billedCalls} of {total.calls} call{total.calls === 1 ? '' : 's'}{' '}
          priced from gateway billing
        </span>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total cost" value={formatUsd(total.costUsd)} emphasis />
        <Stat
          label="Cost per post"
          value={costPerPost === null ? '—' : formatUsd(costPerPost)}
          hint={
            costPerPost === null
              ? 'No posts drafted yet'
              : `${draftCount} post${draftCount === 1 ? '' : 's'}, ideation shared`
          }
        />
        <Stat
          label="Output tokens"
          value={formatTokens(total.outputTokens)}
          hint={
            total.reasoningTokens > 0
              ? `${formatPercent(thinkingShare)} of it thinking`
              : `${formatTokens(total.inputTokens)} input`
          }
        />
        <Stat
          label="Cache hit rate"
          value={formatPercent(hitRate)}
          hint={`${formatTokens(total.cacheReadTokens)} input read from cache`}
        />
      </div>

      {/* Per-stage breakdown */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="text-muted border-border border-b text-left text-[10px] tracking-wider uppercase">
              <th className="py-2 pr-3 font-semibold">Stage</th>
              <th className="py-2 pr-3 text-right font-semibold">Calls</th>
              <th className="py-2 pr-3 text-right font-semibold">Input</th>
              {showCached && <th className="py-2 pr-3 text-right font-semibold">Cached</th>}
              <th className="py-2 pr-3 text-right font-semibold">Output</th>
              {showThinking && (
                <th className="py-2 pr-3 text-right font-semibold">Thinking</th>
              )}
              <th className="py-2 pr-3 text-right font-semibold">Cost</th>
              <th className="py-2 font-semibold">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ stage, label, usage }) => {
              const share = total.costUsd > 0 ? usage.costUsd / total.costUsd : 0
              return (
                <tr key={stage} className="border-border/60 border-b last:border-b-0">
                  <td className="text-foreground py-2.5 pr-3 font-medium">{label}</td>
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
                      <div className="bg-surface-hover h-1.5 flex-1 overflow-hidden rounded-full">
                        <div
                          className="bg-accent h-full rounded-full"
                          style={{ width: `${Math.max(2, share * 100)}%` }}
                        />
                      </div>
                      <span className="text-muted w-8 text-right text-[10px] tabular-nums">
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

      {unpricedCalls > 0 && (
        <p className="text-muted flex items-start gap-1.5 text-[11px] leading-relaxed">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {unpricedCalls} call{unpricedCalls === 1 ? '' : 's'} came back without a
          billed amount. Text calls fall back to Anthropic list prices; images
          without one are counted but not priced, so the total may be slightly low.
        </p>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  emphasis
}: {
  label: string
  value: string
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div className="border-border bg-surface-hover/50 rounded-xl border p-3">
      <p className="text-muted text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </p>
      <p
        className={`mt-1 tabular-nums ${
          emphasis ? 'text-foreground text-xl font-bold' : 'text-foreground text-base font-semibold'
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-muted mt-0.5 text-[10px] leading-snug">{hint}</p>}
    </div>
  )
}
