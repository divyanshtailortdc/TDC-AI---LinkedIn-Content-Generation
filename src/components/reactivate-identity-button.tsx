'use client'

import { reactivateAccountAction } from '@/app/(app)/accounts/actions'
import { showToast } from '@/components/toast-notification'
import { Loader2, RotateCcw, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

export function ReactivateIdentityButton({
  accountId,
  accountName
}: {
  accountId: string
  accountName: string
}) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isPending) {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPending])

  const handleReactivate = () => {
    setError(null)
    startTransition(async () => {
      try {
        const res = await reactivateAccountAction(accountId)
        if (!res.success) {
          setError(res.error || 'Failed to reactivate identity')
          showToast({
            type: 'error',
            title: 'Reactivation Failed',
            message: res.error || 'Could not reactivate identity'
          })
          return
        }
        setIsOpen(false)
        showToast({
          type: 'success',
          title: 'Identity Reactivated',
          message: `"${accountName}" is now active and ready for content generation!`
        })
        router.refresh()
      } catch (err: any) {
        setError(err?.message || 'Failed to reactivate identity')
        showToast({
          type: 'error',
          title: 'Reactivation Failed',
          message: err?.message || 'Failed to reactivate identity'
        })
      }
    })
  }

  return (
    <>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setError(null)
          setIsOpen(true)
        }}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
        title={`Reactivate ${accountName}`}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        <span>Reactivate</span>
      </button>

      {/* Reactivate Confirmation Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs duration-150"
          onClick={e => {
            if (e.target === e.currentTarget && !isPending) {
              setIsOpen(false)
            }
          }}
        >
          <div className="animate-in zoom-in-95 relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl duration-200">
            {/* Close Button */}
            {!isPending && (
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 rounded-lg p-1 text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* Icon Badge */}
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 ring-8 ring-emerald-500/5">
              <RotateCcw className="h-5 w-5" />
            </div>

            {/* Title & Prompt */}
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Reactivate Identity
            </h3>
            <p className="mt-2 text-sm text-[var(--foreground)]">
              Are you sure you want to reactivate{' '}
              <span className="font-semibold text-[var(--foreground)]">
                &ldquo;{accountName}&rdquo;
              </span>
              ?
            </p>

            {/* Simple Active status message */}
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              This account will be marked as{' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                Active
              </span>
              . It will be restored to your active identities and available for
              content generation.
            </p>

            {/* Error Message */}
            {error && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            {/* Modal Actions */}
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsOpen(false)}
                className="cursor-pointer rounded-xl border border-[var(--border)] px-4 py-2 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleReactivate}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Reactivating...</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Yes, Reactivate</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
