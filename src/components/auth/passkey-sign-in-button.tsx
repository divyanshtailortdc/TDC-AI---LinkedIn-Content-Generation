'use client'

import { Button } from '@/components/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { enterApp } from './enter-app'

/** Signs in with a passkey the user added earlier, then goes to `next`. */
export function PasskeySignInButton({
  next,
  onError
}: {
  /** Already checked to be a path in this app. */
  next: string
  onError: (message: string | null) => void
}) {
  const [pending, setPending] = useState(false)

  const signIn = async () => {
    setPending(true)
    onError(null)
    const { error } = await authClient.signIn.passkey()
    if (error) {
      setPending(false)
      onError(
        authErrorMessage(
          error,
          'Passkey sign-in failed. Please try again or use another sign-in option.'
        )
      )
      return
    }
    enterApp(next)
  }

  return (
    <Button
      variant="secondary"
      size="lg"
      className="w-full"
      loading={pending}
      onClick={signIn}
    >
      {!pending && (
        <KeyRound
          aria-hidden
          className="text-platform-text h-[18px] w-[18px]"
        />
      )}
      Sign in with a passkey
    </Button>
  )
}
