'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { ArrowLeft, User, Building2, Package, Loader2 } from 'lucide-react'
import { createAccount } from '../actions'

type AccountType = 'personal' | 'company'

const typeOptions: { value: AccountType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'personal',
    label: 'Person',
    description: 'You as an individual — founder, creator, or executive',
    icon: <User className="w-5 h-5" />
  },
  {
    value: 'company',
    label: 'Company / Product',
    description: 'A brand, startup, or specific product',
    icon: <Building2 className="w-5 h-5" />
  }
]

export default function NewAccountPage() {
  const [accountType, setAccountType] = useState<AccountType>('personal')

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)] mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to dashboard
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Add a LinkedIn identity</h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          This tells the AI who is speaking, who they're talking to, and how they sound.
        </p>
      </div>

      <form action={createAccount} className="space-y-8">
        {/* Hidden field for accountType */}
        <input type="hidden" name="accountType" value={accountType} />

        {/* Step 1 — Type picker */}
        <section>
          <label className="block text-sm font-semibold text-[var(--foreground)] mb-3">
            What kind of identity is this?
          </label>
          <div className="grid grid-cols-2 gap-3">
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAccountType(opt.value)}
                className={`
                  flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all
                  ${accountType === opt.value
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                    : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40'
                  }
                `}
              >
                <span className={`mt-0.5 shrink-0 ${accountType === opt.value ? 'text-[var(--accent)]' : 'text-[var(--muted)]'}`}>
                  {opt.icon}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${accountType === opt.value ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Step 2 — Core identity */}
        <section className="space-y-5">
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Core identity</h2>

          <Field
            label="Display name"
            name="name"
            placeholder={accountType === 'personal' ? 'e.g. Aditya Sharma' : 'e.g. The Developer Company'}
            required
          />

          <Field
            label="LinkedIn handle / slug"
            name="handle"
            placeholder="e.g. aditya-sharma or thedevelopercompany"
            hint="Used as a unique identifier — not your password, just the URL slug"
            required
          />

          <Field
            label="Headline"
            name="headline"
            placeholder="Your real LinkedIn headline, verbatim"
            hint="Paste it exactly — the AI uses this to understand how to introduce you"
            required
          />

          <Field
            label="Bio / About"
            name="bio"
            type="textarea"
            placeholder="Your LinkedIn 'About' section or a short background summary"
          />

          {accountType === 'personal' && (
            <Field
              label="Current company"
              name="company"
              placeholder="e.g. The Developer Company"
            />
          )}

          <Field
            label="Website URL"
            name="websiteUrl"
            type="url"
            placeholder="https://thedevelopercompany.com"
          />

          <Field
            label="Profile image URL"
            name="avatarUrl"
            type="url"
            placeholder="https://..."
            hint="Optional — used in the LinkedIn preview"
          />
        </section>

        {/* Submit */}
        <div className="flex items-center justify-end gap-4 pt-4 border-t border-[var(--border)]">
          <Link
            href="/"
            className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
          >
            Cancel
          </Link>
          <SubmitButton />
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  hint,
  required
}: {
  label: string
  name: string
  type?: 'text' | 'url' | 'textarea'
  placeholder?: string
  hint?: string
  required?: boolean
}) {
  const baseClass =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors'

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          name={name}
          placeholder={placeholder}
          rows={4}
          className={`${baseClass} resize-none`}
        />
      ) : (
        <input
          type={type}
          name={name}
          placeholder={placeholder}
          required={required}
          className={baseClass}
        />
      )}
      {hint && <p className="text-xs text-[var(--muted)] mt-1.5">{hint}</p>}
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Saving…
        </>
      ) : (
        'Save identity →'
      )}
    </button>
  )
}
