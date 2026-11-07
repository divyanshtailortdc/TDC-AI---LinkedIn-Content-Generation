'use client'

import { PlatformMark } from '@/components/platform-mark'
import { cn } from '@/lib/cn'
import type { PlatformSpec } from '@/lib/platforms'
import type { ConnectionStatus } from '@/lib/publishing/status'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import Link from 'next/link'
import { createContext, useContext, type ReactNode } from 'react'

/** The signed-in user's publishing connection, as the header shows it. */
export type PublishingHeaderStatus = {
  /** The platform posts are published to. */
  platform: PlatformSpec
  /** The server has a publishing app set up. */
  configured: boolean
  status: ConnectionStatus | null
  name: string | null
}

const PublishingStatusContext = createContext<PublishingHeaderStatus | null>(null)

/** Set once by the app layout, so every page's header can show it. */
export function PublishingStatusProvider({
  value,
  children
}: {
  value: PublishingHeaderStatus
  children: ReactNode
}) {
  return (
    <PublishingStatusContext.Provider value={value}>
      {children}
    </PublishingStatusContext.Provider>
  )
}

const LINK =
  'text-platform-text inline-flex h-8 shrink-0 items-center gap-1.5 text-[12px] font-medium hover:underline'

/** The user's publishing status, as the layout loaded it (null outside it). */
export const usePublishingStatus = () => useContext(PublishingStatusContext)

/**
 * Publishing in the header, beside the theme button: a link to connect
 * (straight to the platform's consent screen) or reconnect, and once
 * connected just the platform's mark, opening Settings → Integrations.
 * Nothing when publishing is not set up on this server.
 */
export function PublishingHeaderButton() {
  const publishing = usePublishingStatus()
  if (!publishing?.configured) return null
  const { platform } = publishing

  if (publishing.status === 'connected') {
    const label = `Publishing to ${platform.name} as ${publishing.name ?? 'your account'}`
    return (
      <Link
        href={INTEGRATIONS_SETTINGS_PATH}
        title={label}
        aria-label={label}
        className="border-border hover:bg-surface-hover relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors"
      >
        <PlatformMark platform={platform.id} className="text-platform-text h-4 w-4" />
        <span
          aria-hidden
          className="border-surface absolute right-1 bottom-1 h-2.5 w-2.5 rounded-full border-2 bg-emerald-500"
        />
      </Link>
    )
  }

  if (publishing.status === 'expired') {
    return (
      <Link
        href={INTEGRATIONS_SETTINGS_PATH}
        title={`Your ${platform.name} connection has expired`}
        className={cn(LINK, 'text-amber-700 dark:text-amber-400')}
      >
        <PlatformMark platform={platform.id} className="h-3.5 w-3.5" />
        Reconnect {platform.name} to publish
      </Link>
    )
  }

  // A plain link: the route redirects to the platform.
  return (
    <a
      href={`/api/integrations/${platform.id}/connect`}
      title={`Connect the ${platform.name} account approved posts are published to`}
      className={LINK}
    >
      <PlatformMark platform={platform.id} className="h-3.5 w-3.5" />
      Connect {platform.name} to publish from here
    </a>
  )
}
