'use client'

import { RefreshCw, Sparkles, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  EMPTY_SUGGESTIONS,
  getSectionStatus,
  SECTION_LABELS,
  SETUP_SECTIONS,
  type SetupSection
} from '@/lib/ai/identity-setup/schema'
import { AnalyzeWithAiDialog } from './analyze-dialog'
import {
  clearDraft,
  moveDraft,
  NEW_IDENTITY_KEY,
  saveDraft,
  updateDraftSuggestions,
  useIdentitySetupDraft
} from './draft-store'
import { ReviewSuggestionsDialog, StatusChip } from './review-dialog'

const SECTION_PATHS: Record<SetupSection, string> = {
  profile: '',
  voice: '/voice',
  knowledge: '/knowledge',
  goals: '/goals',
  preferences: '/preferences'
}

/**
 * Sits above the setup tabs: the Analyze with AI entry point, and once there
 * are suggestions, what each section got and the review actions.
 */
export function AiSetupBar({
  account
}: {
  account: { id: string; linkedinUrl?: string | null; websiteUrl?: string | null }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const draft = useIdentitySetupDraft(account.id)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  // A draft made on the create page belongs to the account it just created.
  // Its profile was saved with the account, so only the other sections remain.
  useEffect(() => {
    if (!window.location.search.includes('aiSetup=claim')) return
    moveDraft(NEW_IDENTITY_KEY, account.id)
    updateDraftSuggestions(account.id, s => ({
      ...s,
      profile: EMPTY_SUGGESTIONS.profile
    }))
    router.replace(pathname)
  }, [account.id, pathname, router])

  const base = `/accounts/${account.id}`
  const statuses = draft
    ? SETUP_SECTIONS.map(section => ({
        section,
        status: getSectionStatus(draft.suggestions, section)
      })).filter(({ status }) => status.state !== 'empty')
    : []

  // Everything was applied: nothing left to review. Waits for the review
  // dialog to close so its results stay on screen.
  useEffect(() => {
    if (draft && statuses.length === 0 && !reviewOpen) clearDraft(account.id)
  }, [draft, statuses.length, reviewOpen, account.id])

  return (
    <div className="px-4 pt-3 sm:px-6">
      {!draft || statuses.length === 0 ? (
        <div className="border-accent/20 bg-accent/5 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted text-xs">
            Describe yourself once and let AI suggest your Profile, Voice,
            Knowledge, Goals and Preferences. You review everything before it is
            saved.
          </p>
          <button
            type="button"
            onClick={() => setAnalyzeOpen(true)}
            className="bg-accent hover:bg-accent-hover text-background inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold shadow-sm transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Analyze with AI
          </button>
        </div>
      ) : (
        <div className="border-accent/30 bg-accent/5 space-y-3 rounded-xl border p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-foreground flex items-center gap-2 text-xs font-semibold">
              <Sparkles className="text-accent h-4 w-4" />
              AI suggestions ready to review. Nothing has been saved yet.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="bg-accent hover:bg-accent-hover text-background rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-sm"
              >
                Apply Suggestions
              </button>
              <Link
                href={base}
                className="border-border text-foreground hover:bg-surface-hover rounded-lg border px-3.5 py-1.5 text-xs font-medium"
              >
                Edit Details
              </Link>
              <button
                type="button"
                onClick={() => setAnalyzeOpen(true)}
                title="Analyze again"
                className="text-muted hover:text-foreground inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Re-analyze
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm('Discard these AI suggestions? Your saved settings are not affected.')) {
                    clearDraft(account.id)
                  }
                }}
                className="text-muted hover:text-foreground inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {statuses.map(({ section, status }) => (
              <Link
                key={section}
                href={`${base}${SECTION_PATHS[section]}`}
                title={
                  [...status.missingRequired, ...status.missingInfo].join('; ') ||
                  'Suggestions loaded'
                }
                className="border-border bg-surface hover:border-accent/40 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs"
              >
                <span className="text-foreground font-medium">{SECTION_LABELS[section]}</span>
                <StatusChip status={status} />
              </Link>
            ))}
          </div>
        </div>
      )}

      {analyzeOpen && (
        <AnalyzeWithAiDialog
          accountId={account.id}
          defaultLinkedinUrl={account.linkedinUrl || ''}
          defaultWebsiteUrl={account.websiteUrl || ''}
          onClose={() => setAnalyzeOpen(false)}
          onAnalyzed={analysis => {
            saveDraft(account.id, analysis)
            setAnalyzeOpen(false)
          }}
        />
      )}

      {reviewOpen && draft && (
        <ReviewSuggestionsDialog
          accountId={account.id}
          draft={draft}
          onClose={() => setReviewOpen(false)}
          onEditDetails={() => {
            setReviewOpen(false)
            router.push(base)
          }}
        />
      )}
    </div>
  )
}
