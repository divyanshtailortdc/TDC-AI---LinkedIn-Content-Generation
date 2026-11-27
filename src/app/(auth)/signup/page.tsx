import { AuthCard } from '@/components/auth/auth-card'
import { SignInOptions } from '@/components/auth/sign-in-options'
import { socialSignInProviders } from '@/lib/auth'
import { safeRedirectPath } from '@/lib/safe-redirect'
import { getSession } from '@/lib/session'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

export const metadata: Metadata = {
  title: 'Sign up · TDC Content Engine'
}

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

export default async function SignupPage({
  searchParams
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  // Only a path inside this app; anything else (another site) goes home.
  const next = safeRedirectPath(first(params.next))

  // Already signed in: straight on.
  if (await getSession()) redirect(next)

  return (
    <AuthCard
      title="Create your account"
      description="Sign up to set up your Content Engine workspace"
    >
      <SignInOptions
        mode="sign-up"
        next={next}
        providers={socialSignInProviders}
      />
    </AuthCard>
  )
}
