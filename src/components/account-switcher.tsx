'use client'

import { useRef, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'
import { setActiveAccount } from '@/lib/active-account-actions'
import { cn } from '@/lib/cn'
import { showToast } from '@/components/toast-notification'
import { initialsOf } from '@/lib/initials'

export interface SwitchableAccount {
  id: string
  name: string
  handle: string
  accountType: string
}

export function AccountSwitcher({
  accounts,
  activeAccount,
  collapsed = false
}: {
  accounts: SwitchableAccount[]
  activeAccount: SwitchableAccount | null
  collapsed?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const containerRef = useRef<HTMLDivElement>(null)

  // The create page is for an identity that doesn't exist yet, so no identity
  // is shown as active there. The previous one stays active underneath (its
  // cookie is untouched), so Cancel and Back still return to it, and picking
  // it here leaves the create page for its settings like any other identity.
  const isCreating = pathname === '/accounts/new'
  const shownAccount = isCreating ? null : activeAccount

  const handleSelect = (accountId: string) => {
    if (accountId === shownAccount?.id) {
      setOpen(false)
      return
    }
    const target = accounts.find((a) => a.id === accountId)
    startTransition(async () => {
      const res = await setActiveAccount(accountId)
      if (res.success) {
        // /accounts/[id]/... is pinned to whichever account's id is in the
        // URL, so a plain refresh() re-renders that same account. On any
        // identity's settings (not just the one switched away from), follow
        // the switch onto the new active account's equivalent settings tab.
        // Picking an identity on the create page means working on that one
        // instead, so it leaves for that identity's profile.
        const accountsMatch = pathname.match(/^\/accounts\/([^/]+)(\/.*)?$/)
        if (accountsMatch) {
          const tab = accountsMatch[1] === 'new' ? '' : accountsMatch[2] || ''
          router.push(`/accounts/${accountId}${tab}`)
        } else {
          router.refresh()
        }
        showToast({
          title: 'Switched identity',
          message: target ? `Now viewing ${target.name} · @${target.handle}` : undefined,
          type: 'success'
        })
      } else {
        showToast({
          title: 'Could not switch identity',
          message: res.error,
          type: 'error'
        })
      }
      setOpen(false)
    })
  }

  if (accounts.length === 0) {
    return (
      <Link
        href="/accounts/new"
        title={collapsed ? 'Add your first identity' : undefined}
        className={cn(
          'flex items-center rounded-lg border border-dashed border-border text-xs font-medium text-muted transition-colors hover:border-accent hover:text-foreground',
          collapsed ? 'h-8 justify-center' : 'h-8 gap-2 px-3'
        )}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        {!collapsed && 'Add your first identity'}
      </Link>
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        title={
          collapsed
            ? isCreating
              ? 'Creating new identity'
              : activeAccount?.name || 'Select identity'
            : undefined
        }
        className={cn(
          'flex cursor-pointer items-center rounded-lg border border-border bg-surface text-left transition-colors hover:bg-surface-hover disabled:opacity-60',
          collapsed ? 'w-full justify-center p-1.5' : 'w-full gap-2.5 px-2.5 py-2'
        )}
      >
        {isCreating ? (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted">
            <Plus className="h-3.5 w-3.5" />
          </div>
        ) : (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-background">
            {activeAccount ? initialsOf(activeAccount.name) : '?'}
          </div>
        )}
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold leading-tight text-foreground">
                {isCreating ? 'Creating new identity' : activeAccount?.name || 'Select identity'}
              </p>
              {/* <p className="truncate text-[11px] leading-tight text-muted">
                {activeAccount ? `@${activeAccount.handle}` : 'No active identity'}
              </p> */}
            </div>
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" />
            ) : (
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted" />
            )}
          </>
        )}
      </button>

      {open && (
        <>
          {/* Click-away layer */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute bottom-full z-20 mb-2 min-w-55 rounded-xl border border-border bg-surface p-1.5 shadow-lg',
              collapsed ? 'left-0' : 'left-0 w-full'
            )}
          >
            <p className="px-2 py-1.5 text-[10px] font-semibold tracking-wide text-muted uppercase">
              Switch identity
            </p>
            <div className="max-h-64 overflow-y-auto">
              {accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => handleSelect(account.id)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[9px] font-bold text-foreground">
                    {initialsOf(account.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{account.name}</p>
                    {/* <p className="truncate text-[10px] text-muted">@{account.handle}</p> */}
                  </div>
                  {account.id === shownAccount?.id && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                </button>
              ))}
            </div>
            <div className={cn('mt-1 border-t border-border pt-1')}>
              <Link
                href="/accounts/new"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Add identity
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
