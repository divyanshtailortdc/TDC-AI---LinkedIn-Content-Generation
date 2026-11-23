import { cn } from '@/lib/cn'
import { Loader2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { TONES, type Tone } from './tone'

/**
 * A status as a small pill: a dot (or icon, or spinner while something is
 * moving) and a word or two. The same pill on every page; see tone.ts for
 * which tone means what.
 */
export function StatusChip({
  tone,
  children,
  icon: Icon,
  spinning = false,
  pulse = false,
  size = 'sm',
  title,
  className
}: {
  tone: Tone
  children: ReactNode
  /** Shown instead of the dot. */
  icon?: LucideIcon
  /** A spinner instead of the dot: the thing is in progress right now. */
  spinning?: boolean
  /** The dot pulses: live or updating. */
  pulse?: boolean
  size?: 'xs' | 'sm' | 'md'
  title?: string
  className?: string
}) {
  const t = TONES[tone]
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap',
        size === 'xs' && 'px-2 py-px text-[10px]',
        size === 'sm' && 'px-2.5 py-0.5 text-[11px]',
        size === 'md' && 'px-3 py-1 text-xs',
        t.chip,
        className
      )}
    >
      {spinning ? (
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
      ) : Icon ? (
        <Icon aria-hidden className="h-3 w-3" />
      ) : (
        <span aria-hidden className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span
              className={cn(
                'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none',
                t.dot
              )}
            />
          )}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', t.dot)} />
        </span>
      )}
      {children}
    </span>
  )
}

/** A dot in a tone, for legends and compact lists. */
export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', TONES[tone].dot, className)}
    />
  )
}
