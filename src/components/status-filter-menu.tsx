'use client'

import { cn } from '@/lib/cn'
import { Check, ListFilter } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

/**
 * A status filter: a button that opens a short menu of statuses with their
 * counts. Picking one applies it straight away. The menu is portalled to the
 * body so the page header cannot clip it.
 */
export function StatusFilterMenu<T extends string>({
  value,
  options,
  label,
  counts,
  onChange
}: {
  value: T
  /** The statuses, in the order the menu lists them. */
  options: readonly T[]
  /** What a status is called, on the button and in the menu. */
  label: (status: T) => ReactNode
  counts: Record<T, number>
  onChange: (next: T) => void
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  // Focus goes back to the button that opened the menu, not to the page body.
  const closeMenu = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  // Arrow keys, Home and End move between the options; Tab leaves the menu.
  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]'
      ) ?? []
    )
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const move = (next: number) => {
      e.preventDefault()
      items[(next + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') move(index + 1)
    else if (e.key === 'ArrowUp') move(index - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (e.key === 'Tab') {
      e.preventDefault()
      closeMenu()
    }
  }

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const width = Math.min(224, window.innerWidth - 32)
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
    })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="menu"
        aria-expanded={open}
        className="border-border bg-surface text-foreground hover:bg-surface-hover flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
      >
        <ListFilter className="text-muted h-3.5 w-3.5" />
        {label(value)}
        <span className="text-muted tabular-nums">({counts[value]})</span>
      </button>

      {open &&
        createPortal(
          <>
            <div
              aria-hidden
              className="fixed inset-0 z-40"
              onClick={closeMenu}
            />
            <div
              ref={menuRef}
              role="menu"
              aria-label="Filter by status"
              onKeyDown={onMenuKeyDown}
              style={{ top: position.top, left: position.left }}
              className="border-border bg-surface fixed z-50 w-[min(14rem,calc(100vw-2rem))] rounded-xl border p-1 shadow-lg"
            >
              {options.map(st => (
                <button
                  key={st}
                  type="button"
                  role="menuitemradio"
                  aria-checked={value === st}
                  autoFocus={value === st}
                  onClick={() => {
                    onChange(st)
                    closeMenu()
                  }}
                  className={cn(
                    'hover:bg-surface-hover flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-xs transition-colors',
                    value === st
                      ? 'text-foreground font-semibold'
                      : 'text-muted hover:text-foreground'
                  )}
                >
                  <Check
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      value !== st && 'invisible'
                    )}
                  />
                  <span className="flex-1">{label(st)}</span>
                  <span className="tabular-nums">{counts[st]}</span>
                </button>
              ))}
            </div>
          </>,
          document.body
        )}
    </>
  )
}
