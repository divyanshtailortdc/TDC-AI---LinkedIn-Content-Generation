'use client'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { signOutAction } from '@/lib/auth-actions'
import { LogOut } from 'lucide-react'
import { type RefObject, useRef, useState, useTransition } from 'react'

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
  return (
    <ConfirmDialog
      title="Sign out of your account?"
      description="Your work stays saved. You'll need to sign in again to continue."
      confirmLabel="Yes, sign out"
      pendingLabel="Signing out…"
      pending={pending}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

/**
 * A row of the sidebar's account menu that signs out. It opens a
 * confirmation dialog warning that the account will be signed out; only
 * confirming ends the session.
 */
export function SignOutButton({
  onSelect,
  returnFocusRef
}: {
  /** Called on click, before the dialog opens (closes the menu). */
  onSelect?: () => void
  /** Focused when the dialog is cancelled; defaults to this button. */
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = () => {
    setOpen(false)
    ;(returnFocusRef ?? triggerRef).current?.focus()
  }
  // Stays open (busy) until the action's redirect lands on the sign-in page.
  const confirm = () => startTransition(() => signOutAction())

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        onClick={() => {
          onSelect?.()
          setOpen(true)
        }}
        aria-haspopup="dialog"
        className="group text-foreground flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-rose-500/10 hover:text-rose-600 focus-visible:bg-rose-500/10 focus-visible:text-rose-600 focus-visible:outline-none dark:hover:text-rose-400 dark:focus-visible:text-rose-400"
      >
        <LogOut
          aria-hidden
          className="text-muted h-4 w-4 group-hover:text-current group-focus-visible:text-current"
        />
        Sign out
      </button>

      {open && (
        <SignOutDialog pending={pending} onCancel={close} onConfirm={confirm} />
      )}
    </>
  )
}
