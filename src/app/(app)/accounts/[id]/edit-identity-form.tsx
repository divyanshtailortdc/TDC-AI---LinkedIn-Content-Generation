'use client'

import { PrefillBanner } from '@/components/ai-setup/prefill-banner'
import { useSectionPrefill } from '@/components/ai-setup/use-section-prefill'
import { DeleteIdentityDialog } from '@/components/delete-identity-dialog'
import {
  IdentityFields,
  validateIdentityValues,
  type IdentityFieldErrors,
  type IdentityValues
} from '@/components/identity-fields'
import { showToast } from '@/components/toast-notification'
import { profileSuggestionValues } from '@/lib/ai/identity-setup/merge'
import { profileFromRecords } from '@/lib/identity-profile'
import { AlertCircle, Loader2, Save, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { updateAccountAction } from '../actions'

interface EditIdentityFormProps {
  account: {
    id: string
    name: string
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
  const [isPending, startTransition] = useTransition()
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<IdentityFieldErrors>({})
  const [values, setValues] = useState<IdentityValues>(() =>
    profileFromRecords(account, initialOfferings[0], initialAudiences[0])
  )

  const prefill = useSectionPrefill({
    draftKey: account.id,
    getCurrent: () => values,
    setValues: next => setValues(prev => ({ ...prev, ...next })),
    suggestionValues: s => profileSuggestionValues(s.profile)
  })

  const extraRows =
    Math.max(0, initialOfferings.length - 1) + Math.max(0, initialAudiences.length - 1)

  const handleSave = () => {
    setError(null)
    setSaveSuccess(false)

    const errors = validateIdentityValues(values)
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields marked with *.')
      showToast({
        type: 'error',
        title: 'Validation Error',
        message: 'Please fill in all required fields marked with *.'
      })
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    setFieldErrors({})

    startTransition(async () => {
      const res = await updateAccountAction({ id: account.id, ...values })

      if (res.success) {
        setSaveSuccess(true)
        showToast({
          type: 'success',
          title: 'Identity Updated',
          message: `Identity "${values.name.trim()}" has been updated successfully.`
        })
        router.refresh()
        setTimeout(() => setSaveSuccess(false), 3000)
      } else {
        setError(res.error || 'Failed to update identity')
        showToast({
          type: 'error',
          title: 'Update Failed',
          message: res.error || 'Failed to update identity'
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  return (
    <div className="mx-auto mt-2 max-w-3xl space-y-6">
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

      <section className="border-border bg-surface rounded-xl border p-6 shadow-xs sm:p-8">
        <IdentityFields
          values={values}
          errors={fieldErrors}
          onChange={(field, value) => {
            setValues(prev => ({ ...prev, [field]: value }))
            if (fieldErrors[field]) {
              setFieldErrors(prev => ({ ...prev, [field]: undefined }))
            }
          }}
        />
        {extraRows > 0 && (
          <p className="text-muted mt-6 text-xs">
            This identity also has {extraRows} older offering or audience
            record{extraRows === 1 ? '' : 's'} from before this form. They are
            kept and still used when generating posts.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-amber-500/20 bg-amber-500/2 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Deactivate Identity
            </h2>
            <p className="text-muted mt-0.5 text-xs">
              Mark this LinkedIn identity as inactive. You can reactivate it
              back to active anytime.
            </p>
          </div>
          <DeleteIdentityDialog
            accountId={account.id}
            accountName={account.name}
            triggerVariant="danger-button"
            redirectOnDelete="/"
          />
        </div>
      </section>

      <div className="border-border bg-surface/95 sticky bottom-4 z-20 flex items-center justify-between rounded-2xl border p-4 shadow-lg backdrop-blur-md">
        <div className="text-muted text-xs">
          {saveSuccess ? (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ Identity updated and saved
            </span>
          ) : (
            <span>Ready to commit changes to this LinkedIn identity</span>
          )}
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="bg-accent text-background hover:bg-accent-hover flex cursor-pointer items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving Identity...</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>Save Identity Changes</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
