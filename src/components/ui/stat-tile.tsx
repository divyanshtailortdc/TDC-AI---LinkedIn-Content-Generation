import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { TONES, type Tone } from './tone'

type StatTileProps = {
  label: ReactNode
  value: ReactNode
  /** One short line under the value. */
  hint?: ReactNode
  icon?: LucideIcon
  /** Tints the icon well; neutral by default. */
  tone?: Tone
  /** Something under the hint, such as a ProgressBar. */
  children?: ReactNode
  /** The tile is a link (e.g. to the list it counts). */
  href?: string
  /** The tile is a toggle (e.g. a filter); `active` says it is on. */
  onClick?: () => void
  active?: boolean
  className?: string
}

/**
 * A headline number: label, value, hint. On its own it is just a fact; with
 * href or onClick the whole tile is the control, with a visible focus ring.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  children,
  href,
  onClick,
  active = false,
  className
}: StatTileProps) {
  const t = TONES[tone]
  const interactive = Boolean(href || onClick)
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted text-[11px] font-semibold tracking-wider uppercase">
          {label}
        </p>
        {Icon && (
          <span
            aria-hidden
            className={cn(
              'hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:flex',
              t.soft,
              tone === 'neutral' ? 'text-muted' : t.text
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <p className="text-foreground mt-1 text-xl leading-tight font-bold tracking-tight tabular-nums sm:-mt-1 sm:text-2xl">
        {value}
      </p>
      {hint && <p className="text-muted mt-0.5 text-xs leading-snug">{hint}</p>}
      {children && <div className="mt-2.5">{children}</div>}
    </>
  )
  const classes = cn(
    'border-border bg-surface flex min-w-0 flex-col rounded-2xl border p-3 text-left shadow-xs sm:p-4',
    interactive &&
      'hover:border-foreground/20 focus-visible:ring-foreground/30 cursor-pointer transition-colors focus-visible:ring-2 focus-visible:outline-none',
    active && cn('ring-1', t.border, t.ring),
    className
  )
  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={classes}>
        {body}
      </button>
    )
  }
  return <div className={classes}>{body}</div>
}
