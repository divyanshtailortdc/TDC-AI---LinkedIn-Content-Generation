'use client'

import { useAnchoredPanel } from '@/components/ui/floating'
import { cn } from '@/lib/cn'
import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export type MenuItem = {
  label: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  tone?: 'danger'
}

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)'

/**
 * A button that opens a short list of actions below it (above it when there
 * is more room there), kept on the screen and never clipped by a scroll box.
 * Closes on a choice, Escape or a click elsewhere; the arrow keys, Home and
 * End move between the actions.
 */
export function Menu({
  label,
  icon,
  items,
  disabled = false,
  align = 'right'
}: {
  label: string
  icon?: ReactNode
  items: MenuItem[]
  disabled?: boolean
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const position = useAnchoredPanel(open, button, panel, {
    align: align === 'right' ? 'end' : 'start'
  })

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const focusItem = (pick: (items: HTMLElement[], at: number) => number) => {
    const all = Array.from(
      panel.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []
    )
    if (all.length === 0) return
    const at = all.indexOf(document.activeElement as HTMLElement)
    all[(pick(all, at) + all.length) % all.length]?.focus()
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
          requestAnimationFrame(() => focusItem(() => 0))
        }}
        className={cn(
          'border-border bg-surface text-foreground hover:bg-surface-hover focus-visible:ring-brand/30 inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
          open && 'bg-surface-hover'
        )}
      >
        {icon}
        {label}
        <ChevronDown
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open && (
        <div
          ref={panel}
          id={menuId}
          role="menu"
          aria-label={label}
          style={position}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') focusItem((_, at) => at + 1)
            else if (event.key === 'ArrowUp') focusItem((_, at) => at - 1)
            else if (event.key === 'Home') focusItem(() => 0)
            else if (event.key === 'End') focusItem(all => all.length - 1)
            else if (event.key === 'Tab') setOpen(false)
            else return
            if (event.key !== 'Tab') event.preventDefault()
          }}
          className="border-border bg-surface z-50 w-max max-w-[calc(100vw-1rem)] min-w-52 rounded-xl border p-1 shadow-lg motion-safe:animate-[overlay-in_120ms_ease-out]"
        >
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={cn(
                'hover:bg-surface-hover focus-visible:bg-surface-hover flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0',
                item.tone === 'danger'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-foreground'
              )}
            >
              {item.icon}
              <span className="min-w-0 flex-1">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
