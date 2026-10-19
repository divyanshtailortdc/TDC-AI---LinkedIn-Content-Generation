import { cn } from '@/lib/cn'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import type { ReactNode } from 'react'

const STYLES = {
  error: {
    icon: AlertCircle,
    className:
      'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
  },
  success: {
    icon: CheckCircle2,
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  info: {
    icon: Info,
    className: 'border-brand/30 bg-brand/10 text-brand-strong'
  }
} as const

/**
 * A message about the whole form: why it failed, or what happened. Errors
 * are announced at once (role="alert"); the others politely (role="status").
 */
export function FormAlert({
  variant = 'error',
  children,
  className
}: {
  variant?: keyof typeof STYLES
  children: ReactNode
  className?: string
}) {
  const { icon: Icon, className: tone } = STYLES[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm leading-relaxed',
        tone,
        className
      )}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
