'use client'

import { PageHeader } from '@/components/page-header'
import { ArrowLeft, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { createAccount } from '../actions'

export default function NewAccountPage() {
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
        <div className="mx-auto max-w-3xl">
          <form
            action={createAccount}
            className="border-border bg-surface space-y-6 rounded-xl border p-6 sm:p-8"
          >
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field
                label="Display Name"
                name="name"
                placeholder="e.g. Aditya Sharma"
                required
              />
              <Field
                label="Company Name"
                name="company"
                placeholder="e.g. Acme AI"
                hint="Optional for personal brands."
              />
            </div>

            <Field
              label="Description"
              name="description"
              type="textarea"
              placeholder="Who you are and what you do, in a few sentences."
              required
            />

            <Field
              label="Target Audience"
              name="targetAudience"
              type="textarea"
              placeholder="e.g. Senior Product Managers and VPs of Product at B2B SaaS companies"
              required
            />

            <Field
              label="Offerings"
              name="offerings"
              type="textarea"
              placeholder="e.g. AI engineering consulting, a RAG evaluation toolkit, a weekly newsletter"
              required
            />

            <Field
              label="Industry"
              name="industry"
              placeholder="e.g. B2B SaaS, Healthcare, Fintech"
              required
            />

            <div className="border-border space-y-5 border-t pt-6">
              <h2 className="text-foreground text-sm font-semibold">
                Online Presence{' '}
                <span className="text-muted font-normal">(Optional)</span>
              </h2>

              <Field
                label="LinkedIn Profile / Page URL"
                name="linkedinUrl"
                type="url"
                placeholder="https://www.linkedin.com/in/your-name"
              />

              <Field
                label="Website URL"
                name="websiteUrl"
                type="url"
                placeholder="https://example.com"
              />
            </div>

            <div className="border-border flex items-center justify-end gap-4 border-t pt-6">
              <Link
                href="/"
                className="text-muted hover:text-foreground text-sm transition-colors"
              >
                Cancel
              </Link>
              <SubmitButton />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

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
    'w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors'

  return (
    <div>
      <label
        htmlFor={name}
        className="text-foreground mb-1.5 block text-sm font-medium"
      >
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          id={name}
          name={name}
          placeholder={placeholder}
          rows={3}
          required={required}
          className={`${baseClass} resize-none`}
        />
      ) : (
        <input
          id={name}
          type={type}
          name={name}
          placeholder={placeholder}
          required={required}
          className={baseClass}
        />
      )}
      {hint && <p className="text-muted mt-1.5 text-xs">{hint}</p>}
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
