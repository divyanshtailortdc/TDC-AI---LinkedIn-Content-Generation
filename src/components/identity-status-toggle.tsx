'use client'

import { setAccountActiveAction } from '@/app/(app)/accounts/actions'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { initialsOf } from '@/lib/initials'
import {
  CalendarClock,
  Loader2,
  Pause,
  Play,
  Power,
  PowerOff,
  ShieldCheck,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'

interface IdentityStatusToggleProps {
  accountId: string
  accountName: string
  /** The identity's saved status. The button offers the other one. */
  isActive: boolean
  /** Shows only the icon of Deactivate below `sm`, where card actions are tight. */
  compact?: boolean
}

/**
 * Activate / Deactivate for one identity, confirmed in a dialog first. Give it
 * `key={accountId}` wherever the identity shown can change under it (the
 * dashboard's current identity, after a switch), so an open dialog or pending
 * request never carries over to another identity.
 */
export function IdentityStatusToggle({
  accountId,
  accountName,
  isActive,
  compact = false
}: IdentityStatusToggleProps) {
  // The status confirming will set, fixed when the dialog opens: a refresh
  // landing while it is open can't change what the user is agreeing to.
  const [target, setTarget] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const titleId = useId()
  const questionId = useId()
  const descriptionId = useId()

  const isOpen = target !== null
  const activating = target ?? !isActive

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPending) setTarget(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPending])

  const openDialog = () => {
    setError(null)
    setTarget(!isActive)
  }

  const close = () => {
    if (!isPending) setTarget(null)
  }

  const handleConfirm = () => {
    if (target === null) return
    const next = target
    const verb = next ? 'activate' : 'deactivate'
    setError(null)
    startTransition(async () => {
      try {
        const res = await setAccountActiveAction(accountId, next)
        if (!res.success) {
          setError(res.error || `Failed to ${verb} identity`)
          return
        }
        setTarget(null)
        showToast(
          !res.changed
            ? {
                type: 'info',
                title: 'No change needed',
                message: `"${accountName}" was already ${next ? 'active' : 'inactive'}.`
              }
            : next
              ? {
                  type: 'success',
                  title: 'Identity activated',
                  message: `"${accountName}" is active again; all actions are available.`
                }
              : {
                  type: 'info',
                  title: 'Identity deactivated',
                  message: `"${accountName}" is now inactive and read-only. You can activate it again at any time.`
                }
        )
        router.refresh()
      } catch {
        // The action reports its own failures, so a throw means the request
        // itself failed (offline, server restarted mid-request).
        setError(
          `Couldn't reach the server to ${verb} "${accountName}". Check your connection and try again.`
        )
      }
    })
  }

  const label = isActive ? 'Deactivate' : 'Activate'
  const TriggerIcon = isActive ? PowerOff : Power

  // What the change does, one short line each: what stops or starts, and
  // what is kept.
  const effects = activating
    ? [
        {
          icon: Play,
          text: 'Content generation, reviews and editing are available again.'
        },
        { icon: CalendarClock, text: 'Any enabled schedule resumes.' }
      ]
    : [
        {
          icon: Pause,
          text: 'Content generation, reviews, editing and scheduled runs are paused.'
        },
        {
          icon: ShieldCheck,
          text: 'Settings, ideas and posts are kept. You can reactivate it at any time.'
        }
      ]

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        disabled={isPending}
        title={`${label} ${accountName}`}
        aria-label={`${label} ${accountName}`}
        aria-haspopup="dialog"
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors disabled:opacity-50',
          isActive
            ? 'text-muted font-medium hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400'
            : 'bg-emerald-700 font-semibold text-white shadow-xs hover:bg-emerald-800'
        )}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <TriggerIcon className="h-3.5 w-3.5" />
        )}
        <span className={cn(compact && isActive && 'hidden sm:inline')}>
          {label}
        </span>
      </button>

      {isOpen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={`${questionId} ${descriptionId}`}
            className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs duration-150"
            onClick={e => {
              if (e.target === e.currentTarget) close()
            }}
          >
            <div className="animate-in zoom-in-95 border-border bg-surface relative w-full max-w-[30rem] rounded-2xl border shadow-2xl duration-200">
              {!isPending && (
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close"
                  className="text-muted hover:bg-surface-hover hover:text-foreground absolute top-4 right-4 rounded-lg p-1.5"
                >
                  <X className="h-4 w-4" />
                </button>
              )}

              <div className="px-5 pt-5 pb-6 sm:px-6 sm:pt-6">
                <div className="flex items-start gap-4 pr-6">
                  <div
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4',
                      activating
                        ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/5 dark:text-emerald-400'
                        : 'bg-amber-500/10 text-amber-500 ring-amber-500/5'
                    )}
                  >
                    {activating ? (
                      <Power className="h-5 w-5" />
                    ) : (
                      <PowerOff className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h3
                      id={titleId}
                      className="text-foreground text-base leading-6 font-semibold"
                    >
                      {activating ? 'Activate identity' : 'Deactivate identity'}
                    </h3>
                    <p
                      id={questionId}
                      className="text-muted mt-0.5 text-sm text-pretty"
                    >
                      Are you sure you want to{' '}
                      {activating ? 'activate' : 'deactivate'} this identity?
                    </p>
                  </div>
                </div>

                <div id={descriptionId} className="mt-5 space-y-4">
                  {/* The identity on its own, so it is clear which one changes. */}
                  <div className="border-border bg-surface-hover/40 flex items-center gap-3 rounded-xl border px-3.5 py-3">
                    <div
                      aria-hidden
                      className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        activating
                          ? 'bg-surface-hover text-muted'
                          : 'bg-accent text-background'
                      )}
                    >
                      {initialsOf(accountName)}
                    </div>
                    <p className="text-foreground min-w-0 text-sm font-semibold break-words">
                      {accountName}
                    </p>
                  </div>

                  <ul className="space-y-2.5">
                    {effects.map(({ icon: Icon, text }) => (
                      <li
                        key={text}
                        className="text-muted flex gap-2.5 text-[13px] leading-5 text-pretty"
                      >
                        <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400"
                  >
                    {error}
                  </div>
                )}
              </div>

              {/* Full-width buttons on phones, the confirm one on top. */}
              <div className="border-border flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                <button
                  type="button"
                  autoFocus
                  disabled={isPending}
                  onClick={close}
                  className="border-border text-foreground hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border px-3.5 text-[13px] font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleConfirm}
                  className={cn(
                    'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold text-white shadow-sm transition-all disabled:opacity-50',
                    activating
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-amber-600 hover:bg-amber-700'
                  )}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>
                        {activating ? 'Activating…' : 'Deactivating…'}
                      </span>
                    </>
                  ) : (
                    <>
                      {activating ? (
                        <Power className="h-3.5 w-3.5" />
                      ) : (
                        <PowerOff className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {error
                          ? 'Try again'
                          : activating
                            ? 'Activate identity'
                            : 'Deactivate identity'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
