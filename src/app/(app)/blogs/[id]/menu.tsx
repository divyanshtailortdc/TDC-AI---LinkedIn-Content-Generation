'use client'

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

/**
 * A button that opens a short list of actions below it. Closes on a choice,
 * Escape or a click elsewhere.
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
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setOpen(value => !value)}
        className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {icon}
        {label}
        <ChevronDown aria-hidden className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={cn(
            'border-border bg-surface absolute z-30 mt-1 min-w-48 rounded-xl border p-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0'
          )}
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
                'hover:bg-surface-hover flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                item.tone === 'danger'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-foreground'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
