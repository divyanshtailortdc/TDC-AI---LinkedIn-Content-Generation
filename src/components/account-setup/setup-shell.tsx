'use client'

import { AiSetupCard } from '@/components/ai-setup/ai-setup-card'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
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
  hasSavedData = false,
  children
}: {
  account: ShellAccount
  /** The step already has saved data: it opens read-only, with Edit in the header. */
  hasSavedData?: boolean
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
      hasSavedData={hasSavedData}
      identity={
        <>
          <div className="bg-accent text-background flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold shadow-xs sm:h-12 sm:w-12 sm:text-base">
            {initials}
          </div>
          <div className="min-w-0">
            <p
              className="text-foreground truncate text-base leading-tight font-bold"
              title={account.name}
            >
              {account.name}
            </p>
            <p className="text-muted mt-1 text-xs leading-snug">
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

  return frame
}
