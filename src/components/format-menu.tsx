'use client'

import { cn } from '@/lib/cn'
import { FORMATS, type FormatId } from '@/lib/formats'
import { ChevronDown, Share2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * Which formats "Create posts" writes: each idea's own (what its run marked
 * it as suiting), or the formats picked here for every selected idea.
 */
export type FormatChoice = 'suited' | FormatId[]

/** What draftSelectedIdeas takes: no list keeps each idea's own formats. */
export const formatsForRequest = (choice: FormatChoice) =>
  choice === 'suited' ? undefined : choice

function describeChoice(choice: FormatChoice): string {
  if (choice === 'suited') return 'Suited platforms'
  if (choice.length === 1) return FORMATS[choice[0]!].label
  return `${choice.length} formats`
}

export function FormatMenu({
  enabled,
  value,
  onChange,
  disabled
}: {
  /** The formats the identity has turned on; the menu shows only when there are two or more. */
  enabled: FormatId[]
  value: FormatChoice
  onChange: (next: FormatChoice) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (enabled.length < 2) return null

  const toggle = (id: FormatId) => {
    const current = value === 'suited' ? [] : value
    const next = current.includes(id)
      ? current.filter(f => f !== id)
      : enabled.filter(f => f === id || current.includes(f))
    onChange(next.length > 0 ? next : 'suited')
  }

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
        className="border-border text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Share2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{describeChoice(value)}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Platforms to write the posts for"
          className="border-border bg-surface absolute right-0 z-40 mt-1.5 w-72 rounded-xl border p-2 text-left shadow-lg"
        >
          <label className="hover:bg-surface-hover flex cursor-pointer items-start gap-2.5 rounded-lg p-2">
            <input
              type="radio"
              name={`${panelId}-mode`}
              checked={value === 'suited'}
              onChange={() => onChange('suited')}
              className="accent-accent mt-0.5"
            />
            <span className="min-w-0">
              <span className="text-foreground block text-xs font-semibold">
                Each idea&apos;s suited platforms
              </span>
              <span className="text-muted block text-[11px] leading-snug">
                The platforms the run marked each idea as suiting.
              </span>
            </span>
          </label>
          <div className="border-border my-1 border-t" />
          <p className="text-muted px-2 pt-1 pb-1.5 text-[11px]">
            Or write every selected idea for:
          </p>
          {enabled.map(id => (
            <label
              key={id}
              className="hover:bg-surface-hover flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5"
            >
              <input
                type="checkbox"
                checked={value !== 'suited' && value.includes(id)}
                onChange={() => toggle(id)}
                className="accent-accent"
              />
              <span
                className={cn(
                  'text-xs',
                  value !== 'suited' && value.includes(id)
                    ? 'text-foreground font-semibold'
                    : 'text-foreground'
                )}
              >
                {FORMATS[id].label}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
