'use client'

import { FOCUS_RING } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { Info } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const PANEL_WIDTH = 288
const GAP = 6

/**
 * An explanation kept off the page: an Info button that shows it on hover
 * (its title) and, on a click or tap, in a small panel under it. Escape, a
 * click elsewhere or scrolling closes it. The panel is portalled to the body,
 * so a header strip or a scroll box cannot clip it.
 */
export function InfoTip({
  label,
  children,
  className
}: {
  /** What the button is for, for screen readers ("About this address"). */
  label: string
  children: string
  className?: string
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  // Where the panel opens, measured from the button when it is clicked.
  const [position, setPosition] = useState<{
    left: number
    width: number
    top?: number
    bottom?: number
  } | null>(null)
  const open = position !== null

  const toggle = () => {
    if (open || !buttonRef.current) {
      setPosition(null)
      return
    }
    const rect = buttonRef.current.getBoundingClientRect()
    const width = Math.min(PANEL_WIDTH, window.innerWidth - 32)
    const left = Math.min(
      Math.max(16, rect.left),
      window.innerWidth - 16 - width
    )
    // Below the button, or above it in the lower half of the screen.
    setPosition(
      rect.top > window.innerHeight / 2
        ? { left, width, bottom: window.innerHeight - rect.top + GAP }
        : { left, width, top: rect.bottom + GAP }
    )
  }

  useEffect(() => {
    if (!open) return
    const close = () => setPosition(null)
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !buttonRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        close()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={children}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        className={cn(
          'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md align-middle transition-colors',
          FOCUS_RING,
          className
        )}
      >
        <Info aria-hidden className="h-3.5 w-3.5" />
      </button>
      {position &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="note"
            style={position}
            className="border-border bg-surface text-foreground fixed z-50 rounded-xl border p-3 text-xs leading-relaxed shadow-lg"
          >
            {children}
          </div>,
          document.body
        )}
    </>
  )
}
