'use client'

import { switchIdentity } from '@/app/(app)/identity/actions'
import { showToast } from '@/components/toast-notification'
import { ArrowRightLeft, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * Shown in place of something (a post) that belongs to another of the user's
 * identities: a link to it from before a switch, or from a notification.
 * Switching opens it as it is.
 */
export function OtherIdentityNotice({
  identity,
  what
}: {
  identity: { id: string; name: string }
  what: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const open = () =>
    startTransition(async () => {
      const res = await switchIdentity(identity.id)
      if (!res.success) {
        showToast({ type: 'error', title: 'Could not switch', message: res.error })
        return
      }
      router.refresh()
    })

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="border-border bg-surface max-w-sm space-y-3 rounded-2xl border p-6 text-center shadow-xs">
        <ArrowRightLeft aria-hidden className="text-accent mx-auto h-6 w-6" />
        <p className="text-foreground text-sm font-semibold">
          This {what} belongs to {identity.name}
        </p>
        <p className="text-muted text-xs leading-relaxed">
          You are working on another identity. Switch to {identity.name} to
          open it.
        </p>
        <button
          type="button"
          onClick={open}
          disabled={pending}
          className="bg-accent hover:bg-accent-hover text-background inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-xs transition-colors disabled:opacity-60"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Switch to {identity.name}
        </button>
      </div>
    </div>
  )
}
