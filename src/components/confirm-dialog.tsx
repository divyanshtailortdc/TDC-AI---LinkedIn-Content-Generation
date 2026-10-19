'use client'

import { Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'

/**
 * A modal "are you sure?" for actions that end something, like signing out or
 * deleting a passkey. Cancel has focus first, so Enter never confirms by
 * accident. Escape or a click on the backdrop cancels, except while the
 * confirmed action runs.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  onCancel,
  onConfirm
}: {
  title: string
  description: React.ReactNode
  confirmLabel: string
  /** The confirm button's text while the action runs. */
  pendingLabel: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, onCancel])

  // Portalled to <body>: the sidebar is translated on small screens, which
  // would otherwise make this "fixed" overlay cover the drawer, not the page.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs motion-safe:animate-[overlay-in_150ms_ease-out]"
      onClick={e => {
        if (e.target === e.currentTarget && !pending) onCancel()
      }}
    >
      <div className="border-border bg-surface w-full max-w-sm rounded-2xl border p-6 shadow-2xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <TriangleAlert aria-hidden className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-foreground text-base leading-6 font-semibold"
            >
              {title}
            </h2>
            <p
              id={descriptionId}
              className="text-muted mt-1 text-sm leading-relaxed"
            >
              {description}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onCancel}
            className="border-border bg-surface text-foreground hover:bg-surface-hover focus-visible:ring-foreground/30 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500/50 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-[#1b1b1f]"
          >
            {pending && (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            )}
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
