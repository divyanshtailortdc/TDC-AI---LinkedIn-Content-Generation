'use client'

import {
  SetupFrame,
  SetupStepper,
  useStepSave
} from '@/components/account-setup/setup-frame'
import { AiSetupCard } from '@/components/ai-setup/ai-setup-card'
import { NEW_IDENTITY_KEY, resetDraft } from '@/components/ai-setup/draft-store'
import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import {
  IdentityFields,
  validateIdentityValues,
  type AccountType,
  type IdentityFieldErrors,
  type IdentityValues
} from '@/components/identity-fields'
import { showToast } from '@/components/toast-notification'
import { EMPTY_PROFILE } from '@/lib/identity-profile'
import { profileSuggestionValues } from '@/lib/settings-merge'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { createAccount } from '../actions'

export default function NewAccountPage() {
  // Every visit starts blank. AI suggestions left by an earlier visit that was
  // never saved (for example another identity's analysis) would otherwise
  // prefill this form, so drop them before the prefill hook below reads them.
  // A lazy initializer runs once per mount, during the first render, so the
  // stale draft never reaches the form even for a frame.
  useState(() => resetDraft(NEW_IDENTITY_KEY))
  const formRef = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<IdentityValues>(EMPTY_PROFILE)
  const [accountType, setAccountType] = useState<AccountType>('personal')

  return (
    <SetupFrame
      stepIndex={0}
      title="Create Your Identity"
      description="Tell us about yourself or your business to generate relevant LinkedIn content."
      identity={
        <Link
          href="/"
          className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>
      }
      nav={<SetupStepper activeIndex={0} draftKey={NEW_IDENTITY_KEY} />}
      aside={
        <AiSetupCard
          urls={{
            linkedinUrl: values.linkedinUrl,
            websiteUrl: values.websiteUrl
          }}
          accountType={accountType}
          onAccountTypeChange={setAccountType}
          // Apply saves the identity; the other sections are reviewed after.
          onApply={() => formRef.current?.requestSubmit()}
          onEdit={() =>
            formRef.current?.querySelector<HTMLElement>('#name')?.focus()
          }
        />
      }
    >
      <CreateIdentityForm
        formRef={formRef}
        values={values}
        setValues={setValues}
        accountType={accountType}
        setAccountType={setAccountType}
      />
    </SetupFrame>
  )
}

/** Inside the frame so it can take over the header's Save & Next. */
function CreateIdentityForm({
  formRef,
  values,
  setValues,
  accountType,
  setAccountType
}: {
  formRef: React.RefObject<HTMLFormElement | null>
  values: IdentityValues
  setValues: React.Dispatch<React.SetStateAction<IdentityValues>>
  accountType: AccountType
  setAccountType: (value: AccountType) => void
}) {
  const [errors, setErrors] = useState<IdentityFieldErrors>({})

  const prefill = useSectionPrefill({
    draftKey: NEW_IDENTITY_KEY,
    getCurrent: () => values,
    setValues: next => setValues(prev => ({ ...prev, ...next })),
    suggestionValues: s => profileSuggestionValues(s.profile)
  })

  // Creates the identity; the action then redirects to the Voice step, so
  // this never asks the frame to navigate.
  const save = async (): Promise<boolean> => {
    // Chips and bullet lists have no native required check.
    const found = validateIdentityValues(values)
    setErrors(found)
    if (Object.keys(found).length > 0 || !formRef.current) return false

    try {
      await createAccount(new FormData(formRef.current))
    } catch (err: any) {
      showToast({
        type: 'error',
        title: 'Could not create identity',
        message: err?.message || 'Please try again.'
      })
    }
    return false
  }
  useStepSave(save)

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      className="space-y-5"
    >
      {prefill.draft && <input type="hidden" name="claimAiDraft" value="1" />}

      <PrefillBanner
        section="profile"
        prefill={prefill}
        note={
          prefill.draft
            ? 'Other sections are reviewed after you save.'
            : undefined
        }
      />

      <IdentityFields
        values={values}
        errors={errors}
        accountType={accountType}
        onAccountTypeChange={setAccountType}
        aiSuggested={{
          targetAudience:
            prefill.draft?.suggestions.profile.targetAudience?.value
        }}
        onChange={(field, value) => {
          setValues(prev => ({ ...prev, [field]: value }))
          if (errors[field])
            setErrors(prev => ({ ...prev, [field]: undefined }))
        }}
      />
    </form>
  )
}
