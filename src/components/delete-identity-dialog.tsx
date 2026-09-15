'use client'

import { deleteAccountAction } from '@/app/(app)/accounts/actions'
import { showToast } from '@/components/toast-notification'
import { Loader2, PowerOff, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

interface DeleteIdentityDialogProps {
  accountId: string
  accountName: string
  triggerVariant?: 'button' | 'icon' | 'danger-button'
  redirectOnDelete?: string
}

export function DeleteIdentityDialog({
  accountId,
  accountName,
  triggerVariant = 'button',
  redirectOnDelete
}: DeleteIdentityDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isPending) {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPending])

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const res = await deleteAccountAction(accountId)
      if (res.success) {
        setIsOpen(false)
        showToast({
          type: 'info',
          title: 'Identity Deactivated',
          message: `"${accountName}" is now inactive.`
        })
        if (redirectOnDelete) {
          router.push(redirectOnDelete)
        } else {
          router.refresh()
        }
      } else {
        setError(res.error || 'Failed to deactivate identity')
        showToast({
          type: 'error',
          title: 'Deactivation Failed',
          message: res.error || 'Failed to deactivate identity'
        })
      }
    })
  }

  return (
    <>
      {/* Trigger Button */}
      {triggerVariant === 'icon' ? (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setIsOpen(true)
          }}
          title={`Deactivate ${accountName}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-amber-500/10 hover:text-amber-500"
        >
          <PowerOff className="h-3.5 w-3.5" />
        </button>
      ) : triggerVariant === 'danger-button' ? (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setIsOpen(true)
          }}
          className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
        >
          <PowerOff className="h-3.5 w-3.5" />
          <span>Deactivate this Identity</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setIsOpen(true)
          }}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
        >
          <PowerOff className="h-3.5 w-3.5" />
          <span>Deactivate</span>
        </button>
      )}

      {/* Confirmation Modal */}
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
          <div className="animate-in zoom-in-95 relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl duration-200">
            {/* Close Button */}
            {!isPending && (
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 rounded-lg p-1 text-muted hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* Icon Badge */}
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 ring-8 ring-amber-500/5">
              <PowerOff className="h-5 w-5" />
            </div>

            {/* Title & Prompt */}
            <h3 className="text-base font-bold text-foreground">
              Deactivate Identity
            </h3>
            <p className="mt-2 text-sm text-foreground">
              Are you sure you want to deactivate{' '}
              <span className="font-semibold text-foreground">
                &ldquo;{accountName}&rdquo;
              </span>
              ?
            </p>

            {/* Simple Active / Inactive status message */}
            <p className="mt-2 text-xs leading-relaxed text-muted">
              This account will be marked as{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">
                Inactive
              </span>
              . You can change it back to{' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                Active
              </span>{' '}
              at any time.
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
                className="cursor-pointer rounded-xl border border-border px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleDelete}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-amber-700 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Deactivating...</span>
                  </>
                ) : (
                  <>
                    <PowerOff className="h-3.5 w-3.5" />
                    <span>Yes, Deactivate</span>
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
