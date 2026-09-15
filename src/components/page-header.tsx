import React from 'react'
import { ThemeToggle } from '@/components/theme-toggle'

export interface PageHeaderProps {
  title: React.ReactNode
  badge?: string
  description?: string
  preTitle?: React.ReactNode
  actions?: React.ReactNode
  bottomContent?: React.ReactNode
}

export function PageHeader({
  title,
  badge,
  description,
  preTitle,
  actions,
  bottomContent
}: PageHeaderProps) {
  return (
    <div className="flex-none p-6 sm:px-8 sm:pt-8 sm:pb-4 border-b border-border bg-background z-10 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          {preTitle && <div className="mb-3">{preTitle}</div>}
          <div className="flex items-center gap-2.5">
            {typeof title === 'string' ? (
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {title}
              </h1>
            ) : (
              title
            )}
            {badge && (
              <span className="rounded-full bg-accent/10 text-accent px-2.5 py-0.5 text-xs font-semibold">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs sm:text-sm text-muted mt-1">
              {description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {actions}
          <div className="ml-1 sm:ml-3 border-l border-border pl-3 sm:pl-5 flex items-center h-full">
            <ThemeToggle />
          </div>
        </div>
      </div>

      {bottomContent && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          {bottomContent}
        </div>
      )}
    </div>
  )
}
