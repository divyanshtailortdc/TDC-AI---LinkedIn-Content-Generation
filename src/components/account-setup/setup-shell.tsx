'use client'

import { AiSetupCard } from '@/components/ai-setup/ai-setup-card'
import { InactiveAccountNotice } from '@/components/inactive-account-notice'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { SetupFrame, SetupStepper } from './setup-frame'
import { getStepIndex, SETUP_STEPS } from './steps'
import { initialsOf } from '@/lib/initials'

type ShellAccount = {
  id: string
  name: string
  headline?: string | null
  accountType: string
  avatarUrl?: string | null
  linkedinUrl?: string | null
  websiteUrl?: string | null
  isActive?: boolean
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

  const initials = initialsOf(account.name)

  const isProfile = index === 0
  // A deactivated identity's settings are read-only until it is activated.
  const locked = account.isActive === false

  const frame = (
    <SetupFrame
      stepIndex={index}
      nextHref={next ? `/accounts/${account.id}${next.path}` : undefined}
      hasSavedData={hasSavedData}
      locked={locked}
      notice={
        locked ? (
          <InactiveAccountNotice accountId={account.id} accountName={account.name} />
        ) : undefined
      }
      identity={
        <>
          {/* The same avatar the sidebar switcher and Accounts cards draw.
              Phones leave it out so the name keeps its room. */}
          <div
            aria-hidden
            className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold @sm:flex ${
              locked
                ? 'bg-surface-hover text-muted'
                : 'bg-accent text-background'
            }`}
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
              {locked ? (
                <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Deactivated
                </span>
              ) : (
                <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Active
                </span>
              )}
              <span className="text-muted hidden truncate text-xs capitalize @md:inline">
                {account.accountType}
              </span>
            </div>
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
