import { AppHeaderBar } from '@/components/app-header-bar'
import React from 'react'

export interface PageHeaderProps {
  title: React.ReactNode
  badge?: string
  description?: React.ReactNode
  /** Shown before the title on the same line, e.g. a "back" link. */
  preTitle?: React.ReactNode
  actions?: React.ReactNode
  /**
   * Tabs or filters. They get their own toolbar strip under the bar, so the
   * bar itself is the same height on every page.
   */
  bottomContent?: React.ReactNode
}

/** A route's title bar: the shared header, with the page's own actions. */
export function PageHeader({
  title,
  badge,
  description,
  preTitle,
  actions,
  bottomContent
}: PageHeaderProps) {
  return (
    <div className="z-10 w-full flex-none">
      <AppHeaderBar actions={actions}>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-3">
            {preTitle && <div className="shrink-0">{preTitle}</div>}
            {typeof title === 'string' ? (
              <h1 className="text-foreground truncate text-xl font-bold tracking-tight sm:text-2xl">
                {title}
              </h1>
            ) : (
              title
            )}
            {badge && (
              <span className="bg-accent/10 text-accent shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="text-muted mt-1 truncate text-xs sm:text-sm">
              {description}
            </p>
          )}
        </div>
      </AppHeaderBar>

      {bottomContent && (
        <div className="border-border bg-surface border-b px-4 py-3 sm:px-6">
          {/* One row that scrolls sideways rather than wrapping taller. */}
          <div className="w-full overflow-x-auto">{bottomContent}</div>
        </div>
      )}
    </div>
  )
}
