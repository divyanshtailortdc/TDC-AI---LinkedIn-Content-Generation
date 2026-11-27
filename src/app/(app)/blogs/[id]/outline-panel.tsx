'use client'

import { TextArea } from '@/components/ui/field'
import { Button } from '@/components/button'
import { docOutline, type BlogDoc } from '@/lib/blogs/doc'
import { BLOG_LIMITS } from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { Loader2, Wand2 } from 'lucide-react'
import { useId, useState } from 'react'

/**
 * The blog's headings in order: a click scrolls the document to one, and
 * each section (an H2 and what follows it) can be written again with an
 * instruction.
 */
export function OutlinePanel({
  doc,
  disabled,
  rewriting,
  onJump,
  onRewrite
}: {
  doc: BlogDoc
  disabled: boolean
  /** The section being rewritten, if any. */
  rewriting: number | null
  /** Scroll to the n-th heading of the document (0-based). */
  onJump: (headingIndex: number) => void
  /** Resolves true once rewritten. */
  onRewrite: (section: number, instruction: string | null) => Promise<boolean>
}) {
  const outline = docOutline(doc)
  const [open, setOpen] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const inputId = useId()

  if (outline.length === 0) {
    return (
      <p className="text-muted text-sm">
        No headings yet. Add an H2 to start a section.
      </p>
    )
  }

  return (
    <ol className="space-y-1">
      {outline.map((heading, index) => (
        <li
          key={`${index}:${heading.text}`}
          className={cn(heading.level === 3 && 'pl-4')}
        >
          <div className="group flex items-center gap-1">
            <button
              type="button"
              onClick={() => onJump(index)}
              className={cn(
                'hover:bg-surface-hover min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                heading.level === 2
                  ? 'text-foreground font-medium'
                  : 'text-muted'
              )}
              title={heading.text || 'Empty heading'}
            >
              {heading.text || <span className="italic">Empty heading</span>}
            </button>
            {heading.level === 2 && (
              <button
                type="button"
                disabled={disabled || rewriting !== null}
                onClick={() => {
                  setOpen(open === heading.section ? null : heading.section)
                  setInstruction('')
                }}
                aria-expanded={open === heading.section}
                aria-label={`Rewrite the section “${heading.text}”`}
                className="text-muted hover:text-foreground hover:bg-surface-hover inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-40"
              >
                {rewriting === heading.section ? (
                  <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 aria-hidden className="h-3.5 w-3.5" />
                )}
                Rewrite
              </button>
            )}
          </div>
          {open === heading.section && heading.level === 2 && (
            <form
              className="border-border bg-background mt-1 mb-2 space-y-2 rounded-lg border p-2.5"
              onSubmit={async event => {
                event.preventDefault()
                const done = await onRewrite(
                  heading.section,
                  instruction.trim() || null
                )
                if (done) setOpen(null)
              }}
            >
              <label
                htmlFor={inputId}
                className="text-foreground block text-xs font-medium"
              >
                What should change? (optional)
              </label>
              <TextArea
                id={inputId}
                rows={2}
                maxRows={8}
                autoFocus
                maxLength={BLOG_LIMITS.instructions}
                value={instruction}
                onChange={event => setInstruction(event.target.value)}
                placeholder="e.g. Add a real example. Make it shorter."
                className="bg-surface rounded-md px-2.5 py-1.5"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={rewriting !== null}
                  onClick={() => setOpen(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  type="submit"
                  loading={rewriting === heading.section}
                >
                  Rewrite section
                </Button>
              </div>
            </form>
          )}
        </li>
      ))}
    </ol>
  )
}
