'use client'

import { showToast } from '@/components/toast-notification'
import { FORMATS, isFormatId, type FormatId } from '@/lib/formats'
import { ChevronDown, Loader2, Plus } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { addPostVersion } from './actions'
import type { PostDetail } from './posts-client'

/**
 * "Add a version": writes the post's idea up for another platform the
 * identity has turned on and the idea has no post for yet. Writing takes as
 * long as drafting one post, so the button says what it is writing until the
 * new post opens.
 */
export function AddVersionMenu({
  post,
  enabledFormats,
  onAdded,
  disabled
}: {
  post: PostDetail
  enabledFormats: FormatId[]
  onAdded: (post: PostDetail) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [writing, setWriting] = useState<FormatId | null>(null)
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

  const have = new Set(
    (post.ideaFormats?.length ? post.ideaFormats : [post.formatId ?? 'linkedin.post'])
      .filter(isFormatId)
  )
  const missing = enabledFormats.filter(f => !have.has(f))
  if (!post.ideaId || (missing.length === 0 && !writing)) return null

  const write = async (formatId: FormatId) => {
    setOpen(false)
    setWriting(formatId)
    try {
      const res = await addPostVersion(post.id, formatId)
      if (res.success && res.post) {
        onAdded(res.post)
        showToast({
          type: 'success',
          title: `${FORMATS[formatId].label} written`,
          message: 'It is open for review.'
        })
      } else {
        showToast({
          type: 'error',
          title: 'Version not written',
          message: (!res.success && res.error) || 'The new version could not be written.'
        })
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Version not written',
        message: err?.message || 'The new version could not be written.'
      })
    } finally {
      setWriting(null)
    }
  }

  return (
    <div className="relative" ref={wrapper}>
      <button
        type="button"
        disabled={disabled || Boolean(writing)}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
        className="border-border text-foreground hover:bg-surface-hover flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-70"
      >
        {writing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Writing {FORMATS[writing].label}…</span>
          </>
        ) : (
          <>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Add a version</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="menu"
          className="border-border bg-surface absolute right-0 z-40 mt-1.5 w-60 rounded-xl border p-1.5 shadow-lg"
        >
          <p className="text-muted px-2 pt-1 pb-1.5 text-[11px] leading-snug">
            Write this idea for another platform, from the same evidence.
          </p>
          {missing.map(id => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => void write(id)}
              className="text-foreground hover:bg-surface-hover block w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs font-medium"
            >
              {FORMATS[id].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
