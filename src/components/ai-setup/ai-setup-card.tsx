'use client'

import { ConfirmPopover } from '@/components/confirm-popover'
import {
  EMPTY_SUGGESTIONS,
  getSectionStatus,
  SECTION_LABELS,
  SETUP_SECTIONS
} from '@/lib/ai/skills/profile-setup/schema'
import { Lightbulb, ListChecks, RefreshCw, Sparkles, X } from 'lucide-react'
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
import { ProfileSuggestionsPanel } from './profile-suggestions-panel'
import { ReviewSuggestionsDialog, StatusChip } from './review-dialog'
import type { SectionPrefill } from './use-section-prefill'

type Urls = { linkedinUrl?: string | null; websiteUrl?: string | null }

const primaryButton =
  'bg-accent hover:bg-accent-hover text-background flex h-8 w-full items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors'

/**
 * The "AI Suggestions" card beside the setup steps.
 *
 * With an `account` it works on that account's draft: View AI suggestions opens
 * the review window, where suggestions are edited and applied. Without one
 * (the create page) it works on the new-identity draft: the page's `prefill`
 * lists the profile suggestions to apply to its form, and the page saves.
 */
export function AiSetupCard({
  variant = 'rail',
  account,
  urls,
  accountType,
  accountTypeChosen = true,
  onAccountTypeChange,
  prefill,
  saving = false,
  onApplied,
  onSave,
  onReviewFields
}: {
  /**
   * "rail" is the card beside most steps. "assistant" is the Profile step's
   * panel on the right, with a Pro Tip beneath it.
   */
  variant?: 'rail' | 'assistant'
  account?: ({ id: string; accountType?: string } & Urls) | null
  /**
   * Create page only: the type shown so far, whether the user picked it, and
   * how an analysis changes it to the type its suggestions were written for.
   */
  accountType?: 'personal' | 'company'
  accountTypeChosen?: boolean
  onAccountTypeChange?: (value: 'personal' | 'company') => void
  /** Rail card on the create page only: the URLs typed into its form. */
  urls?: Urls
  /** Create page only: its form's profile suggestions, applied on confirm. */
  prefill?: SectionPrefill
  /** Create page only: the identity is being created. */
  saving?: boolean
  onApplied?: () => void
  onSave?: () => void
  onReviewFields?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const draftKey = account?.id ?? NEW_IDENTITY_KEY
  const draft = useIdentitySetupDraft(draftKey)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  // A draft made on the create page belongs to the account it just created.
  // Its profile was saved with the account, so only the other sections remain,
  // and they are shown for review right away.
  useEffect(() => {
    if (!account) return
    if (!window.location.search.includes('aiSetup=claim')) return
    moveDraft(NEW_IDENTITY_KEY, account.id)
    let hasRemaining = false
    updateDraftSuggestions(account.id, s => {
      const next = { ...s, profile: EMPTY_SUGGESTIONS.profile }
      hasRemaining = SETUP_SECTIONS.some(
        section => getSectionStatus(next, section).state !== 'empty'
      )
      return next
    })
    if (hasRemaining) queueMicrotask(() => setReviewOpen(true))
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

  const showForm = !hasSuggestions || reanalyzing
  const assistant = variant === 'assistant'

  const formUrls: Urls | undefined = !assistant && !account ? urls : undefined

  const card = (
    <section
      className={`border-border bg-surface flex flex-col rounded-xl border p-5 shadow-xs ${
        assistant ? '' : 'xl:h-full'
      }`}
    >
      {assistant ? (
        <header className="flex items-center gap-2.5">
          <span className="bg-accent/10 text-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <Sparkles className="h-4 w-4" />
          </span>
          <h2 className="text-foreground text-sm font-semibold">
            AI Profile Assistant
          </h2>
        </header>
      ) : (
        <h2 className="text-foreground flex shrink-0 items-center gap-2 text-sm font-semibold">
          <Sparkles className="text-accent h-4 w-4" />
          AI Suggestions
        </h2>
      )}

      {showForm ? (
        <>
          <p
            className={`text-muted shrink-0 text-xs leading-relaxed ${
              assistant ? 'mt-3' : 'mt-1.5 mb-4'
            }`}
          >
            {reanalyzing
              ? 'Update your details and generate new suggestions.'
              : assistant
                ? 'Add your profile details and links. AI will suggest fields for you to review.'
                : 'Add your company details. AI will suggest updates for you to review.'}
          </p>
          <AnalyzeForm
            variant={variant}
            accountId={account?.id}
            // Re-analyze starts from what was analyzed last time.
            defaultDescription={draft?.input?.description}
            defaultLinkedinUrl={
              draft?.input?.linkedinUrl ??
              (account?.linkedinUrl || urls?.linkedinUrl || '')
            }
            defaultWebsiteUrl={
              draft?.input?.websiteUrl ??
              (account?.websiteUrl || urls?.websiteUrl || '')
            }
            urls={formUrls}
            accountType={
              account
                ? account.accountType === 'company'
                  ? 'company'
                  : 'personal'
                : (accountType ?? 'personal')
            }
            accountTypeLocked={Boolean(account)}
            accountTypeChosen={accountTypeChosen}
            onAccountTypeChosen={onAccountTypeChange}
            onAnalyzed={(analysis, input) => {
              saveDraft(draftKey, analysis, input)
              setReanalyzing(false)
            }}
            onCancel={hasSuggestions ? () => setReanalyzing(false) : undefined}
          />
        </>
      ) : (
        <>
          {prefill && !account ? (
            <ProfileSuggestionsPanel
              prefill={prefill}
              accountType={accountType ?? 'personal'}
              onReanalyze={() => setReanalyzing(true)}
              saving={saving}
              onApplied={() => onApplied?.()}
              onSave={() => onSave?.()}
              onReviewFields={() => onReviewFields?.()}
            />
          ) : (
            <>
              <p className="text-muted mt-2.5 text-xs leading-relaxed">
                Suggestions are ready. Review them, choose what to keep, then
                apply. Nothing is saved until you do.
              </p>
              {draft && (
                <ul className="border-border divide-border mt-3 divide-y rounded-lg border">
                  {SETUP_SECTIONS.map(section => {
                    const status = getSectionStatus(draft.suggestions, section)
                    if (status.state === 'empty') return null
                    return (
                      <li
                        key={section}
                        className="flex items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="text-foreground text-xs font-medium">
                          {SECTION_LABELS[section]}
                        </span>
                        <StatusChip status={status} />
                      </li>
                    )
                  })}
                </ul>
              )}
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className={`${primaryButton} mt-4`}
              >
                <ListChecks className="h-3.5 w-3.5" />
                View AI suggestions
              </button>
            </>
          )}
          <div className="border-border mt-4 flex items-center justify-between border-t pt-3">
            <button
              type="button"
              onClick={() => setReanalyzing(true)}
              className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-analyze
            </button>
            <ConfirmPopover
              title="Discard these AI suggestions?"
              description={
                account
                  ? 'Your saved settings are not affected.'
                  : 'Anything already applied stays in the form.'
              }
              confirmLabel="Discard"
              onConfirm={() => clearDraft(draftKey)}
            >
              <button
                type="button"
                className="text-muted hover:text-foreground inline-flex items-center gap-1 text-xs"
              >
                <X className="h-3.5 w-3.5" />
                Discard
              </button>
            </ConfirmPopover>
          </div>
        </>
      )}
    </section>
  )

  return (
    <>
      {assistant ? (
        <div className="space-y-4">
          {card}
          <ProTipCard />
        </div>
      ) : (
        card
      )}

      {account && reviewOpen && draft && (
        <ReviewSuggestionsDialog
          // Each analysis opens with its own selection and edits.
          key={draft.id}
          accountId={account.id}
          draft={draft}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </>
  )
}

/** A short nudge under the Profile step's assistant. */
function ProTipCard() {
  return (
    <section className="border-border bg-surface rounded-xl border p-4 shadow-xs">
      <h3 className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        Pro Tip
      </h3>
      <p className="text-muted mt-1.5 text-xs leading-relaxed">
        The more specific you are with your Target Audience, the higher
        engagement your generated posts will achieve on LinkedIn.
      </p>
    </section>
  )
}
