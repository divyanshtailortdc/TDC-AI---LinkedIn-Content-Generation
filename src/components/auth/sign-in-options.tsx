'use client'

import { PasskeySignInButton } from '@/components/auth/passkey-sign-in-button'
import {
  SocialSignInButton,
  type SocialProvider
} from '@/components/auth/social-sign-in-button'
import { CircleAlert, X } from 'lucide-react'
import { useState } from 'react'

/** A sign-in error, its first sentence in bold, that the user can dismiss. */
function SignInError({
  message,
  onDismiss
}: {
  message: string
  onDismiss: () => void
}) {
  const end = message.indexOf('. ')
  const [title, rest] =
    end === -1
      ? [message, '']
      : [message.slice(0, end + 1), message.slice(end + 2)]

  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-3.5 text-sm leading-relaxed text-rose-700 dark:text-rose-300"
    >
      <CircleAlert
        aria-hidden
        className="mt-0.5 h-[18px] w-[18px] shrink-0 fill-rose-600 text-white dark:fill-rose-400 dark:text-rose-950"
      />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold text-rose-800 dark:text-rose-200">
          {title}
        </strong>
        {rest && ` ${rest}`}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mt-0.5 -mr-1 cursor-pointer rounded p-1 text-rose-500 transition-colors hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-200"
      >
        <X aria-hidden className="h-4 w-4" />
      </button>
    </div>
  )
}

export function SignInOptions({
  next,
  providers,
  initialError
}: {
  /** Where to go once signed in; already checked to be a path in this app. */
  next: string
  /** The social sign-ins that are configured, in display order. */
  providers: SocialProvider[]
  /** From `?error=`, e.g. a Google or LinkedIn sign-in that failed. */
  initialError?: string
}) {
  const [error, setError] = useState<string | null>(initialError ?? null)

  return (
    <div className="space-y-4">
      {error && (
        <div className="pb-2">
          <SignInError message={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {providers.map(provider => (
        <SocialSignInButton
          key={provider}
          provider={provider}
          next={next}
          onError={setError}
        />
      ))}
      <PasskeySignInButton next={next} onError={setError} />
    </div>
  )
}
