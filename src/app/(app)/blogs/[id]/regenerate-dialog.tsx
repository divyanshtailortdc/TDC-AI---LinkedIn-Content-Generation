'use client'

import { BLOG_LIMITS } from '@/lib/blogs/types'
import { useId, useState } from 'react'
import { BlogDialog } from './blog-dialog'

/**
 * Asks what a new version of the whole blog should change, whether to
 * research again, and, with unsaved changes, whether to save them first.
 */
export function RegenerateDialog({
  dirty,
  researchOn,
  hasImage,
  onCancel,
  onConfirm
}: {
  dirty: boolean
  /** The brief had web research on: offer to research again. */
  researchOn: boolean
  /** The blog has a featured image: offer a new one (off: it is kept). */
  hasImage: boolean
  onCancel: () => void
  /** Resolves true once the new version has started. */
  onConfirm: (choice: {
    instruction: string
    researchAgain: boolean
    newImage: boolean
    saveFirst: boolean
  }) => Promise<boolean>
}) {
  const [instruction, setInstruction] = useState('')
  const [researchAgain, setResearchAgain] = useState(false)
  const [newImage, setNewImage] = useState(false)
  const [saveFirst, setSaveFirst] = useState(true)
  const [pending, setPending] = useState(false)
  const instructionId = useId()

  return (
    <BlogDialog
      title="Write a new version"
      description="The whole blog is written again from its brief. The current text is kept as an earlier version, so you can go back to it."
      confirmLabel="Regenerate"
      pending={pending}
      onCancel={onCancel}
      onConfirm={async () => {
        setPending(true)
        const started = await onConfirm({
          instruction,
          researchAgain,
          newImage,
          saveFirst
        })
        setPending(false)
        if (started) onCancel()
      }}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor={instructionId}
            className="text-foreground text-sm font-medium"
          >
            What should change? (optional)
          </label>
          <textarea
            id={instructionId}
            rows={3}
            autoFocus
            maxLength={BLOG_LIMITS.instructions}
            value={instruction}
            onChange={event => setInstruction(event.target.value)}
            placeholder="e.g. Make it shorter and more practical, with a checklist at the end."
            className="border-border bg-background text-foreground focus:border-brand w-full rounded-lg border px-3 py-2 text-sm outline-none"
          />
        </div>
        {researchOn && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={researchAgain}
              onChange={event => setResearchAgain(event.target.checked)}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <span>
              <span className="text-foreground font-medium">
                Research the web again
              </span>
              <span className="text-muted block text-xs">
                Off: it reuses the sources it found last time (faster and
                cheaper).
              </span>
            </span>
          </label>
        )}
        {hasImage && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={newImage}
              onChange={event => setNewImage(event.target.checked)}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <span>
              <span className="text-foreground font-medium">
                Make a new featured image
              </span>
              <span className="text-muted block text-xs">
                Off: the current image stays (about $0.06-0.17 for a new one).
              </span>
            </span>
          </label>
        )}
        {dirty && (
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={saveFirst}
              onChange={event => setSaveFirst(event.target.checked)}
              className="mt-0.5 accent-[var(--brand)]"
            />
            <span>
              <span className="text-foreground font-medium">
                Save my unsaved changes first
              </span>
              <span className="text-muted block text-xs">
                They are kept as an earlier version. Off: they are discarded.
              </span>
            </span>
          </label>
        )}
      </div>
    </BlogDialog>
  )
}
