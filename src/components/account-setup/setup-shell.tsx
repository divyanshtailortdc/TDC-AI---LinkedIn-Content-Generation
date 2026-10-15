'use client'

import { AiSetupCard } from '@/components/ai-setup/ai-setup-card'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ProfileUrlsProvider } from './profile-urls'
import { SetupFrame, SetupStepper } from './setup-frame'
import { getStepIndex, SETUP_STEPS } from './steps'

type ShellAccount = {
  id: string
  name: string
  headline?: string | null
  accountType: string
  avatarUrl?: string | null
  linkedinUrl?: string | null
  websiteUrl?: string | null
}

/** The setup frame for an existing account; each page renders its own step. */
export function SetupShell({
  account,
  children
}: {
  account: ShellAccount
  children: ReactNode
}) {
  const pathname = usePathname()
  const index = getStepIndex(pathname, account.id)
  const next = SETUP_STEPS[index + 1]

  const initials = account.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const isProfile = index === 0

  const frame = (
    <SetupFrame
      stepIndex={index}
      nextHref={next ? `/accounts/${account.id}${next.path}` : undefined}
      identity={
        <>
          <div className="bg-accent text-background flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-xs">
            {initials}
          </div>
          <div className="min-w-0">
            <p
              className="text-foreground truncate text-sm leading-tight font-bold"
              title={account.name}
            >
              {account.name}
            </p>
            <p className="text-muted mt-0.5 text-[11px] leading-snug">
              Workspace / Project Setup
            </p>
          </div>
        </>
      }
      nav={
        <SetupStepper
          activeIndex={index}
          accountId={account.id}
          draftKey={account.id}
        />
      }
      aside={
        isProfile ? (
          <AiSetupCard account={account} variant="assistant" />
        ) : undefined
      }
    >
      {children}
    </SetupFrame>
  )

  return isProfile ? (
    <ProfileUrlsProvider
      initial={{
        linkedinUrl: account.linkedinUrl ?? '',
        websiteUrl: account.websiteUrl ?? ''
      }}
    >
      {frame}
    </ProfileUrlsProvider>
  ) : (
    frame
  )
}
