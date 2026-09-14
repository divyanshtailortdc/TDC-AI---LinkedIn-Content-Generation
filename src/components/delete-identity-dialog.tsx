'use client'

import { deleteAccountAction } from '@/app/(app)/accounts/actions'
import { AlertCircle, AlertTriangle, Loader2, Trash2, X } from 'lucide-react'
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
        if (redirectOnDelete) {
          router.push(redirectOnDelete)
        } else {
          router.refresh()
        }
      } else {
        setError(res.error || 'Failed to delete identity')
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
          title={`Delete ${accountName}`}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] transition-colors hover:bg-red-500/10 hover:text-red-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : triggerVariant === 'danger-button' ? (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setIsOpen(true)
          }}
          className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete this Identity</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setIsOpen(true)
          }}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </button>
      )}

      {/* Warning Confirmation Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={e => {
            if (e.target === e.currentTarget && !isPending) {
              setIsOpen(false)
            }
          }}
        >
          <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Close Button */}
            {!isPending && (
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="absolute right-4 top-4 rounded-lg p-1 text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* Warning Icon Badge */}
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 ring-8 ring-red-500/5">
              <AlertTriangle className="h-6 w-6" />
            </div>

            {/* Title & Prompt */}
            <h3 className="text-base font-bold text-[var(--foreground)]">
              Delete Identity
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-[var(--foreground)]">
                &ldquo;{accountName}&rdquo;
              </span>
              ?
            </p>

            {/* Data Loss Warning Box */}
            <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-left">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Warning: Permanent Data Loss</span>
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-[var(--muted)]">
                This action cannot be undone. Deleting this identity will
                permanently erase all associated content and settings:
              </p>
              <ul className="space-y-1 text-[11px] text-[var(--muted)]">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  <span>Voice profile, sliders, tone & writing rules</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  <span>Knowledge base documents & grounded facts</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  <span>Offerings, services, & target audiences</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  <span>Campaign goals, cadence & preferences</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                  <span>Generated post drafts, variants, ideas & pipeline runs</span>
                </li>
              </ul>
            </div>

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
                onClick={handleDelete}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Deleting Identity...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Yes, Delete Identity</span>
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
