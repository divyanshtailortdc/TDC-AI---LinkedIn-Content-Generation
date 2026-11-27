'use client'

import { Button } from '@/components/button'
import { useEffect, useId, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A modal for a choice with a form in it (Regenerate, Mark as published,
 * a version's preview). Escape and a click outside close it unless it is
 * busy; the page behind gets no keys while it is open.
 */
export function BlogDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  confirmDisabled = false,
  wide = false,
  onCancel,
  onConfirm,
  children
}: {
  title: string
  description?: ReactNode
  /** Absent: only a Close button. */
  confirmLabel?: string
  pending?: boolean
  confirmDisabled?: boolean
  wide?: boolean
  onCancel: () => void
  onConfirm?: () => void
  children?: ReactNode
}) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape' && !pending) onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, onCancel])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs motion-safe:animate-[overlay-in_150ms_ease-out] sm:p-4"
      onClick={event => {
        if (event.target === event.currentTarget && !pending) onCancel()
      }}
    >
      <div
        className={`border-border bg-surface flex max-h-[calc(100dvh-1.5rem)] w-full flex-col rounded-2xl border shadow-2xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)] sm:max-h-[calc(100dvh-2rem)] ${wide ? 'max-w-3xl' : 'max-w-md'}`}
      >
        <div className="border-border border-b px-5 pt-5 pb-4 sm:px-6">
          <h2 id={titleId} className="text-foreground text-base font-semibold">
            {title}
          </h2>
          {description && (
            <div className="text-muted mt-1 text-sm leading-relaxed">
              {description}
            </div>
          )}
        </div>
        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            {children}
          </div>
        )}
        <div className="border-border flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button variant="secondary" disabled={pending} onClick={onCancel}>
            {confirmLabel ? 'Cancel' : 'Close'}
          </Button>
          {confirmLabel && onConfirm && (
            <Button
              disabled={confirmDisabled}
              loading={pending}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
