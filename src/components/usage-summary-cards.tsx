import {
  AI_SPEND_SOURCE_LABELS,
  DAILY_LIMIT_WINDOW_HOURS,
  INBOX_SHARE_OF_USER_LIMITS,
  SPEND_LIMIT_WINDOW_DAYS
} from '@/lib/ai/spend-sources'
import type { AccountUsageSummary, SpendAgainstLimit } from '@/lib/run-spend'
import { Coins, Database, Gauge, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
  bySource,
  runs,
  ideas,
  posts,
  limits
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
          hint={`${totals.totalTokens.toLocaleString()} across ${totals.calls.toLocaleString()} AI call${totals.calls === 1 ? '' : 's'}`}
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

      {bySource.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-3">
          <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
            By feature
          </span>
          {bySource.map(({ source, totalTokens, costUsd }) => (
            <span key={source} className="text-xs text-muted tabular-nums">
              <span className="font-medium text-foreground">
                {AI_SPEND_SOURCE_LABELS[source]}
              </span>{' '}
              {formatTokens(totalTokens)} · {formatUsd(costUsd)}
            </span>
          ))}
        </div>
      )}

      <SpendLimits {...limits} />
    </section>
  )
}

type LimitState = 'ok' | 'near' | 'reached'

function limitState({ spentUsd, limitUsd }: SpendAgainstLimit, nearAt = 0.8): LimitState {
  if (spentUsd >= limitUsd) return 'reached'
  return limitUsd > 0 && spentUsd / limitUsd >= nearAt ? 'near' : 'ok'
}

const INBOX_SHARE = formatPercent(INBOX_SHARE_OF_USER_LIMITS)

/**
 * The spending limits (src/lib/ai/spend.ts): the owner's over 30 days and
 * 24 hours on every identity they own, and this identity's inbox's over 24
 * hours. Past the owner's, new model calls are refused; received email is
 * read without AI summaries past its inbox's limit or a share of the owner's.
 */
function SpendLimits({ window: month, day, inboxDay }: AccountUsageSummary['limits']) {
  const windowState = limitState(month)
  const dayState = limitState(day)
  // Received email stops using AI at a share of the owner's limits.
  const inboxHeldBack =
    limitState(month, INBOX_SHARE_OF_USER_LIMITS) !== 'ok' ||
    limitState(day, INBOX_SHARE_OF_USER_LIMITS) !== 'ok'
  const inboxState = limitState(inboxDay)

  const notes: Array<{ tone: 'red' | 'amber'; text: string }> = []
  if (windowState === 'reached' || dayState === 'reached') {
    notes.push({
      tone: 'red',
      text: `Limit reached: new AI work is refused until older spending leaves the ${
        windowState === 'reached' ? `${SPEND_LIMIT_WINDOW_DAYS} days` : `${DAILY_LIMIT_WINDOW_HOURS} hours`
      }.`
    })
  } else if (windowState === 'near' || dayState === 'near') {
    notes.push({
      tone: 'amber',
      text: 'Close to a limit: past it, new AI work is refused until older spending leaves its window.'
    })
  }
  if (inboxState === 'reached' || inboxHeldBack) {
    notes.push({
      tone: 'amber',
      text:
        inboxState === 'reached'
          ? "This inbox's daily AI limit is reached: received newsletters are still read, without AI summaries, until older spending leaves the 24 hours."
          : `Received newsletters are read without AI summaries once ${INBOX_SHARE} of a limit is used, so the rest is kept for work you start.`
    })
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-3">
      <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">
        Spending limits
      </span>
      <div className="mt-2 space-y-2.5">
        <LimitMeter
          label={`Last ${SPEND_LIMIT_WINDOW_DAYS} days, all your identities`}
          state={windowState}
          {...month}
        />
        <LimitMeter
          label={`Last ${DAILY_LIMIT_WINDOW_HOURS} hours, all your identities`}
          state={dayState}
          {...day}
        />
        <LimitMeter
          label={`This identity's inbox, last ${DAILY_LIMIT_WINDOW_HOURS} hours`}
          state={inboxState}
          {...inboxDay}
        />
      </div>
      {notes.map(note => (
        <p
          key={note.text}
          className={`mt-2 text-[11px] leading-snug ${
            note.tone === 'red'
              ? 'text-red-600 dark:text-red-400'
              : 'text-amber-700 dark:text-amber-400'
          }`}
        >
          {note.text}
        </p>
      ))}
    </div>
  )
}

function LimitMeter({
  label,
  spentUsd,
  limitUsd,
  state
}: SpendAgainstLimit & { label: string; state: LimitState }) {
  const share = limitUsd > 0 ? Math.min(1, spentUsd / limitUsd) : 1
  const bar = state === 'reached' ? 'bg-red-500' : state === 'near' ? 'bg-amber-500' : 'bg-accent'
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-xs text-muted tabular-nums">
          <span className="font-medium text-foreground">{formatUsd(spentUsd)}</span> of{' '}
          {formatUsd(limitUsd)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`AI spending: ${label}`}
        aria-valuemin={0}
        aria-valuemax={limitUsd}
        aria-valuenow={Math.min(spentUsd, limitUsd)}
        aria-valuetext={`${formatUsd(spentUsd)} of ${formatUsd(limitUsd)}`}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-hover"
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
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
