'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** The gap between the trigger and the popover (mb-2 / mt-2). */
const POPOVER_GAP = 8

/**
 * The band of the viewport an element can show in, vertically: its
 * scrolling and clipping ancestors cut off whatever lies outside them.
 */
function visibleBand(el: HTMLElement) {
  let top = 0
  let bottom = window.innerHeight
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowY === 'visible') continue
    const rect = node.getBoundingClientRect()
    top = Math.max(top, rect.top)
    bottom = Math.min(bottom, rect.bottom)
  }
  return { top, bottom }
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
  const dialogRef = useRef<HTMLDivElement>(null)

  // Measured once the popover is rendered, before it is painted: its height
  // depends on the description, and the room above is what the scroll
  // container shows, not the whole viewport.
  useLayoutEffect(() => {
    const trigger = containerRef.current
    const dialog = dialogRef.current
    if (!open || !trigger || !dialog) return
    const rect = trigger.getBoundingClientRect()
    const band = visibleBand(trigger)
    const spaceAbove = rect.top - band.top
    const spaceBelow = band.bottom - rect.bottom
    const needed = dialog.offsetHeight + POPOVER_GAP
    // Prefer opening up (closer to the trigger, out of typical reading
    // flow below), but flip to down when there isn't room above — and when
    // neither side fits, take whichever has more room.
    if (spaceAbove >= needed) setOpenDirection('up')
    else if (spaceBelow >= needed) setOpenDirection('down')
    else setOpenDirection(spaceBelow > spaceAbove ? 'down' : 'up')
  }, [open])

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
            ref={dialogRef}
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
