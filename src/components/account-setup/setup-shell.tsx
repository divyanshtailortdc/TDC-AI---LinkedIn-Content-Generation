'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { SetupFrame, SetupStepper } from './setup-frame'
import { getStepIndex, SETUP_STEPS } from './steps'
import { IDENTITY_PATH } from '@/lib/identity-path'
import { initialsOf } from '@/lib/initials'

// Shown on the profile step only. Loaded there, so the other steps do not
// carry the analysis form and its review dialogs in their bundle.
const AiSetupCard = dynamic(() =>
  import('@/components/ai-setup/ai-setup-card').then(m => m.AiSetupCard)
)

type ShellAccount = {
  id: string
  name: string
  headline?: string | null
  accountType: string
  avatarUrl?: string | null
  linkedinUrl?: string | null
  websiteUrl?: string | null
}

/** The setup frame for the user's identity; each page renders its own step. */
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
  const index = getStepIndex(pathname)
  const next = SETUP_STEPS[index + 1]

  const initials = initialsOf(account.name)

  const isProfile = index === 0

  const frame = (
    <SetupFrame
      stepIndex={index}
      nextHref={next ? `${IDENTITY_PATH}${next.path}` : undefined}
      hasSavedData={hasSavedData}
      identity={
        <>
          {/* Phones leave the avatar out so the name keeps its room. */}
          <div
            aria-hidden
            className="bg-accent text-background hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold @sm:flex"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p
              className="text-foreground truncate text-[15px] leading-5 font-semibold tracking-tight"
              title={account.name}
            >
              {account.name}
            </p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <span className="text-muted truncate text-xs capitalize">
                {account.accountType}
              </span>
            </div>
          </div>
        </>
      }
      nav={
        <SetupStepper
          activeIndex={index}
          linked
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
