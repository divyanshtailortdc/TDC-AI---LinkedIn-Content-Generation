'use client'

import {
  EMPTY_SUGGESTIONS,
  getSectionStatus,
  SETUP_SECTIONS
} from '@/lib/ai/skills/profile-setup/schema'
import { RefreshCw, Sparkles, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AnalyzeForm } from './analyze-form'
import {
  clearDraft,
  moveDraft,
  NEW_IDENTITY_KEY,
  saveDraft,
  updateDraftSuggestions,
  useIdentitySetupDraft
} from './draft-store'
import { ReviewSuggestionsDialog } from './review-dialog'

type Urls = { linkedinUrl?: string | null; websiteUrl?: string | null }

const primaryButton =
  'bg-accent hover:bg-accent-hover text-background flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors'
const outlineButton =
  'border-border bg-surface text-foreground hover:bg-surface-hover flex w-full items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors'

/**
 * The "AI Suggestions" card beside the setup steps.
 *
 * With an `account` it works on that account's draft: Apply Suggestions opens
 * the review window and Edit Details goes to the Profile step. Without one
 * (the create page) it works on the new-identity draft, and the page decides
 * what Apply and Edit do.
 */
export function AiSetupCard({
  account,
  urls,
  accountType,
  onAccountTypeChange,
  onApply,
  onEdit
}: {
  account?: ({ id: string; accountType?: string } & Urls) | null
  /** Create page only: the type picked so far, and how Advanced changes it. */
  accountType?: 'personal' | 'company'
  onAccountTypeChange?: (value: 'personal' | 'company') => void
  /** URLs typed into the create form, offered as defaults in the dialog. */
  urls?: Urls
  onApply?: () => void
  onEdit?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const draftKey = account?.id ?? NEW_IDENTITY_KEY
  const draft = useIdentitySetupDraft(draftKey)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  // A draft made on the create page belongs to the account it just created.
  // Its profile was saved with the account, so only the other sections remain.
  useEffect(() => {
    if (!account) return
    if (!window.location.search.includes('aiSetup=claim')) return
    moveDraft(NEW_IDENTITY_KEY, account.id)
    updateDraftSuggestions(account.id, s => ({
      ...s,
      profile: EMPTY_SUGGESTIONS.profile
    }))
    router.replace(pathname)
  }, [account, pathname, router])

  const hasSuggestions = draft
    ? SETUP_SECTIONS.some(
        section =>
          getSectionStatus(draft.suggestions, section).state !== 'empty'
      )
    : false

  // Everything was applied: nothing left to review. Waits for the review
  // dialog to close so its results stay on screen.
  useEffect(() => {
    if (account && draft && !hasSuggestions && !reviewOpen) {
      clearDraft(account.id)
    }
  }, [account, draft, hasSuggestions, reviewOpen])

  const base = account ? `/accounts/${account.id}` : null

  const showForm = !hasSuggestions || reanalyzing

  return (
    <>
      <section className="border-border bg-surface flex flex-col rounded-xl border p-5 shadow-xs xl:h-full">
        <h2 className="text-foreground flex shrink-0 items-center gap-2 text-sm font-semibold">
          <Sparkles className="text-accent h-4 w-4" />
          AI Suggestions
        </h2>

        {showForm ? (
          <>
            <p className="text-muted mt-1.5 mb-4 shrink-0 text-xs leading-relaxed">
              {reanalyzing
                ? 'Analyze again with new details. Your current suggestions are replaced.'
                : 'Paste your company or profile details. AI suggests every step for you to review before anything is saved.'}
            </p>
            <AnalyzeForm
              accountId={account?.id}
              defaultLinkedinUrl={
                account?.linkedinUrl || urls?.linkedinUrl || ''
              }
              defaultWebsiteUrl={account?.websiteUrl || urls?.websiteUrl || ''}
              accountType={
                account
                  ? account.accountType === 'company'
                    ? 'company'
                    : 'personal'
                  : (accountType ?? 'personal')
              }
              accountTypeLocked={Boolean(account)}
              onAccountTypeChosen={onAccountTypeChange}
              onAnalyzed={analysis => {
                saveDraft(draftKey, analysis)
                setReanalyzing(false)
              }}
              onCancel={
                hasSuggestions ? () => setReanalyzing(false) : undefined
              }
            />
          </>
        ) : (
          <>
            <p className="text-muted mt-2.5 text-xs leading-relaxed">
              Based on your description, we&apos;ve generated suggestions across
              all sections. Nothing is saved until you apply it.
            </p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => (account ? setReviewOpen(true) : onApply?.())}
                className={primaryButton}
              >
                Apply Suggestions
              </button>
              {base ? (
                <Link href={base} className={outlineButton}>
                  Edit Details
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={onEdit}
                  className={outlineButton}
                >
                  Edit Details
                </button>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setReanalyzing(true)}
                className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Re-analyze
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      'Discard these AI suggestions? Your saved settings are not affected.'
                    )
                  ) {
                    clearDraft(draftKey)
                  }
                }}
                className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                Discard
              </button>
            </div>
          </>
        )}
      </section>

      {account && reviewOpen && draft && (
        <ReviewSuggestionsDialog
          accountId={account.id}
          draft={draft}
          onClose={() => setReviewOpen(false)}
          onEditDetails={() => {
            setReviewOpen(false)
            router.push(`/accounts/${account.id}`)
          }}
        />
      )}
    </>
  )
}
