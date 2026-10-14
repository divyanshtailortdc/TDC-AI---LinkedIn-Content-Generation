'use client'

import { AnalyzeWithAiDialog } from '@/components/ai-setup/analyze-dialog'
import {
  clearDraft,
  NEW_IDENTITY_KEY,
  resetDraft,
  saveDraft
} from '@/components/ai-setup/draft-store'
import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import {
  IdentityFields,
  type IdentityValues
} from '@/components/identity-fields'
import { PageHeader } from '@/components/page-header'
import { profileSuggestionValues } from '@/lib/ai/identity-setup/merge'
import { EMPTY_PROFILE } from '@/lib/identity-profile'
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createAccount } from '../actions'

export default function NewAccountPage() {
  // Every visit starts blank. AI suggestions left by an earlier visit that was
  // never saved (for example another identity's analysis) would otherwise
  // prefill this form, so drop them before the prefill hook below reads them.
  // A lazy initializer runs once per mount, during the first render, so the
  // stale draft never reaches the form even for a frame.
  useState(() => resetDraft(NEW_IDENTITY_KEY))
  const [values, setValues] = useState<IdentityValues>(EMPTY_PROFILE)
  const [analyzeOpen, setAnalyzeOpen] = useState(false)

  const prefill = useSectionPrefill({
    draftKey: NEW_IDENTITY_KEY,
    getCurrent: () => values,
    setValues: next => setValues(prev => ({ ...prev, ...next })),
    suggestionValues: s => profileSuggestionValues(s.profile)
  })

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Create Your Identity"
        description="Tell us about yourself or your business to generate relevant LinkedIn content."
        preTitle={
          <Link
            href="/"
            className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to dashboard</span>
          </Link>
        }
      />

      <div className="bg-surface-hover/30 flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="border-accent/20 bg-accent/5 flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted text-xs">
              Prefer to just describe yourself? AI fills in this form and
              prepares Voice, Knowledge, Goals and Preferences suggestions for
              you to review after you save.
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

          <PrefillBanner
            section="profile"
            prefill={prefill}
            note={
              prefill.draft
                ? 'Suggestions for the other sections are waiting and can be reviewed once the identity is saved.'
                : undefined
            }
          />

          <form
            action={createAccount}
            className="border-border bg-surface space-y-6 rounded-xl border p-6 sm:p-8"
          >
            {prefill.draft && <input type="hidden" name="claimAiDraft" value="1" />}

            <IdentityFields
              values={values}
              onChange={(field, value) =>
                setValues(prev => ({ ...prev, [field]: value }))
              }
            />

            <div className="border-border flex items-center justify-end gap-4 border-t pt-6">
              <Link
                href="/"
                onClick={() => clearDraft(NEW_IDENTITY_KEY)}
                className="text-muted hover:text-foreground text-sm transition-colors"
              >
                Cancel
              </Link>
              <SubmitButton />
            </div>
          </form>
        </div>
      </div>

      {analyzeOpen && (
        <AnalyzeWithAiDialog
          defaultLinkedinUrl={values.linkedinUrl}
          defaultWebsiteUrl={values.websiteUrl}
          onClose={() => setAnalyzeOpen(false)}
          onAnalyzed={analysis => {
            saveDraft(NEW_IDENTITY_KEY, analysis)
            setAnalyzeOpen(false)
          }}
        />
      )}
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-accent hover:bg-accent-hover text-background flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Saving identity…
        </>
      ) : (
        'Save identity →'
      )}
    </button>
  )
}
