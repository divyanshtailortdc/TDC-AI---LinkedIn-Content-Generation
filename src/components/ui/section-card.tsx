import { cn } from '@/lib/cn'
import type { LucideIcon } from 'lucide-react'
import { useId, type ReactNode, type Ref } from 'react'

/**
 * A titled card: the building block of every page section. The heading names
 * the section for screen readers (aria-labelledby), the actions sit on its
 * right and wrap under it on a narrow screen.
 */
export function SectionCard({
  title,
  icon: Icon,
  description,
  actions,
  children,
  footer,
  flush = false,
  className,
  bodyClassName,
  ref
}: {
  title: ReactNode
  icon?: LucideIcon
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  /** A strip under the body, such as a legend or a pager. */
  footer?: ReactNode
  /** No padding around the body: for lists that draw their own rows. */
  flush?: boolean
  className?: string
  bodyClassName?: string
  ref?: Ref<HTMLElement>
}) {
  const headingId = useId()
  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      className={cn(
        'border-border bg-surface scroll-mt-4 rounded-2xl border shadow-xs',
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="text-foreground flex items-center gap-2 text-sm font-semibold"
          >
            {Icon && <Icon aria-hidden className="text-muted h-4 w-4 shrink-0" />}
            {title}
          </h2>
          {description && (
            <p className="text-muted mt-0.5 text-xs leading-relaxed">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      <div
        className={cn(
          flush ? 'mt-3' : 'px-4 pt-3 pb-4 sm:px-5 sm:pb-5',
          bodyClassName
        )}
      >
        {children}
      </div>
      {footer && (
        <div className="border-border border-t px-4 py-2.5 sm:px-5">{footer}</div>
      )}
    </section>
  )
}
