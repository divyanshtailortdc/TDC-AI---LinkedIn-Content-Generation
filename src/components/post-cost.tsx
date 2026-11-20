import { cn } from '@/lib/cn'
import { formatPostCost, formatTokens, type PostUsage } from '@/lib/post-usage'
import { Coins } from 'lucide-react'

/**
 * What a post cost in AI (src/lib/post-usage.ts): writing it, its image,
 * slides or video, and every rewrite since. Research and ideation serve the
 * whole run, so they are not counted here.
 */

/** "$0.0734 · 18.2k tokens", for a post's card or row; nothing when none was recorded. */
export function PostCostChip({
  usage,
  className
}: {
  usage: PostUsage | null | undefined
  className?: string
}) {
  if (!usage) return null
  return (
    <span
      className={cn(
        'text-muted inline-flex items-center gap-1 text-xs tabular-nums',
        className
      )}
      title={`AI cost for this post: ${formatPostCost(usage.costUsd)}${usage.estimated ? ' (partly estimated)' : ''}, ${usage.totalTokens.toLocaleString('en-US')} tokens over ${usage.calls} call${usage.calls === 1 ? '' : 's'}`}
    >
      <Coins aria-hidden className="h-3 w-3" />
      {formatPostCost(usage.costUsd)}
      <span aria-hidden>·</span>
      {formatTokens(usage.totalTokens)} tokens
    </span>
  )
}

/** The post page's breakdown: totals, then each kind of work. */
export function PostCostCard({
  usage
}: {
  usage: PostUsage | null | undefined
}) {
  return (
    // relative: the table's screen-reader header is absolutely positioned;
    // without a positioned ancestor it hangs below the column's own scroll
    // area and makes the whole page scroll into blank space.
    <section className="border-border bg-surface relative rounded-2xl border p-4 shadow-xs">
      <h3 className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
        <Coins aria-hidden className="text-accent h-3.5 w-3.5" />
        AI cost for this post
      </h3>
      {!usage ? (
        <p className="text-muted mt-2 text-xs leading-relaxed">
          No AI usage recorded for this post. Posts written before per-post
          costs were tracked show none.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Cost" value={formatPostCost(usage.costUsd)} />
            <Stat
              label="Tokens"
              value={usage.totalTokens.toLocaleString('en-US')}
            />
            <Stat label="Calls" value={String(usage.calls)} />
          </dl>
          <p className="text-muted mt-2 text-[11px]">
            {usage.inputTokens.toLocaleString('en-US')} in ·{' '}
            {usage.outputTokens.toLocaleString('en-US')} out
            {usage.estimated ? ' · some costs are estimates' : ''}
          </p>
          <table className="mt-3 w-full text-xs">
            <thead className="sr-only">
              <tr>
                <th>Work</th>
                <th>Tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {usage.stages.map(stage => (
                <tr key={stage.stage}>
                  <td className="text-foreground py-1.5">
                    {stage.label}
                    {stage.calls > 1 && (
                      <span className="text-muted"> ×{stage.calls}</span>
                    )}
                  </td>
                  <td className="text-muted py-1.5 text-right tabular-nums">
                    {stage.totalTokens > 0
                      ? `${formatTokens(stage.totalTokens)} tokens`
                      : '—'}
                  </td>
                  <td className="text-foreground w-20 py-1.5 text-right tabular-nums">
                    {formatPostCost(stage.costUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted mt-2 text-[11px] leading-relaxed">
            Writing, revising, images, slides and video for this post, including
            rewrites. The run&apos;s research and ideas are shared by its posts
            and not included.
          </p>
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-hover rounded-lg px-2.5 py-2">
      <dt className="text-muted text-[10px] font-medium uppercase">{label}</dt>
      <dd className="text-foreground mt-0.5 text-sm font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  )
}
