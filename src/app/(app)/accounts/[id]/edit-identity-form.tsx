'use client'

import { useReportProfileUrls } from '@/components/account-setup/profile-urls'
import { useStepSave } from '@/components/account-setup/setup-frame'
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
import { profileFromRecords } from '@/lib/identity-profile'
import { profileSuggestionValues } from '@/lib/settings-merge'
import { AlertCircle, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { updateAccountAction } from '../actions'

interface EditIdentityFormProps {
  account: {
    id: string
    name: string
    accountType: string
    company?: string | null
    bio?: string | null
    industry?: string | null
    linkedinUrl?: string | null
    websiteUrl?: string | null
  }
  /** Oldest first; the first row backs the profile's Offerings field. */
  initialOfferings: Array<{ name: string; description?: string | null }>
  /** Oldest first; the first row backs the profile's Target Audience field. */
  initialAudiences: Array<{ name: string }>
}

export function EditIdentityForm({
  account,
  initialOfferings,
  initialAudiences
}: EditIdentityFormProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<IdentityFieldErrors>({})
  const [accountType, setAccountType] = useState<AccountType>(
    account.accountType === 'company' ? 'company' : 'personal'
  )
  const [values, setValues] = useState<IdentityValues>(() =>
    profileFromRecords(account, initialOfferings[0], initialAudiences[0])
  )

  useReportProfileUrls(values.linkedinUrl ?? '', values.websiteUrl ?? '')

  const prefill = useSectionPrefill({
    draftKey: account.id,
    getCurrent: () => values,
    setValues: next => setValues(prev => ({ ...prev, ...next })),
    suggestionValues: s => profileSuggestionValues(s.profile)
  })

  const extraRows =
    Math.max(0, initialOfferings.length - 1) +
    Math.max(0, initialAudiences.length - 1)

  // Runs from the header's Save & Next; false keeps the user on this step.
  const save = async (): Promise<boolean> => {
    setError(null)

    const errors = validateIdentityValues(values)
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields marked with *.')
      showToast({
        type: 'error',
        title: 'Validation Error',
        message: 'Please fill in all required fields marked with *.'
      })
      return false
    }
    setFieldErrors({})

    const res = await updateAccountAction({
      id: account.id,
      ...values,
      accountType
    })
    if (!res.success) {
      setError(res.error || 'Failed to update identity')
      showToast({
        type: 'error',
        title: 'Update Failed',
        message: res.error || 'Failed to update identity'
      })
      return false
    }
    showToast({
      type: 'success',
      title: 'Identity Updated',
      message: `Identity "${values.name.trim()}" has been saved.`
    })
    router.refresh()
    return true
  }
  useStepSave(save)

  return (
    <div className="space-y-5">
      {error && (
        <div className="animate-in fade-in flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 duration-200 dark:text-red-400">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-relaxed font-semibold">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 text-red-500/70 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <PrefillBanner section="profile" prefill={prefill} />

      <div>
        <IdentityFields
          values={values}
          errors={fieldErrors}
          accountType={accountType}
          onAccountTypeChange={setAccountType}
          onChange={(field, value) => {
            setValues(prev => ({ ...prev, [field]: value }))
            if (fieldErrors[field]) {
              setFieldErrors(prev => ({ ...prev, [field]: undefined }))
            }
          }}
        />
      </div>
    </div>
  )
}
