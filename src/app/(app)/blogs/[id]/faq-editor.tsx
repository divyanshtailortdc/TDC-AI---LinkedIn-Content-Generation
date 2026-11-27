'use client'

import { TextArea, TextField } from '@/components/ui/field'
import { BLOG_LIMITS, type FaqItem } from '@/lib/blogs/types'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'

/**
 * The FAQ under the document: question and answer pairs to edit, add,
 * remove and reorder. Exports put it under "Frequently asked questions",
 * with FAQ structured data for search engines.
 */
export function FaqEditor({
  items,
  onChange,
  disabled
}: {
  items: FaqItem[]
  onChange: (items: FaqItem[]) => void
  disabled: boolean
}) {
  const update = (index: number, patch: Partial<FaqItem>) =>
    onChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item))
    )
  const move = (index: number, by: -1 | 1) => {
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    onChange(next)
  }

  return (
    <section
      aria-labelledby="faq-heading"
      className="border-border mt-10 border-t pt-8"
    >
      <h2
        id="faq-heading"
        className="text-foreground text-2xl font-bold tracking-tight"
      >
        Frequently asked questions
      </h2>
      {items.length === 0 && (
        <p className="text-muted mt-2 text-sm">
          No FAQ yet. Questions people search for, answered in a few lines, help
          this page show up in search.
        </p>
      )}
      <ol className="mt-4 space-y-4">
        {items.map((item, index) => (
          <FaqRow
            key={index}
            index={index}
            item={item}
            last={index === items.length - 1}
            disabled={disabled}
            onChange={patch => update(index, patch)}
            onMove={by => move(index, by)}
            onRemove={() => onChange(items.filter((_, i) => i !== index))}
          />
        ))}
      </ol>
      <button
        type="button"
        disabled={disabled || items.length >= BLOG_LIMITS.faqItems}
        onClick={() => onChange([...items, { question: '', answer: '' }])}
        className="border-border text-foreground hover:bg-surface-hover hover:border-brand/40 mt-4 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
        Add a question
      </button>
    </section>
  )
}

function FaqRow({
  index,
  item,
  last,
  disabled,
  onChange,
  onMove,
  onRemove
}: {
  index: number
  item: FaqItem
  last: boolean
  disabled: boolean
  onChange: (patch: Partial<FaqItem>) => void
  onMove: (by: -1 | 1) => void
  onRemove: () => void
}) {
  const questionId = useId()
  const answerId = useId()
  const icon =
    'text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-30'
  // Edited in place, so it reads like the published FAQ: no field borders.
  const inline =
    'rounded-md border-0 bg-transparent px-1.5 shadow-none hover:bg-surface-hover/60 focus:bg-surface-hover/60 focus:ring-0 disabled:opacity-100'
  return (
    <li className="border-border bg-surface focus-within:border-brand/50 rounded-xl border p-3 transition-colors">
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="bg-brand/10 text-brand-strong mt-1 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-semibold tabular-nums"
        >
          Q{index + 1}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={questionId} className="sr-only">
            Question {index + 1}
          </label>
          <TextField
            id={questionId}
            value={item.question}
            maxLength={BLOG_LIMITS.faqQuestion}
            disabled={disabled}
            onChange={event => onChange({ question: event.target.value })}
            placeholder="A question people ask"
            className={`${inline} py-1 text-base font-semibold`}
          />
          <label htmlFor={answerId} className="sr-only">
            Answer {index + 1}
          </label>
          <TextArea
            id={answerId}
            value={item.answer}
            rows={2}
            maxRows={24}
            maxLength={BLOG_LIMITS.faqAnswer}
            disabled={disabled}
            onChange={event => onChange({ answer: event.target.value })}
            placeholder="Its answer, in a few self-contained sentences"
            className={`${inline} py-1 text-[15px] leading-relaxed`}
          />
        </div>
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            aria-label={`Move question ${index + 1} up`}
            disabled={disabled || index === 0}
            onClick={() => onMove(-1)}
            className={icon}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Move question ${index + 1} down`}
            disabled={disabled || last}
            onClick={() => onMove(1)}
            className={icon}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={`Remove question ${index + 1}`}
            disabled={disabled}
            onClick={onRemove}
            className={icon}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  )
}
