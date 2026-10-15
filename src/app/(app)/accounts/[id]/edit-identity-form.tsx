'use client'

import { useProfileUrls } from '@/components/account-setup/profile-urls'
import {
  useStepSave,
  useStepView
} from '@/components/account-setup/setup-frame'
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
  const [fields, setFields] = useState<IdentityValues>(() =>
    profileFromRecords(account, initialOfferings[0], initialAudiences[0])
  )

  // The LinkedIn and Website URLs are entered in the assistant's Online
  // presence card, so they live in the shared store rather than in `fields`.
  const links = useProfileUrls()
  const values: IdentityValues = { ...fields, ...links?.urls }

  // What is saved right now. An identity that is already set up opens as plain
  // text; the header's Edit makes the fields editable, and its Cancel puts
  // these back.
  const [saved, setSaved] = useState<{
    values: IdentityValues
    accountType: AccountType
  }>(() => ({
    values: {
      ...profileFromRecords(account, initialOfferings[0], initialAudiences[0]),
      ...links?.urls
    },
    accountType: account.accountType === 'company' ? 'company' : 'personal'
  }))
  const dirty =
    accountType !== saved.accountType ||
    (Object.keys(values) as Array<keyof IdentityValues>).some(
      key => values[key] !== saved.values[key]
    )
  const missingRequired = Object.keys(validateIdentityValues(values)).length > 0
  const setValues = (next: Partial<IdentityValues>) => {
    const { linkedinUrl, websiteUrl, ...rest } = next
    setFields(prev => ({ ...prev, ...rest }))
    if (linkedinUrl !== undefined || websiteUrl !== undefined) {
      links?.setUrls({
        ...(linkedinUrl !== undefined && { linkedinUrl }),
        ...(websiteUrl !== undefined && { websiteUrl })
      })
    }
  }

  const prefill = useSectionPrefill({
    draftKey: account.id,
    getCurrent: () => values,
    setValues,
    suggestionValues: s => profileSuggestionValues(s.profile)
  })

  const extraRows =
    Math.max(0, initialOfferings.length - 1) +
    Math.max(0, initialAudiences.length - 1)

  /** Back to the saved profile, as plain text. */
  const cancelEditing = () => {
    prefill.undo()
    setFields(saved.values)
    links?.setUrls({
      linkedinUrl: saved.values.linkedinUrl,
      websiteUrl: saved.values.websiteUrl
    })
    setAccountType(saved.accountType)
    setFieldErrors({})
    setError(null)
  }
  // Anything that changes a value (the AI filling fields, or typing the links
  // in the assistant) needs to be seen and saved, so the header keeps the
  // fields open for it. Edit and Cancel live in the header, on every step.
  const editing = useStepView({ dirty, onCancel: cancelEditing })

  // Runs from the header's Save & Next; false keeps the user on this step.
  const save = async (): Promise<boolean> => {
    setError(null)

    // Nothing was changed and nothing required is missing: nothing to save.
    if (!dirty && Object.keys(validateIdentityValues(values)).length === 0) {
      return true
    }

    const errors = validateIdentityValues(values)
    links?.setErrors({
      linkedinUrl: errors.linkedinUrl,
      websiteUrl: errors.websiteUrl
    })
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
    // What was just saved is the new baseline, shown as plain text again.
    setSaved({ values, accountType })
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

      {!editing && missingRequired && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          Some required details are missing. Click Edit at the top to complete
          them.
        </p>
      )}

      <PrefillBanner section="profile" prefill={prefill} />

      <div>
        <IdentityFields
          values={values}
          errors={fieldErrors}
          accountType={accountType}
          onAccountTypeChange={setAccountType}
          readOnly={!editing}
          onChange={(field, value) => {
            setFields(prev => ({ ...prev, [field]: value }))
            if (fieldErrors[field]) {
              setFieldErrors(prev => ({ ...prev, [field]: undefined }))
            }
          }}
        />
      </div>
    </div>
  )
}
