'use client'

import { LinkedInMark } from '@/components/auth/linkedin-mark'
import { cn } from '@/lib/cn'
import type { ConnectionStatus } from '@/lib/linkedin/status'
import { LINKEDIN_SETTINGS_PATH } from '@/lib/settings-path'
import Link from 'next/link'
import { createContext, useContext, type ReactNode } from 'react'

/** The signed-in user's LinkedIn publishing connection, as the header shows it. */
export type LinkedInHeaderStatus = {
  /** The server has a publishing app set up. */
  configured: boolean
  status: ConnectionStatus | null
  name: string | null
}

const LinkedInStatusContext = createContext<LinkedInHeaderStatus | null>(null)

/** Set once by the app layout, so every page's header can show it. */
export function LinkedInStatusProvider({
  value,
  children
}: {
  value: LinkedInHeaderStatus
  children: ReactNode
}) {
  return (
    <LinkedInStatusContext.Provider value={value}>
      {children}
    </LinkedInStatusContext.Provider>
  )
}

const LINK =
  'text-linkedin-text inline-flex h-8 shrink-0 items-center gap-1.5 text-[12px] font-medium hover:underline'

/** The user's LinkedIn publishing status, as the layout loaded it (null outside it). */
export const useLinkedInStatus = () => useContext(LinkedInStatusContext)

/**
 * LinkedIn publishing in the header, beside the theme button: a link to
 * connect (straight to LinkedIn's consent screen) or reconnect, and once
 * connected just the LinkedIn mark, opening Settings → LinkedIn. Nothing when
 * publishing is not set up on this server.
 */
export function LinkedInHeaderButton() {
  const linkedIn = useLinkedInStatus()
  if (!linkedIn?.configured) return null

  if (linkedIn.status === 'connected') {
    const label = `Publishing to LinkedIn as ${linkedIn.name ?? 'your account'}`
    return (
      <Link
        href={LINKEDIN_SETTINGS_PATH}
        title={label}
        aria-label={label}
        className="border-border hover:bg-surface-hover relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors"
      >
        <LinkedInMark className="text-linkedin-text h-4 w-4" />
        <span
          aria-hidden
          className="border-surface absolute right-1 bottom-1 h-2.5 w-2.5 rounded-full border-2 bg-emerald-500"
        />
      </Link>
    )
  }

  if (linkedIn.status === 'expired') {
    return (
      <Link
        href={LINKEDIN_SETTINGS_PATH}
        title="Your LinkedIn connection has expired"
        className={cn(LINK, 'text-amber-700 dark:text-amber-400')}
      >
        <LinkedInMark className="h-3.5 w-3.5" />
        Reconnect LinkedIn to publish
      </Link>
    )
  }

  // A plain link: the route redirects to LinkedIn.
  return (
    <a
      href="/api/linkedin/connect"
      title="Connect the LinkedIn account approved posts are published to"
      className={LINK}
    >
      <LinkedInMark className="h-3.5 w-3.5" />
      Connect LinkedIn to publish from here
    </a>
  )
}
