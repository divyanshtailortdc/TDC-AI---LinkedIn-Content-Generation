'use client'

import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'
import { TONES, type Tone } from './tone'

export type FilterChipOption<T extends string> = {
  value: T
  label: ReactNode
  /** How many items picking it would show; hidden when undefined. */
  count?: number
  /** A dot in this tone, and the chip's colour when picked. */
  tone?: Tone
}

/**
 * One row of toggle chips, one picked at a time (status, kind…). Each is a
 * button with aria-pressed, so Tab reaches every chip and Space/Enter picks
 * it; the group's label says what it filters. The row never wraps: on a
 * narrow screen it scrolls sideways.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className
}: {
  options: FilterChipOption<T>[]
  value: T
  onChange: (next: T) => void
  /** What the chips filter, for screen readers ("Show posts by status"). */
  label: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'border-border bg-surface flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border p-1',
        className
      )}
    >
      {options.map(option => {
        const active = option.value === value
        const tone = option.tone
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'focus-visible:ring-foreground/30 flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
              active
                ? tone
                  ? TONES[tone].chip
                  : 'border-foreground/20 bg-surface-hover text-foreground'
                : 'text-muted hover:text-foreground hover:bg-surface-hover/60 border-transparent'
            )}
          >
            {tone && (
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', TONES[tone].dot)} />
            )}
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  'text-[11px] tabular-nums',
                  active ? 'opacity-80' : 'text-muted'
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
