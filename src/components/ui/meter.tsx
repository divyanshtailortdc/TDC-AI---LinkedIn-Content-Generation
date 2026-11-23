import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'
import { TONES, type Tone } from './tone'

/**
 * How far along something is, as a thin bar. `indeterminate` when it is
 * moving but there is no honest number for how far (no made-up percentages).
 */
export function ProgressBar({
  value = 0,
  max = 100,
  tone = 'brand',
  label,
  indeterminate = false,
  size = 'sm',
  className
}: {
  value?: number
  max?: number
  tone?: Tone
  /** What the bar measures, for screen readers. */
  label: string
  indeterminate?: boolean
  size?: 'xs' | 'sm' | 'md'
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      className={cn(
        'bg-surface-hover relative w-full overflow-hidden rounded-full',
        size === 'xs' && 'h-1',
        size === 'sm' && 'h-1.5',
        size === 'md' && 'h-2.5',
        className
      )}
    >
      {indeterminate ? (
        <span
          className={cn(
            'absolute inset-y-0 left-0 w-1/3 animate-[meter-slide_1.4s_ease-in-out_infinite] rounded-full motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40',
            TONES[tone].bar
          )}
        />
      ) : (
        <span
          className={cn(
            'block h-full rounded-full transition-[width] duration-500',
            TONES[tone].bar
          )}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  )
}

export type BarSegment = {
  key: string
  label: ReactNode
  value: number
  tone: Tone
}

/**
 * Parts of a whole as one bar, with a legend that carries the numbers (the
 * bar alone is never the only way to read them). Segments of 0 are left out
 * of the bar but kept in the legend when `showZero`.
 */
export function StackedBar({
  segments,
  label,
  showLegend = true,
  showZero = false,
  className
}: {
  segments: BarSegment[]
  /** What the bar shows, for screen readers. */
  label: string
  showLegend?: boolean
  showZero?: boolean
  className?: string
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  const shown = segments.filter(s => s.value > 0)
  return (
    <div className={cn('space-y-2.5', className)}>
      <div
        role="img"
        aria-label={`${label}: ${segments
          .filter(s => s.value > 0 || showZero)
          .map(s => `${typeof s.label === 'string' ? s.label : s.key} ${s.value}`)
          .join(', ')}`}
        className="bg-surface-hover flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
      >
        {total > 0 &&
          shown.map(s => (
            <span
              key={s.key}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', TONES[s.tone].bar)}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ))}
      </div>
      {showLegend && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {segments
            .filter(s => showZero || s.value > 0)
            .map(s => (
              <li key={s.key} className="text-muted inline-flex items-center gap-1.5">
                <span aria-hidden className={cn('h-2 w-2 rounded-full', TONES[s.tone].dot)} />
                {s.label}
                <span className="text-foreground font-semibold tabular-nums">{s.value}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
