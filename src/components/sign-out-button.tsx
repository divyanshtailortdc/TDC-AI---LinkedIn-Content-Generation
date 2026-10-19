'use client'

import { signOutAction } from '@/lib/auth-actions'
import { cn } from '@/lib/cn'
import { Loader2, LogOut, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'

type User = { name: string; email: string }

/**
 * Asks before signing out, so a stray click on the sidebar can't end the
 * session. Confirming runs the sign-out action, which redirects to sign-in.
 * The confirm button is worded differently from the sidebar's "Sign out" so
 * the two are never mistaken for each other.
 */
function SignOutDialog({
  pending,
  onCancel,
  onConfirm
}: {
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, onCancel])

  // Portalled to <body>: the sidebar is translated on small screens, which
  // would otherwise make this "fixed" overlay cover the drawer, not the page.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-out-title"
      aria-describedby="sign-out-description"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs motion-safe:animate-[overlay-in_150ms_ease-out]"
      onClick={e => {
        if (e.target === e.currentTarget && !pending) onCancel()
      }}
    >
      <div className="border-border bg-surface w-full max-w-sm rounded-2xl border p-6 shadow-2xl motion-safe:animate-[dialog-in_200ms_cubic-bezier(0.16,1,0.3,1)]">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <TriangleAlert aria-hidden className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              id="sign-out-title"
              className="text-foreground text-base leading-6 font-semibold"
            >
              Sign out of your account?
            </h2>
            <p
              id="sign-out-description"
              className="text-muted mt-1 text-sm leading-relaxed"
            >
              Your work stays saved. You&apos;ll need to sign in again to
              continue.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onCancel}
            className="border-border bg-surface text-foreground hover:bg-surface-hover focus-visible:ring-foreground/30 inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500/50 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70 dark:focus-visible:ring-offset-[#1b1b1f]"
          >
            {pending && (
              <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
            )}
            {pending ? 'Signing out…' : 'Yes, sign out'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/**
 * The signed-in user and a sign-out button, at the foot of the sidebar.
 * The button opens a confirmation dialog warning that the account will be
 * signed out; only confirming ends the session.
 */
export function SignOutButton({
  user,
  collapsed = false
}: {
  user: User
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  // Stays open (busy) until the action's redirect lands on the sign-in page.
  const confirm = () => startTransition(() => signOutAction())

  return (
    <div
      className={cn(
        'flex items-center gap-2',
        collapsed ? 'justify-center' : 'justify-between px-1'
      )}
    >
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-foreground truncate text-[13px] font-medium">
            {user.name}
          </p>
          <p className="text-muted truncate text-xs">{user.email}</p>
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        title={collapsed ? 'Sign out' : undefined}
        aria-label="Sign out"
        aria-haspopup="dialog"
        className={cn(
          'text-muted hover:bg-foreground/10 hover:text-foreground flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg transition-colors',
          collapsed ? 'w-8' : 'px-2.5 text-[13px] font-medium'
        )}
      >
        <LogOut aria-hidden className="h-4 w-4" />
        {!collapsed && <span aria-hidden>Sign out</span>}
      </button>

      {open && (
        <SignOutDialog pending={pending} onCancel={close} onConfirm={confirm} />
      )}
    </div>
  )
}
