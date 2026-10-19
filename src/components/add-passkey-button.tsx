'use client'

import { showToast } from '@/components/toast-notification'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { cn } from '@/lib/cn'
import { KeyRound, Loader2 } from 'lucide-react'
import { useState } from 'react'

/**
 * Adds a passkey to the signed-in user, so they can sign in with it next
 * time instead of Google.
 */
export function AddPasskeyButton({
  collapsed = false
}: {
  collapsed?: boolean
}) {
  const [pending, setPending] = useState(false)
  const Icon = pending ? Loader2 : KeyRound

  const addPasskey = async () => {
    setPending(true)
    const result = await authClient.passkey.addPasskey()
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

  return (
    <button
      type="button"
      onClick={addPasskey}
      disabled={pending}
      title={collapsed ? 'Add a passkey' : undefined}
      aria-label="Add a passkey"
      className={cn(
        'text-muted hover:bg-foreground/10 hover:text-foreground flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-lg transition-colors disabled:cursor-wait',
        collapsed
          ? 'w-8 justify-center'
          : 'w-full px-2.5 text-[13px] font-medium'
      )}
    >
      <Icon aria-hidden className={cn('h-4 w-4', pending && 'animate-spin')} />
      {!collapsed && <span aria-hidden>Add a passkey</span>}
    </button>
  )
}
