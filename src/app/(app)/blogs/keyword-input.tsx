'use client'

import { BLOG_LIMITS } from '@/lib/blogs/types'
import { X } from 'lucide-react'
import { useState } from 'react'

/**
 * Keywords as removable chips: Enter or a comma adds what was typed,
 * Backspace on an empty field removes the last. No repeats (ignoring case),
 * at most BLOG_LIMITS.secondaryKeywords.
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
    <div className="border-border bg-background focus-within:border-brand flex flex-wrap items-center gap-1.5 rounded-lg border px-2 py-1.5">
      {value.map(keyword => (
        <span
          key={keyword}
          className="bg-surface-hover text-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
        >
          {keyword}
          <button
            type="button"
            aria-label={`Remove ${keyword}`}
            disabled={disabled}
            onClick={() => onChange(value.filter(k => k !== keyword))}
            className="text-muted hover:text-foreground"
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
        placeholder={value.length ? '' : placeholder}
        className="text-foreground min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none"
      />
    </div>
  )
}
