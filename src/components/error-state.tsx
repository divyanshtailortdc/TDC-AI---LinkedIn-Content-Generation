import Link from 'next/link'
import { AlertTriangle, RotateCw, SearchX } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The one card every error and not-found page shows, so a failure anywhere in
 * the app looks the same instead of falling through to Next's default screens.
 */
export function ErrorState({
  variant = 'error',
  title,
  message,
  digest,
  onRetry,
  className
}: {
  variant?: 'error' | 'not-found'
  title: string
  message: string
  /** Matches the server log entry for an error thrown in a Server Component. */
  digest?: string
  onRetry?: () => void
  className?: string
}) {
  const Icon = variant === 'not-found' ? SearchX : AlertTriangle

  return (
    <div className={cn('flex items-center justify-center p-8', className)}>
      <div className="max-w-sm rounded-2xl border-2 border-dashed border-border bg-surface p-10 text-center">
        <div
          className={cn(
            'mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl',
            variant === 'not-found' ? 'bg-accent/10' : 'bg-rose-500/10'
          )}
        >
          <Icon
            className={cn('h-7 w-7', variant === 'not-found' ? 'text-accent' : 'text-rose-500')}
          />
        </div>
        <h2 className="mb-2 text-lg font-semibold text-foreground">{title}</h2>
        <p className="mb-8 text-sm leading-relaxed text-muted">
          {message}
          {digest && <span className="mt-2 block font-mono text-xs">Reference: {digest}</span>}
        </p>
        <div className="flex items-center justify-center gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-background transition-colors hover:bg-accent-hover"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Try again
            </button>
          )}
          <Link
            href="/"
            className={cn(
              'inline-flex h-8 items-center rounded-lg px-3.5 text-[13px] font-medium transition-colors',
              onRetry
                ? 'border border-border text-foreground hover:bg-surface-hover'
                : 'bg-accent text-background hover:bg-accent-hover'
            )}
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
