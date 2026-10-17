'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ConfirmPopoverProps {
  /** The trigger — usually a button — that opens the popover on click. */
  children: React.ReactNode
  /** Called when the user confirms. May be async; the popover stays open (busy) until it resolves. */
  onConfirm: () => void | Promise<void>
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Visual tone of the confirm button. Defaults to 'danger' for destructive actions. */
  tone?: 'danger' | 'success' | 'neutral'
  align?: 'start' | 'end'
  disabled?: boolean
}

const TONE_STYLE: Record<NonNullable<ConfirmPopoverProps['tone']>, string> = {
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800',
  neutral: 'bg-accent text-background hover:bg-accent-hover'
}

/**
 * A small inline "are you sure?" popover anchored to its trigger, used for
 * decisions that are hard to undo (approve, reject, delete) without the
 * visual weight of a full modal. Only one instance needs to be open at a
 * time; clicking away or pressing Escape cancels it.
 */
export function ConfirmPopover({
  children,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  align = 'end',
  disabled = false
}: ConfirmPopoverProps) {
  const [open, setOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  // Popovers near the top of a scroll container (e.g. the first card in a
  // list, right under a sticky header) don't have room to open upward —
  // measured against the trigger each time it opens so it flips instead of
  // running under whatever's above it.
  const [openDirection, setOpenDirection] = useState<'up' | 'down'>('up')
  const containerRef = useRef<HTMLDivElement>(null)
  const POPOVER_HEIGHT_ESTIMATE = 140

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, isBusy])

  const handleConfirm = async () => {
    setIsBusy(true)
    try {
      await onConfirm()
      setOpen(false)
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="relative inline-flex" ref={containerRef}>
      <span
        onClick={(e) => {
          if (disabled) return
          e.stopPropagation()
          if (!open) {
            const rect = containerRef.current?.getBoundingClientRect()
            const spaceAbove = rect ? rect.top : 0
            const spaceBelow = rect ? window.innerHeight - rect.bottom : 0
            // Prefer opening up (closer to the trigger, out of typical reading
            // flow below), but flip to down when there isn't room above —
            // and flip anyway if down actually has more room, so a trigger
            // near the bottom of a short viewport doesn't get squeezed either.
            const fitsAbove = spaceAbove >= POPOVER_HEIGHT_ESTIMATE
            const fitsBelow = spaceBelow >= POPOVER_HEIGHT_ESTIMATE
            if (fitsAbove) {
              setOpenDirection('up')
            } else if (fitsBelow) {
              setOpenDirection('down')
            } else {
              // Neither fits — pick whichever side has more room.
              setOpenDirection(spaceBelow > spaceAbove ? 'down' : 'up')
            }
          }
          setOpen((v) => !v)
        }}
      >
        {children}
      </span>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => !isBusy && setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className={cn(
              'absolute z-50 w-64 rounded-xl border border-border bg-surface p-3.5 shadow-lg',
              openDirection === 'up' ? 'bottom-full mb-2' : 'top-full mt-2',
              align === 'end' ? 'right-0' : 'left-0'
            )}
          >
            <p className="text-xs font-semibold text-foreground">{title}</p>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setOpen(false)}
                className="h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-60"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleConfirm}
                className={cn(
                  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold shadow-xs transition-colors disabled:opacity-60',
                  TONE_STYLE[tone]
                )}
              >
                {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
                {confirmLabel}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
