'use client'

import {
  SetupFrame,
  SetupStepper,
  useStepSave
} from '@/components/account-setup/setup-frame'
import { AiSetupCard } from '@/components/ai-setup/ai-setup-card'
import { NEW_IDENTITY_KEY, resetDraft } from '@/components/ai-setup/draft-store'
import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import {
  useSectionPrefill,
  type SectionPrefill
} from '@/components/ai-setup/use-section-prefill'
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
import { useRouter } from 'next/navigation'
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
  const [saving, setSaving] = useState(false)

  // Suggestions wait in the assistant until the user applies them; only then
  // does the form change.
  const prefill = useSectionPrefill({
    draftKey: NEW_IDENTITY_KEY,
    autoApply: false,
    getCurrent: () => values,
    setValues: next => setValues(prev => ({ ...prev, ...next })),
    suggestionValues: s => profileSuggestionValues(s.profile)
  })

  return (
    <>
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
            variant="assistant"
            accountType={accountType}
            onAccountTypeChange={setAccountType}
            prefill={prefill}
            saving={saving}
            // Brings the filled form into view (it sits below on narrow screens).
            onApplied={() =>
              requestAnimationFrame(() =>
                document
                  .getElementById(PREFILL_BANNER_ID)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              )
            }
            // Saving creates the identity; the other sections are reviewed after.
            onSave={() => formRef.current?.requestSubmit()}
            onReviewFields={() => {
              const first = prefill.aiFilled[0] ?? 'name'
              const field = formRef.current?.querySelector<HTMLElement>(
                `#${first}`
              )
              field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              field?.focus({ preventScroll: true })
            }}
          />
        }
      >
        <CreateIdentityForm
          formRef={formRef}
          values={values}
          setValues={setValues}
          accountType={accountType}
          setAccountType={setAccountType}
          prefill={prefill}
          onSavingChange={setSaving}
        />
      </SetupFrame>
    </>
  )
}

const PREFILL_BANNER_ID = 'ai-prefill-banner'

/** Inside the frame so it can take over the header's Save. */
function CreateIdentityForm({
  formRef,
  values: fields,
  setValues: setFields,
  accountType,
  setAccountType,
  prefill,
  onSavingChange
}: {
  formRef: React.RefObject<HTMLFormElement | null>
  values: IdentityValues
  setValues: React.Dispatch<React.SetStateAction<IdentityValues>>
  accountType: AccountType
  setAccountType: (value: AccountType) => void
  prefill: SectionPrefill
  onSavingChange: (saving: boolean) => void
}) {
  const router = useRouter()
  const [errors, setErrors] = useState<IdentityFieldErrors>({})
  // The header and the assistant can both save; only one create may run.
  const creating = useRef(false)
  // Sent with every attempt from this visit, so the server runs a repeated
  // submission once. Made on first save rather than in render, where the
  // server and browser would pick different values.
  const createKey = useRef<string | null>(null)

  const values = fields
  const setValues = (next: Partial<IdentityValues>) =>
    setFields(prev => ({ ...prev, ...next }))

  // Creates the identity, then goes to the page the action names (the Voice
  // step, or Profile when AI suggestions are waiting). The frame is never
  // asked to navigate.
  const save = async (): Promise<boolean> => {
    if (creating.current) return false
    // Chips and bullet lists have no native required check.
    const found = validateIdentityValues(values)
    setErrors(found)
    if (Object.keys(found).length > 0 || !formRef.current) return false

    creating.current = true
    onSavingChange(true)
    try {
      createKey.current ??= `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      const formData = new FormData(formRef.current)
      formData.set('createKey', createKey.current)
      const { redirectTo } = await createAccount(formData)
      // Stays busy until the next page replaces this one.
      router.push(redirectTo)
    } catch (err: any) {
      creating.current = false
      onSavingChange(false)
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
        id={PREFILL_BANNER_ID}
        section="profile"
        prefill={prefill}
        note={
          prefill.draft
            ? 'Nothing is saved until you save. Other sections are reviewed after.'
            : undefined
        }
      />

      <IdentityFields
        values={values}
        errors={errors}
        aiFilled={new Set(prefill.aiFilled)}
        accountType={accountType}
        onAccountTypeChange={setAccountType}
        onChange={(field, value) => {
          // The two links live in the store shared with the assistant.
          setValues({ [field]: value })
          if (errors[field])
            setErrors(prev => ({ ...prev, [field]: undefined }))
        }}
      />
    </form>
  )
}
