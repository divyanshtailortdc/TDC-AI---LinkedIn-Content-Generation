'use client'

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'

export interface ToastItem {
  id: string
  title: string
  message?: string
  type?: 'success' | 'error' | 'info'
  duration?: number
}

export function showToast(toast: Omit<ToastItem, 'id'>) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('app-toast', {
        detail: {
          ...toast,
          id: Math.random().toString(36).substring(2, 9)
        }
      })
    )
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const handleToast = (e: Event) => {
      const customEvent = e as CustomEvent<ToastItem>
      const newToast = customEvent.detail
      setToasts(prev => [...prev, newToast])

      const duration = newToast.duration ?? 4500
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== newToast.id))
      }, duration)
    }

    window.addEventListener('app-toast', handleToast)
    return () => window.removeEventListener('app-toast', handleToast)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed top-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2.5">
      {toasts.map(toast => {
        const isSuccess = toast.type === 'success' || !toast.type
        const isError = toast.type === 'error'

        return (
          <div
            key={toast.id}
            role="status"
            className={`animate-in slide-in-from-top-3 fade-in pointer-events-auto relative flex items-start gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all duration-200 ${
              isSuccess
                ? 'border-emerald-500/30 bg-surface text-foreground ring-1 ring-emerald-500/20'
                : isError
                  ? 'border-red-500/30 bg-surface text-foreground ring-1 ring-red-500/20'
                  : 'border-blue-500/30 bg-surface text-foreground ring-1 ring-blue-500/20'
            }`}
          >
            {/* Icon */}
            <div className="mt-0.5 shrink-0">
              {isSuccess ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              ) : isError ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-red-500/10 text-red-500">
                  <AlertCircle className="h-4 w-4" />
                </div>
              ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                  <Info className="h-4 w-4" />
                </div>
              )}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-semibold text-[var(--foreground)]">
                {toast.title}
              </h4>
              {toast.message && (
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
                  {toast.message}
                </p>
              )}
            </div>

            {/* Dismiss */}
            <button
              type="button"
              onClick={() =>
                setToasts(prev => prev.filter(t => t.id !== toast.id))
              }
              className="shrink-0 rounded-lg p-1 text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
