'use client'

import { formatAbsoluteDateTime, formatRelativeDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { cn } from '@/lib/cn'

/**
 * "5m ago", with the exact time on hover. Rendered only once mounted: the
 * server's clock and time zone are not the viewer's (see format-date.ts), so
 * the server draws an empty <time> of the same element.
 */
export function TimeAgo({
  value,
  prefix,
  absolute = false,
  className
}: {
  value: Date | string
  /** Words before it, shown only with the time ("Drafted"). */
  prefix?: string
  /** The exact date and time instead of "5m ago". */
  absolute?: boolean
  className?: string
}) {
  const mounted = useHasMounted()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return (
    <time
      dateTime={date.toISOString()}
      title={mounted ? formatAbsoluteDateTime(date) : undefined}
      className={cn('tabular-nums', className)}
    >
      {mounted
        ? `${prefix ? `${prefix} ` : ''}${
            absolute ? formatAbsoluteDateTime(date) : formatRelativeDate(date)
          }`
        : ''}
    </time>
  )
}
