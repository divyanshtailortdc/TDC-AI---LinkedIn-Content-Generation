'use client'

import { Button } from '@/components/button'
import { authClient } from '@/lib/auth-client'
import { authErrorMessage } from '@/lib/auth-errors'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH
} from '@/lib/auth-providers'
import { Eye, EyeOff } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { enterApp } from './enter-app'

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface px-3.5 h-12 text-[15px] text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors'

/**
 * Signs in with an email and password, or makes a new account with them
 * (`mode`), then goes to `next`.
 */
export function EmailPasswordForm({
  mode,
  next,
  onError
}: {
  mode: 'sign-in' | 'sign-up'
  /** Already checked to be a path in this app. */
  next: string
  onError: (message: string | null) => void
}) {
  const id = useId()
  const [pending, setPending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const signingUp = mode === 'sign-up'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    setPending(true)
    onError(null)

    const { error } = signingUp
      ? await authClient.signUp.email({
          name: String(form.get('name') ?? '').trim(),
          email,
          password
        })
      : await authClient.signIn.email({ email, password })

    if (error) {
      setPending(false)
      onError(
        authErrorMessage(
          error,
          signingUp
            ? 'We could not create your account. Please try again.'
            : 'Sign-in failed. Please try again.'
        )
      )
      return
    }
    enterApp(next)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {signingUp && (
        <div className="space-y-1.5">
          <label
            htmlFor={`${id}-name`}
            className="text-foreground text-sm font-medium"
          >
            Full name
          </label>
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            placeholder="Jane Doe"
            className={INPUT_CLASS}
          />
        </div>
      )}
      <div className="space-y-1.5">
        <label
          htmlFor={`${id}-email`}
          className="text-foreground text-sm font-medium"
        >
          Email
        </label>
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete={signingUp ? 'email' : 'username'}
          placeholder="you@company.com"
          className={INPUT_CLASS}
        />
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor={`${id}-password`}
          className="text-foreground text-sm font-medium"
        >
          Password
        </label>
        <div className="relative">
          <input
            id={`${id}-password`}
            name="password"
            type={showPassword ? 'text' : 'password'}
            required
            minLength={signingUp ? PASSWORD_MIN_LENGTH : undefined}
            maxLength={PASSWORD_MAX_LENGTH}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            placeholder={
              signingUp
                ? `At least ${PASSWORD_MIN_LENGTH} characters`
                : 'Your password'
            }
            className={`${INPUT_CLASS} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(shown => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="text-muted hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1.5 transition-colors"
          >
            {showPassword ? (
              <EyeOff aria-hidden className="h-4 w-4" />
            ) : (
              <Eye aria-hidden className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {signingUp ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  )
}
