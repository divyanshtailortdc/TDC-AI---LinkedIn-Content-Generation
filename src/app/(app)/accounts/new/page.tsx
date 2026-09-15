'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import {
  ArrowLeft,
  User,
  Building2,
  Package,
  Loader2,
  Plus,
  Trash2,
  Users,
  Briefcase
} from 'lucide-react'
import { createAccount } from '../actions'

type AccountType = 'personal' | 'company'

type OfferingItem = {
  name: string
  type: string
  tagline: string
  description: string
  url: string
}

type AudienceItem = {
  name: string
  painPointsText: string
  goalsText: string
}

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
    description: 'A brand, agency, startup, or specific product',
    icon: <Building2 className="w-5 h-5" />
  }
]

export default function NewAccountPage() {
  const [accountType, setAccountType] = useState<AccountType>('personal')
  const [offerings, setOfferings] = useState<OfferingItem[]>([])
  const [audiences, setAudiences] = useState<AudienceItem[]>([])

  const addOffering = () => {
    setOfferings([
      ...offerings,
      {
        name: '',
        type: 'service',
        tagline: '',
        description: '',
        url: ''
      }
    ])
  }

  const updateOffering = (index: number, field: keyof OfferingItem, val: string) => {
    const updated = [...offerings]
    const item = updated[index]
    if (item) {
      item[field] = val
      setOfferings(updated)
    }
  }

  const removeOffering = (index: number) => {
    setOfferings(offerings.filter((_, i) => i !== index))
  }

  const addAudience = () => {
    setAudiences([
      ...audiences,
      {
        name: '',
        painPointsText: '',
        goalsText: ''
      }
    ])
  }

  const updateAudience = (index: number, field: keyof AudienceItem, val: string) => {
    const updated = [...audiences]
    const item = updated[index]
    if (item) {
      item[field] = val
      setAudiences(updated)
    }
  }

  const removeAudience = (index: number) => {
    setAudiences(audiences.filter((_, i) => i !== index))
  }

  const serializedOfferings = JSON.stringify(offerings.filter(o => o.name.trim().length > 0))
  const serializedAudiences = JSON.stringify(
    audiences
      .filter(a => a.name.trim().length > 0)
      .map(a => ({
        name: a.name,
        painPoints: a.painPointsText.split('\n').map(s => s.trim()).filter(Boolean),
        goals: a.goalsText.split('\n').map(s => s.trim()).filter(Boolean)
      }))
  )

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-foreground mb-8 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to dashboard
      </Link>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Add a LinkedIn identity</h1>
        <p className="text-sm text-muted mt-1">
          This tells the AI who is speaking, what you sell, and who you're talking to.
        </p>
      </div>

      <form action={createAccount} className="space-y-10">
        <input type="hidden" name="accountType" value={accountType} />
        <input type="hidden" name="offeringsData" value={serializedOfferings} />
        <input type="hidden" name="audiencesData" value={serializedAudiences} />

        {/* Section 1 — Type picker */}
        <section className="rounded-xl border border-border bg-surface p-6">
          <label className="block text-sm font-semibold text-foreground mb-3">
            What kind of identity is this?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAccountType(opt.value)}
                className={`
                  flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all
                  ${accountType === opt.value
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-surface hover:border-accent/40'
                  }
                `}
              >
                <span className={`mt-0.5 shrink-0 ${accountType === opt.value ? 'text-accent' : 'text-muted'}`}>
                  {opt.icon}
                </span>
                <div>
                  <p className={`text-sm font-semibold ${accountType === opt.value ? 'text-accent' : 'text-foreground'}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-muted mt-0.5 leading-relaxed">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Section 2 — Core identity */}
        <section className="rounded-xl border border-border bg-surface p-6 space-y-5">
          <h2 className="text-base font-semibold text-foreground">Core identity</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field
              label="Display name"
              name="name"
              placeholder={accountType === 'personal' ? 'e.g. Aditya Sharma' : 'e.g. Acme AI'}
              required
            />

            <Field
              label="LinkedIn handle / slug"
              name="handle"
              placeholder="e.g. aditya-sharma"
              hint="Unique identifier slug"
              required
            />
          </div>

          <Field
            label="Headline"
            name="headline"
            placeholder={
              accountType === 'personal'
                ? 'e.g. Founder & CEO @ Acme | Scaling AI to 1M Users'
                : 'e.g. The Next-Gen Autonomous AI Engine for LinkedIn'
            }
            hint="Paste it verbatim — the AI uses this to match how you present yourself"
            required
          />

          <Field
            label="Bio / About"
            name="bio"
            type="textarea"
            placeholder="Paste your LinkedIn 'About' section or a short overview of your background, experience, and ethos."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {accountType === 'personal' && (
              <Field
                label="Current company / Project"
                name="company"
                placeholder="e.g. The Developer Company"
              />
            )}

            <Field
              label="Website URL"
              name="websiteUrl"
              type="url"
              placeholder="https://example.com"
            />
          </div>

          <Field
            label="Profile avatar URL"
            name="avatarUrl"
            type="url"
            placeholder="https://..."
            hint="Optional image URL for LinkedIn post previews"
          />
        </section>

        {/* Section 3 — Offerings (What you sell & Proof points) */}
        <section className="rounded-xl border border-border bg-surface p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-accent" />
                Offerings & Proof Points
              </h2>
              <p className="text-xs text-muted mt-0.5">
                What you sell, who it's for, and real proof points (metrics, named customers) to stop hallucinations.
              </p>
            </div>
            <button
              type="button"
              onClick={addOffering}
              className="flex items-center gap-1.5 text-xs font-medium text-accent hover:bg-accent/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add offering
            </button>
          </div>

          {offerings.length === 0 ? (
            <div className="py-6 text-center border border-dashed border-border rounded-lg">
              <p className="text-xs text-muted">No offerings added yet. Click &quot;Add offering&quot; to define what you sell.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {offerings.map((offering, idx) => (
                <div key={idx} className="p-4 rounded-lg border border-border bg-surface-hover space-y-3 relative">
                  <button
                    type="button"
                    onClick={() => removeOffering(idx)}
                    className="absolute top-3 right-3 text-muted hover:text-rose-500 transition-colors"
                    title="Remove offering"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-8">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">Offering Name</label>
                      <input
                        type="text"
                        value={offering.name}
                        onChange={(e) => updateOffering(idx, 'name', e.target.value)}
                        placeholder="e.g. AI Engineering Consulting"
                        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">Type</label>
                      <select
                        value={offering.type}
                        onChange={(e) => updateOffering(idx, 'type', e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                      >
                        <option value="service">Service / Agency</option>
                        <option value="product">SaaS / Software Product</option>
                        <option value="community">Community / Membership</option>
                        <option value="course">Course / Info Product</option>
                        <option value="lead_magnet">Free Lead Magnet / Newsletter</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Who it is for & Problem solved</label>
                    <input
                      type="text"
                      value={offering.tagline}
                      onChange={(e) => updateOffering(idx, 'tagline', e.target.value)}
                      placeholder="e.g. For Seed-Stage CTOs struggling with AI accuracy and latency"
                      className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1">Description & Proof Points (Real numbers & named logos)</label>
                    <textarea
                      rows={2}
                      value={offering.description}
                      onChange={(e) => updateOffering(idx, 'description', e.target.value)}
                      placeholder="e.g. Helped TechCorp reduce LLM cost by 62% in 3 weeks. 15 enterprise deployments completed."
                      className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent resize-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section 4 — Target Audiences */}
        <section className="rounded-xl border border-border bg-surface p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-accent" />
                Target Audiences
              </h2>
              <p className="text-xs text-muted mt-0.5">
                Define the job titles, seniority, pain points, and desires of who you write for.
              </p>
            </div>
            <button
              type="button"
              onClick={addAudience}
              className="flex items-center gap-1.5 text-xs font-medium text-accent hover:bg-accent/10 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add audience
            </button>
          </div>

          {audiences.length === 0 ? (
            <div className="py-6 text-center border border-dashed border-border rounded-lg">
              <p className="text-xs text-muted">No audiences added yet. Click &quot;Add audience&quot; to define your target reader.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {audiences.map((audience, idx) => (
                <div key={idx} className="p-4 rounded-lg border border-border bg-surface-hover space-y-3 relative">
                  <button
                    type="button"
                    onClick={() => removeAudience(idx)}
                    className="absolute top-3 right-3 text-muted hover:text-rose-500 transition-colors"
                    title="Remove audience"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="pr-8">
                    <label className="block text-xs font-medium text-foreground mb-1">Audience Segment & Seniority</label>
                    <input
                      type="text"
                      value={audience.name}
                      onChange={(e) => updateAudience(idx, 'name', e.target.value)}
                      placeholder="e.g. Senior Product Managers & VP of Product at B2B SaaS"
                      className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">Pain points (one per line)</label>
                      <textarea
                        rows={3}
                        value={audience.painPointsText}
                        onChange={(e) => updateAudience(idx, 'painPointsText', e.target.value)}
                        placeholder="e.g. AI prototypes failing in production&#10;High token costs&#10;Lack of evaluation benchmarks"
                        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-accent resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">Goals & Desires (one per line)</label>
                      <textarea
                        rows={3}
                        value={audience.goalsText}
                        onChange={(e) => updateAudience(idx, 'goalsText', e.target.value)}
                        placeholder="e.g. Ship reliable AI features faster&#10;Proven architectures they can show leadership&#10;Clear ROI"
                        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-accent resize-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Form actions */}
        <div className="flex items-center justify-end gap-4 pt-4 border-t border-border">
          <Link
            href="/"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </Link>
          <SubmitButton />
        </div>
      </form>
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
      <label className="block text-sm font-medium text-foreground mb-1.5">
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
      {hint && <p className="text-xs text-muted mt-1.5">{hint}</p>}
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed text-background text-sm font-medium transition-colors shadow-sm"
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Saving identity…
        </>
      ) : (
        'Save identity →'
      )}
    </button>
  )
}
