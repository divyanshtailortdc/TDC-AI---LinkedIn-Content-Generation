'use client'

import { LinkedInMark } from '@/components/auth/linkedin-mark'
import { Button, type ButtonProps } from '@/components/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import { loginPathFor } from '@/lib/safe-redirect'
import { useState, type ReactElement } from 'react'

export type SocialProvider = 'google' | 'linkedin'

/** Google's "G" mark, as Google's sign-in guidelines ask for. */
function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-[18px] w-[18px]">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.94 11.94 0 0 0 12 0 12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z"
      />
    </svg>
  )
}

const PROVIDERS = {
  google: { label: 'Google', variant: 'secondary', Mark: GoogleMark },
  // White on LinkedIn blue, as LinkedIn's own sign-in button.
  linkedin: {
    label: 'LinkedIn',
    variant: 'linkedin',
    Mark: () => <LinkedInMark className="h-5 w-5" />
  }
} satisfies Record<
  SocialProvider,
  {
    label: string
    variant: ButtonProps['variant']
    Mark: () => ReactElement
  }
>

/**
 * Starts sign-in with Google or LinkedIn. The provider sends the browser back
 * to `next` afterwards (already checked to be a path in this app), or to
 * /login with `?error=`.
 */
export function SocialSignInButton({
  provider,
  next,
  onError
}: {
  provider: SocialProvider
  next: string
  onError: (message: string) => void
}) {
  const [pending, setPending] = useState(false)
  const { label, variant, Mark } = PROVIDERS[provider]

  const signIn = async () => {
    setPending(true)
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: next,
      errorCallbackURL: loginPathFor(next)
    })
    // On success the browser is already leaving for the provider.
    if (error) {
      setPending(false)
      onError(
        authErrorMessage(
          error,
          `${label} sign-in could not start. Please try again.`
        )
      )
    }
  }

  return (
    <Button
      variant={variant}
      size="lg"
      className="w-full"
      loading={pending}
      onClick={signIn}
    >
      {!pending && <Mark />}
      Continue with {label}
    </Button>
  )
}
