'use client'

import { reactivateAccountAction } from '@/app/(app)/accounts/actions'
import { showToast } from '@/components/toast-notification'
import { Loader2, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export function ReactivateIdentityButton({
  accountId,
  accountName,
  label = 'Reactivate',
  variant = 'outline'
}: {
  accountId: string
  accountName: string
  /** Button text. The success toast always says "Reactivated". */
  label?: string
  /** 'solid' is the prominent call to action on a deactivated card. */
  variant?: 'outline' | 'ghost' | 'solid'
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleReactivate = () => {
    startTransition(async () => {
      try {
        const res = await reactivateAccountAction(accountId)
        if (!res.success) {
          showToast({
            type: 'error',
            title: 'Reactivation Failed',
            message: res.error || 'Could not reactivate identity'
          })
          return
        }
        showToast({
          type: 'success',
          title: 'Identity Reactivated',
          message: `"${accountName}" is now active and ready for content generation!`
        })
        router.refresh()
      } catch (err: any) {
        showToast({
          type: 'error',
          title: 'Reactivation Failed',
          message: err?.message || 'Failed to reactivate identity'
        })
      }
    })
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleReactivate}
      className={`flex cursor-pointer items-center gap-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 ${
        variant === 'solid'
          ? 'bg-emerald-600 px-3 py-1.5 font-semibold text-white shadow-xs hover:bg-emerald-700'
          : variant === 'ghost'
            ? 'px-2.5 py-1 font-medium text-muted hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400'
            : 'border-border bg-surface border px-2.5 py-1 font-medium text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300'
      }`}
      title={`${label} ${accountName}`}
    >
      {isPending ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Reactivating...</span>
        </>
      ) : (
        <>
          <RotateCcw className="h-3.5 w-3.5" />
          <span>{label}</span>
        </>
      )}
    </button>
  )
}
