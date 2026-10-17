'use client'

import { Sparkles, CheckCircle2, AlertCircle } from 'lucide-react'

const PROCESSING_STEPS = [
  'Reading grounded evidence for each idea',
  'Matching your voice, tone and platform rules',
  'Running linter checks and revising drafts that fail them',
  'Planning media for posts that call for it'
]

export type DraftingStatus = 'idle' | 'processing' | 'success' | 'error'

interface AiDraftingStatusProps {
  status: DraftingStatus
  /** e.g. "3 approved ideas" — used in the processing headline. */
  subject: string
  successMessage?: string
  errorMessage?: string | null
  onRetry?: () => void
  retryDisabled?: boolean
}

/**
 * Rich inline feedback for a background AI drafting run, shared by the Ideas
 * page and the Run Detail page so "Draft Approved" looks and behaves the
 * same everywhere it appears.
 */
export function AiDraftingStatus({
  status,
  subject,
  successMessage = 'Posts generated! Opening the review queue…',
  errorMessage,
  onRetry,
  retryDisabled
}: AiDraftingStatusProps) {
  if (status === 'idle') return null

  if (status === 'success') {
    return (
      <div className="flex w-full items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>{successMessage}</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex w-full items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-medium text-red-700 dark:text-red-300">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <div className="min-w-0">
          <p>{errorMessage || 'Drafting failed. Please try again.'}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryDisabled}
              className="mt-1.5 cursor-pointer font-semibold underline decoration-red-400 underline-offset-2 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-red-200"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative w-full overflow-hidden rounded-2xl border border-emerald-500/30 bg-linear-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-5"
    >
      {/* Soft ambient shimmer behind the copy — purely decorative, never the only signal. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.2s_ease-in-out_infinite] bg-linear-to-r from-transparent via-emerald-400/10 to-transparent"
      />

      <div className="relative flex items-start gap-3.5">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15">
            <Sparkles className="h-5 w-5 animate-pulse text-emerald-700 dark:text-emerald-400" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            AI is analyzing {subject} and generating posts…
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
            This can take a moment for multiple ideas — grounded copy, voice matching and platform
            checks all run before a post is ready to review.
          </p>

          <ul className="mt-3 space-y-1.5">
            {PROCESSING_STEPS.map((step, i) => (
              <li
                key={step}
                className="flex items-center gap-2 text-[11px] text-emerald-700/70 dark:text-emerald-300/70"
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <span className="h-1 w-1 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
