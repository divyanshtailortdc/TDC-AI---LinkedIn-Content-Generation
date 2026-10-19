'use client'

import { signOutAction } from '@/lib/auth-actions'
import { cn } from '@/lib/cn'
import { Loader2, LogOut } from 'lucide-react'
import { useFormStatus } from 'react-dom'

function SubmitButton({ collapsed }: { collapsed: boolean }) {
  const { pending } = useFormStatus()
  const Icon = pending ? Loader2 : LogOut
  return (
    <button
      type="submit"
      disabled={pending}
      title={collapsed ? 'Sign out' : undefined}
      aria-label="Sign out"
      className={cn(
        'text-muted hover:bg-foreground/10 hover:text-foreground flex h-8 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg transition-colors disabled:cursor-wait',
        collapsed ? 'w-8' : 'px-2.5 text-[13px] font-medium'
      )}
    >
      <Icon aria-hidden className={cn('h-4 w-4', pending && 'animate-spin')} />
      {!collapsed && <span aria-hidden>Sign out</span>}
    </button>
  )
}

/**
 * The signed-in user and a sign-out button, at the foot of the sidebar.
 * A plain form, so it works before the page has finished loading.
 */
export function SignOutButton({
  user,
  collapsed = false
}: {
  user: { name: string; email: string }
  collapsed?: boolean
}) {
  return (
    <form
      action={signOutAction}
      className={cn(
        'flex items-center gap-2',
        collapsed ? 'justify-center' : 'justify-between px-1'
      )}
    >
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-foreground truncate text-[13px] font-medium">
            {user.name}
          </p>
          <p className="text-muted truncate text-xs">{user.email}</p>
        </div>
      )}
      <SubmitButton collapsed={collapsed} />
    </form>
  )
}
