'use client'

import { showToast } from '@/components/toast-notification'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { cn } from '@/lib/cn'
import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'

// First match wins: Edge's user agent also says Chrome, Android's says Linux.
const BROWSERS: [RegExp, string][] = [
  [/Edg/, 'Edge'],
  [/Firefox|FxiOS/, 'Firefox'],
  [/Chrome|CriOS/, 'Chrome'],
  [/Safari/, 'Safari']
]
const SYSTEMS: [RegExp, string][] = [
  [/Android/, 'Android'],
  [/iPhone|iPad/, 'iOS'],
  [/Mac OS X/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux']
]

/**
 * A starting name for a new passkey, e.g. "Chrome on Linux", so the list in
 * Settings can tell passkeys apart until the user renames one.
 */
function browserName() {
  const ua = navigator.userAgent
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? 'Browser'
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1]
  return os ? `${browser} on ${os}` : browser
}

/**
 * Adds a passkey to the signed-in user, so they can sign in with it next time
 * instead of Google or LinkedIn. Shows the outcome as a toast.
 *
 * One passkey per account: `hasPasskey` turns true once the user has one, and
 * the add buttons are disabled until it is deleted. Only the UI holds to this;
 * the server would still accept a second one.
 */
export function useAddPasskey() {
  const [pending, setPending] = useState(false)
  // The same list Settings shows, so this updates after an add or delete.
  const { data: passkeys } = authClient.useListPasskeys()
  const hasPasskey = (passkeys?.length ?? 0) > 0

  const addPasskey = async () => {
    if (hasPasskey) return
    setPending(true)
    const result = await authClient.passkey.addPasskey({ name: browserName() })
    setPending(false)
    if (result?.error) {
      showToast({
        type: 'error',
        title: 'Passkey not added',
        message: authErrorMessage(
          result.error,
          'The passkey could not be added. Please try again.'
        )
      })
      return
    }
    showToast({
      type: 'success',
      title: 'Passkey added',
      message: 'You can now sign in with it.'
    })
  }

  return { pending, hasPasskey, addPasskey }
}

/** A row of the sidebar's account menu that adds a passkey. */
export function AddPasskeyButton({
  onSelect
}: {
  /** Called on click, before the passkey prompt opens (closes the menu). */
  onSelect?: () => void
}) {
  const { pending, hasPasskey, addPasskey } = useAddPasskey()
  const Icon = pending ? Loader2 : KeyRound

  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onSelect?.()
        addPasskey()
      }}
      disabled={pending || hasPasskey}
      className={cn(
        'text-foreground enabled:hover:bg-foreground/10 focus-visible:bg-foreground/10 flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none disabled:opacity-60',
        pending ? 'disabled:cursor-wait' : 'disabled:cursor-not-allowed'
      )}
    >
      <Icon
        aria-hidden
        className={cn('text-muted h-4 w-4', pending && 'animate-spin')}
      />
      {pending ? 'Adding passkey…' : 'Add a passkey'}
      {hasPasskey && !pending && (
        <span className="text-muted ml-auto text-xs font-normal">
          Already added
        </span>
      )}
    </button>
  )
}
