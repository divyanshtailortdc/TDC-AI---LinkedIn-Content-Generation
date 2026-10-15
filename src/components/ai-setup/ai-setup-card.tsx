'use client'

import { useProfileUrls } from '@/components/account-setup/profile-urls'
import { ConfirmPopover } from '@/components/confirm-popover'
import {
  EMPTY_SUGGESTIONS,
  getSectionStatus,
  SETUP_SECTIONS
} from '@/lib/ai/skills/profile-setup/schema'
import { Lightbulb, RefreshCw, Sparkles, X } from 'lucide-react'
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
  variant = 'rail',
  account,
  urls,
  accountType,
  onAccountTypeChange,
  onApply,
  onEdit
}: {
  /**
   * "rail" is the card beside most steps. "assistant" is the Profile step's
   * panel on the right, with a Pro Tip beneath it; its Online presence holds
   * the Profile step's LinkedIn and Website URLs.
   */
  variant?: 'rail' | 'assistant'
  account?: ({ id: string; accountType?: string } & Urls) | null
  /** Create page only: the type picked so far, and how Advanced changes it. */
  accountType?: 'personal' | 'company'
  onAccountTypeChange?: (value: 'personal' | 'company') => void
  /** Rail card on the create page only: the URLs typed into its form. */
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
  const assistant = variant === 'assistant'

  // The assistant's Online presence inputs are the Profile step's own URLs,
  // shared with the Profile form. The rail card on the create page instead
  // reads them from that form.
  const profileUrls = useProfileUrls()
  const presence =
    assistant && profileUrls
      ? {
          urls: profileUrls.urls,
          errors: profileUrls.errors,
          onChange: profileUrls.setUrls
        }
      : undefined
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
            defaultLinkedinUrl={account?.linkedinUrl || urls?.linkedinUrl || ''}
            defaultWebsiteUrl={account?.websiteUrl || urls?.websiteUrl || ''}
            urls={formUrls}
            presence={presence}
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
            onCancel={hasSuggestions ? () => setReanalyzing(false) : undefined}
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
              <button type="button" onClick={onEdit} className={outlineButton}>
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
            <ConfirmPopover
              title="Discard these AI suggestions?"
              description="Your saved settings are not affected."
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
