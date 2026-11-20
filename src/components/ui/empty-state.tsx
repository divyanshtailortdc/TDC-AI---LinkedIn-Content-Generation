import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { TONES, type Tone } from './tone'

/**
 * What a list says when it has nothing to show: why, and the one thing to do
 * about it. `compact` for a panel or sidebar, the default for a page.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = 'neutral',
  compact = false,
  bordered = true,
  className
}: {
  icon: LucideIcon
  title: ReactNode
  description?: ReactNode
  /** A button or link, or several. */
  action?: ReactNode
  tone?: Tone
  compact?: boolean
  /** A dashed outline around it; off inside a card that already has one. */
  bordered?: boolean
  className?: string
}) {
  const t = TONES[tone]
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        bordered && 'border-border bg-surface rounded-2xl border-2 border-dashed',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex items-center justify-center rounded-2xl',
          compact ? 'mb-3 h-10 w-10' : 'mb-4 h-12 w-12',
          tone === 'neutral' ? 'bg-surface-hover text-muted' : cn(t.soft, t.text)
        )}
      >
        <Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
      </span>
      <p className="text-foreground text-sm font-semibold">{title}</p>
      {description && (
        <p className="text-muted mx-auto mt-1 max-w-md text-xs leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      )}
    </div>
  )
}
