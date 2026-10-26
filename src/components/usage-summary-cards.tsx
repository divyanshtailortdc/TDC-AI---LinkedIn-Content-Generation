import type { AccountUsageSummary } from '@/lib/run-spend'
import { Coins, Database, Gauge, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const STAGE_LABELS: Record<string, string> = {
  generating_ideas: 'Ideation',
  drafting: 'Drafting'
}

function formatUsd(value: number): string {
  if (value === 0) return '$0.00'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 10_000) return `${Math.round(value / 1_000).toLocaleString()}K`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(Math.round(value))
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function UsageSummaryCards({
  totals,
  byStage,
  runs,
  ideas,
  posts
}: AccountUsageSummary) {
  const costPerPost = posts > 0 && totals.costUsd > 0 ? totals.costUsd / posts : null
  const cacheRate =
    totals.inputTokens > 0 ? totals.cacheReadTokens / totals.inputTokens : 0

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Token usage</h2>
        <p className="text-xs text-muted tabular-nums">
          {runs} run{runs === 1 ? '' : 's'} · {ideas} idea{ideas === 1 ? '' : 's'} · {posts}{' '}
          post{posts === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UsageCard
          icon={Coins}
          label="Total cost"
          value={formatUsd(totals.costUsd)}
          hint={
            costPerPost === null
              ? posts === 0
                ? 'No posts drafted yet'
                : 'No cost recorded'
              : `${formatUsd(costPerPost)} per post`
          }
          emphasis
        />
        <UsageCard
          icon={Sparkles}
          label="Total tokens"
          value={formatTokens(totals.totalTokens)}
          hint={`${totals.totalTokens.toLocaleString()} across ${runs} run${runs === 1 ? '' : 's'}`}
        />
        <UsageCard
          icon={Gauge}
          label="Input / Output"
          value={`${formatTokens(totals.inputTokens)} / ${formatTokens(totals.outputTokens)}`}
          hint={`${totals.outputTokens.toLocaleString()} tokens written`}
        />
        <UsageCard
          icon={Database}
          label="Cached input"
          value={formatTokens(totals.cacheReadTokens)}
          hint={
            totals.inputTokens > 0
              ? `${formatPercent(cacheRate)} of input read from cache`
              : 'No input recorded'
          }
        />
      </div>

      {byStage.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-3">
          <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
            By stage
          </span>
          {byStage.map(({ stage, totalTokens, costUsd }) => (
            <span key={stage} className="text-xs text-muted tabular-nums">
              <span className="font-medium text-foreground">
                {STAGE_LABELS[stage] ?? stage}
              </span>{' '}
              {formatTokens(totalTokens)} · {formatUsd(costUsd)}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

/** Holds the cards' place while the totals load, so the page does not jump. */
export function UsageSummarySkeleton() {
  return (
    <section role="status" aria-label="Loading token usage">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Token usage</h2>
        <div className="h-3 w-40 animate-pulse rounded bg-surface-hover" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-xs"
          >
            <div className="h-3 w-20 animate-pulse rounded bg-surface-hover" />
            <div className="h-6 w-24 animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-28 animate-pulse rounded bg-surface-hover" />
          </div>
        ))}
      </div>
    </section>
  )
}

function UsageCard({
  icon: Icon,
  label,
  value,
  hint,
  emphasis
}: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
  emphasis?: boolean
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-xs transition-colors hover:border-foreground/15">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-hover text-muted">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="text-[10px] font-semibold tracking-wider text-muted uppercase">{label}</p>
      </div>
      <p
        className={`mt-2.5 tabular-nums text-foreground ${
          emphasis ? 'text-2xl font-bold tracking-tight' : 'text-xl font-semibold tracking-tight'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted">{hint}</p>}
    </div>
  )
}
