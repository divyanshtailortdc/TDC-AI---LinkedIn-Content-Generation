'use client'

import { ConfirmPopover } from '@/components/confirm-popover'
import { showToast } from '@/components/toast-notification'
import { PLATFORMS, splitSamplePosts, type PlatformId } from '@/lib/formats'
import { Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { forgetPlatformStyle, learnPlatformStyle } from './style-actions'

/** What was learned for a platform, and from how many posts. */
export type LearnedStyleValue = { rubric: string; count: number }

const inputClass =
  'border-border bg-surface-hover text-foreground w-full rounded-md border px-3 py-2 text-sm'

/**
 * How the identity writes on one platform, learned from posts it pastes.
 * Learning saves at once (the posts and the style), apart from the form's
 * Save, so what is shown is always what drafting uses.
 */
export function LearnedStyle({
  accountId,
  platform,
  value,
  onChange
}: {
  accountId: string
  platform: PlatformId
  value: LearnedStyleValue | null
  onChange: (next: LearnedStyleValue | null) => void
}) {
  const label = PLATFORMS[platform].label
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'learn' | 'forget' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const found = splitSamplePosts(text).length

  const learn = async () => {
    setBusy('learn')
    setError(null)
    const res = await learnPlatformStyle(accountId, platform, text)
    setBusy(null)
    if (!res.success) {
      setError(res.error)
      return
    }
    onChange({ rubric: res.rubric, count: res.count })
    setText('')
    setOpen(false)
    showToast({
      type: 'success',
      title: 'Style learned',
      message: `${label} posts will now follow how you write there.`
    })
  }

  const forget = async () => {
    setBusy('forget')
    const res = await forgetPlatformStyle(accountId, platform)
    setBusy(null)
    if (!res.success) {
      showToast({ type: 'error', title: 'Could not remove it', message: res.error })
      return
    }
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-foreground text-xs font-medium">
          How you write on {label}
          {value && (
            <span className="text-muted font-normal">
              {' '}
              · learned from {value.count} post{value.count === 1 ? '' : 's'}
            </span>
          )}
        </p>
        <div className="flex items-center gap-3">
          {value && (
            <ConfirmPopover
              title={`Forget your ${label} style?`}
              description={`The style and the ${label} posts it was learned from are removed. ${label} posts go back to your core voice.`}
              confirmLabel="Forget"
              onConfirm={forget}
              disabled={busy !== null}
            >
              <button
                type="button"
                disabled={busy !== null}
                className="text-muted text-xs font-medium hover:text-rose-500 disabled:opacity-50"
              >
                {busy === 'forget' ? 'Removing…' : 'Forget'}
              </button>
            </ConfirmPopover>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              setOpen(o => !o)
              setError(null)
            }}
            className="text-accent hover:text-accent-hover text-xs font-medium"
          >
            {open ? 'Cancel' : value ? 'Learn again' : `Learn from your ${label} posts`}
          </button>
        </div>
      </div>

      {value && !open && (
        <p className="border-border bg-surface-hover/40 text-muted max-h-24 overflow-y-auto rounded-md border px-3 py-2 text-xs leading-relaxed">
          {value.rubric}
        </p>
      )}
      {!value && !open && (
        <p className="text-muted text-[11px] leading-relaxed">
          Optional. Paste a few real {label} posts and drafts here will follow
          how you write there, not just your core voice.
        </p>
      )}

      {open && (
        <div className="space-y-2">
          <label htmlFor={`learn-${platform}`} className="sr-only">
            Your {label} posts
          </label>
          <textarea
            id={`learn-${platform}`}
            autoComplete="off"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={`Paste 2 or more of your real ${label} posts, with a line of --- between them.`}
            className={`${inputClass} h-36 resize-y leading-relaxed`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted text-[11px]">
              {found === 0
                ? 'No posts yet.'
                : `${found} post${found === 1 ? '' : 's'} found.`}
              {value && ' These replace the posts it learned from before.'}
            </span>
            <button
              type="button"
              onClick={learn}
              disabled={busy !== null || found < 2}
              className="bg-accent hover:bg-accent-hover text-background inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'learn' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {busy === 'learn' ? 'Learning…' : 'Learn my style'}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
