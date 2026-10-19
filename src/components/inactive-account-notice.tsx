'use client'

import { IdentityStatusToggle } from '@/components/identity-status-toggle'
import { cn } from '@/lib/cn'
import { INACTIVE_ACCOUNT_MESSAGE } from '@/lib/inactive-account'
import { PowerOff } from 'lucide-react'

/**
 * Shown above a deactivated identity's content, whose actions are disabled
 * (and refused by the server) until it is activated again from here.
 */
export function InactiveAccountNotice({
  accountId,
  accountName,
  className
}: {
  accountId: string
  accountName: string
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <PowerOff className="h-4 w-4" />
        </div>
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
          {INACTIVE_ACCOUNT_MESSAGE}
        </p>
      </div>
      <div className="flex shrink-0 justify-end">
        <IdentityStatusToggle
          key={accountId}
          accountId={accountId}
          accountName={accountName}
          isActive={false}
        />
      </div>
    </div>
  )
}
