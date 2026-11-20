'use client'

import { Loader2, XCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** What Tab can reach inside the dialog. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/**
 * Reject a post from the list, with an optional reason, as the post page's
 * Reject does: the reason is saved to shape future drafts. Looks and keys
 * like ConfirmDialog: Escape or the backdrop cancels (not while it runs), and
 * keys pressed here go no further, so nothing behind it acts on them. Enter
 * in the reason rejects. It is modal, so Tab and Shift+Tab go round its own
 * controls; focus goes back where it was when it closes.
 */
export function RejectPostDialog({
  hook,
  pending,
  onCancel,
  onConfirm
}: {
  /** The post's opening, so it is clear which post this is. */
  hook: string
  pending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const inputId = useId()
  const [reason, setReason] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLFormElement>(null)
  // Where focus was when it opened (the ⋮ button or the card's Reject), read
  // while rendering, before the reason field takes it.
  const [returnFocus] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement
  )

  // Focus moves to the reason, and back on close. Both in one effect, so a
  // remount in development's Strict Mode ends on the reason too.
  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
        returnFocus.focus()
      }
    }
  }, [returnFocus])

  // As in ConfirmDialog: first in the capture phase, so the page behind never
  // sees these keys (⌘K, the card menu's Escape). Typing and Enter still work
  // in the dialog; Tab past its last control (or Shift+Tab before its first)
  // wraps round instead of leaving it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Escape' && !pending) onCancel()
      const panel = panelRef.current
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      const outside = !panel.contains(active)
      if (e.shiftKey ? outside || active === first : outside || active === last) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, onCancel])

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
      <form
        ref={panelRef}
        noValidate
        onSubmit={e => {
          e.preventDefault()
          if (!pending) onConfirm(reason)
        }}
        className="border-border bg-surface w-full max-w-md rounded-2xl border p-6 shadow-2xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <XCircle aria-hidden className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-foreground text-base leading-6 font-semibold"
            >
              Reject this post?
            </h2>
            <p
              id={descriptionId}
              className="text-muted mt-1 line-clamp-2 text-sm leading-relaxed"
            >
              “{hook}”
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <label htmlFor={inputId} className="text-foreground block text-xs font-semibold">
            Reason <span className="text-muted font-normal">· Optional</span>
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={reason}
            // Read-only, not disabled, while it runs: it keeps focus, and a
            // failure leaves the reason there to try again.
            readOnly={pending}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Too salesy"
            title="Saved to shape future drafts"
            className="border-border bg-surface text-foreground placeholder:text-muted h-9 w-full rounded-lg border px-3 text-sm outline-none focus:border-rose-500 focus-visible:ring-2 focus-visible:ring-rose-500/30 read-only:opacity-60"
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="border-border bg-surface text-foreground hover:bg-surface-hover focus-visible:ring-foreground/30 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500/50 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-[#1b1b1f]"
          >
            {pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
            {pending ? 'Rejecting…' : 'Reject post'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
