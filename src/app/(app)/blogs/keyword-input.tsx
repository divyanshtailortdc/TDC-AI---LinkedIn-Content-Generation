'use client'

import { FIELD_CLASS } from '@/components/ui/field'
import { BLOG_LIMITS } from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { X } from 'lucide-react'
import { useState } from 'react'

/**
 * Keywords as removable chips: Enter or a comma adds what was typed,
 * Backspace on an empty field removes the last. No repeats (ignoring case),
 * at most BLOG_LIMITS.secondaryKeywords. A long keyword wraps inside its
 * chip instead of running out of the box.
 */
export function KeywordInput({
  id,
  value,
  onChange,
  disabled = false,
  placeholder = 'e.g. checkout design'
}: {
  id: string
  value: string[]
  onChange: (keywords: string[]) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  const full = value.length >= BLOG_LIMITS.secondaryKeywords

  const add = (raw: string) => {
    const keyword = raw
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, BLOG_LIMITS.keyword)
    setDraft('')
    if (!keyword || full) return
    if (value.some(k => k.toLowerCase() === keyword.toLowerCase())) return
    onChange([...value, keyword])
  }

  return (
    <div
      className={cn(
        FIELD_CLASS,
        'focus-within:border-brand focus-within:ring-brand/15 flex cursor-text flex-wrap items-center gap-1.5 px-2 py-1.5 focus-within:ring-3',
        disabled && 'cursor-not-allowed opacity-60'
      )}
      onClick={event => {
        if (event.target === event.currentTarget) {
          event.currentTarget.querySelector('input')?.focus()
        }
      }}
    >
      {value.map(keyword => (
        <span
          key={keyword}
          className="border-border bg-surface-hover text-foreground inline-flex max-w-full items-start gap-1 rounded-md border px-2 py-0.5 text-xs leading-5"
        >
          <span className="min-w-0 [overflow-wrap:anywhere]">{keyword}</span>
          <button
            type="button"
            aria-label={`Remove ${keyword}`}
            disabled={disabled}
            onClick={() => onChange(value.filter(k => k !== keyword))}
            className="text-muted hover:text-foreground mt-1 shrink-0 cursor-pointer rounded-sm"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        maxLength={BLOG_LIMITS.keyword}
        disabled={disabled || full}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            add(draft)
          } else if (event.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => add(draft)}
        placeholder={
          full
            ? `${BLOG_LIMITS.secondaryKeywords} keywords added`
            : value.length
              ? 'Add another…'
              : placeholder
        }
        size={Math.max(12, draft.length + 1)}
        className="text-foreground placeholder:text-muted/70 min-w-[8rem] max-w-full flex-1 bg-transparent px-1 py-0.5 text-sm leading-6 outline-none disabled:cursor-not-allowed"
      />
    </div>
  )
}
