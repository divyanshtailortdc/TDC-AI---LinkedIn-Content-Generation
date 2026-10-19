import { AuthCard } from '@/components/auth/auth-card'
import { SignInOptions } from '@/components/auth/sign-in-options'
import { socialSignInProviders } from '@/lib/auth'
import { authErrorMessage } from '@/lib/auth-errors'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { getSession } from '@/lib/session'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Sign in · TDC LinkedIn Content Engine'
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export default async function LoginPage({
  searchParams
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  // Only a path inside this app; anything else (another site) goes home.
  const next = safeRedirectPath(first(params.next))

  // Already signed in (checked against the database, not just the cookie):
  // straight on.
  if (await getSession()) redirect(next)

  const error = first(params.error)
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to access your LinkedIn Content Engine workspace"
    >
      <SignInOptions
        next={next}
        providers={socialSignInProviders}
        initialError={
          error
            ? authErrorMessage(error, 'Sign-in failed. Please try again.')
            : undefined
        }
      />
    </AuthCard>
  )
}
