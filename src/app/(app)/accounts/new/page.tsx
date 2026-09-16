'use client'

import { PageHeader } from '@/components/page-header'
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Loader2,
  Plus,
  Trash2,
  User,
  Users
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'
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

const typeOptions: {
  value: AccountType
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'personal',
    label: 'Person',
    description: 'You as an individual — founder, creator, or executive',
    icon: <User className="h-5 w-5" />
  },
  {
    value: 'company',
    label: 'Company / Product',
    description: 'A brand, agency, startup, or specific product',
    icon: <Building2 className="h-5 w-5" />
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

  const updateOffering = (
    index: number,
    field: keyof OfferingItem,
    val: string
  ) => {
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

  const updateAudience = (
    index: number,
    field: keyof AudienceItem,
    val: string
  ) => {
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

  const serializedOfferings = JSON.stringify(
    offerings.filter(o => o.name.trim().length > 0)
  )
  const serializedAudiences = JSON.stringify(
    audiences
      .filter(a => a.name.trim().length > 0)
      .map(a => ({
        name: a.name,
        painPoints: a.painPointsText
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean),
        goals: a.goalsText
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
      }))
  )

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Add a LinkedIn identity"
        description="This tells the AI who is speaking, what you sell, and who you're talking to."
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
        <div className="mx-auto max-w-7xl">
          <form action={createAccount} className="space-y-10">
            <input type="hidden" name="accountType" value={accountType} />
            <input
              type="hidden"
              name="offeringsData"
              value={serializedOfferings}
            />
            <input
              type="hidden"
              name="audiencesData"
              value={serializedAudiences}
            />

            {/* Section 1 — Type picker */}
            <section className="border-border bg-surface rounded-xl border p-6">
              <label className="text-foreground mb-3 block text-sm font-semibold">
                What kind of identity is this?
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {typeOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setAccountType(opt.value)}
                    className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                      accountType === opt.value
                        ? 'border-accent bg-accent/5'
                        : 'border-border bg-surface hover:border-accent/40'
                    } `}
                  >
                    <span
                      className={`mt-0.5 shrink-0 ${accountType === opt.value ? 'text-accent' : 'text-muted'}`}
                    >
                      {opt.icon}
                    </span>
                    <div>
                      <p
                        className={`text-sm font-semibold ${accountType === opt.value ? 'text-accent' : 'text-foreground'}`}
                      >
                        {opt.label}
                      </p>
                      <p className="text-muted mt-0.5 text-xs leading-relaxed">
                        {opt.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {/* Section 2 — Core identity */}
            <section className="border-border bg-surface space-y-5 rounded-xl border p-6">
              <h2 className="text-foreground text-base font-semibold">
                Core identity
              </h2>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field
                  label="Display name"
                  name="name"
                  placeholder={
                    accountType === 'personal'
                      ? 'e.g. Aditya Sharma'
                      : 'e.g. Acme AI'
                  }
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

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
            <section className="border-border bg-surface space-y-5 rounded-xl border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
                    <Briefcase className="text-accent h-4 w-4" />
                    Offerings & Proof Points
                  </h2>
                  <p className="text-muted mt-0.5 text-xs">
                    What you sell, who it's for, and real proof points (metrics,
                    named customers) to stop hallucinations.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addOffering}
                  className="text-accent hover:bg-accent/10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add offering
                </button>
              </div>

              {offerings.length === 0 ? (
                <div className="border-border rounded-lg border border-dashed py-6 text-center">
                  <p className="text-muted text-xs">
                    No offerings added yet. Click &quot;Add offering&quot; to
                    define what you sell.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {offerings.map((offering, idx) => (
                    <div
                      key={idx}
                      className="border-border bg-surface-hover relative space-y-3 rounded-lg border p-4"
                    >
                      <button
                        type="button"
                        onClick={() => removeOffering(idx)}
                        className="text-muted absolute top-3 right-3 transition-colors hover:text-rose-500"
                        title="Remove offering"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>

                      <div className="grid grid-cols-1 gap-3 pr-8 sm:grid-cols-2">
                        <div>
                          <label className="text-foreground mb-1 block text-xs font-medium">
                            Offering Name
                          </label>
                          <input
                            type="text"
                            value={offering.name}
                            onChange={e =>
                              updateOffering(idx, 'name', e.target.value)
                            }
                            placeholder="e.g. AI Engineering Consulting"
                            className="border-border bg-surface text-foreground focus:ring-accent w-full rounded-md border px-3 py-1.5 text-sm focus:ring-1"
                          />
                        </div>
                        <div>
                          <label className="text-foreground mb-1 block text-xs font-medium">
                            Type
                          </label>
                          <select
                            value={offering.type}
                            onChange={e =>
                              updateOffering(idx, 'type', e.target.value)
                            }
                            className="border-border bg-surface text-foreground focus:ring-accent w-full rounded-md border px-3 py-1.5 text-sm focus:ring-1"
                          >
                            <option value="service">Service / Agency</option>
                            <option value="product">
                              SaaS / Software Product
                            </option>
                            <option value="community">
                              Community / Membership
                            </option>
                            <option value="course">
                              Course / Info Product
                            </option>
                            <option value="lead_magnet">
                              Free Lead Magnet / Newsletter
                            </option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="text-foreground mb-1 block text-xs font-medium">
                          Who it is for & Problem solved
                        </label>
                        <textarea
                          rows={2}
                          value={offering.tagline}
                          onChange={e =>
                            updateOffering(idx, 'tagline', e.target.value)
                          }
                          placeholder="e.g. For Seed-Stage CTOs struggling with AI accuracy and latency"
                          className="border-border bg-surface text-foreground focus:ring-accent w-full resize-y rounded-md border px-3 py-1.5 text-sm focus:ring-1"
                        />
                      </div>

                      <div>
                        <label className="text-foreground mb-1 block text-xs font-medium">
                          Description & Proof Points (Real numbers & named
                          logos)
                        </label>
                        <textarea
                          rows={2}
                          value={offering.description}
                          onChange={e =>
                            updateOffering(idx, 'description', e.target.value)
                          }
                          placeholder="e.g. Helped TechCorp reduce LLM cost by 62% in 3 weeks. 15 enterprise deployments completed."
                          className="border-border bg-surface text-foreground focus:ring-accent w-full resize-y rounded-md border px-3 py-1.5 text-sm focus:ring-1"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Section 4 — Target Audiences */}
            <section className="border-border bg-surface space-y-5 rounded-xl border p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-foreground flex items-center gap-2 text-base font-semibold">
                    <Users className="text-accent h-4 w-4" />
                    Target Audiences
                  </h2>
                  <p className="text-muted mt-0.5 text-xs">
                    Define the job titles, seniority, pain points, and desires
                    of who you write for.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={addAudience}
                  className="text-accent hover:bg-accent/10 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add audience
                </button>
              </div>

              {audiences.length === 0 ? (
                <div className="border-border rounded-lg border border-dashed py-6 text-center">
                  <p className="text-muted text-xs">
                    No audiences added yet. Click &quot;Add audience&quot; to
                    define your target reader.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {audiences.map((audience, idx) => (
                    <div
                      key={idx}
                      className="border-border bg-surface-hover relative space-y-3 rounded-lg border p-4"
                    >
                      <button
                        type="button"
                        onClick={() => removeAudience(idx)}
                        className="text-muted absolute top-3 right-3 transition-colors hover:text-rose-500"
                        title="Remove audience"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>

                      <div className="pr-8">
                        <label className="text-foreground mb-1 block text-xs font-medium">
                          Audience Segment & Seniority
                        </label>
                        <input
                          type="text"
                          value={audience.name}
                          onChange={e =>
                            updateAudience(idx, 'name', e.target.value)
                          }
                          placeholder="e.g. Senior Product Managers & VP of Product at B2B SaaS"
                          className="border-border bg-surface text-foreground focus:ring-accent w-full rounded-md border px-3 py-1.5 text-sm focus:ring-1"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className="text-foreground mb-1 block text-xs font-medium">
                            Pain points (one per line)
                          </label>
                          <textarea
                            rows={3}
                            value={audience.painPointsText}
                            onChange={e =>
                              updateAudience(
                                idx,
                                'painPointsText',
                                e.target.value
                              )
                            }
                            placeholder="e.g. AI prototypes failing in production&#10;High token costs&#10;Lack of evaluation benchmarks"
                            className="border-border bg-surface text-foreground focus:ring-accent w-full resize-none rounded-md border px-3 py-1.5 text-xs focus:ring-1"
                          />
                        </div>
                        <div>
                          <label className="text-foreground mb-1 block text-xs font-medium">
                            Goals & Desires (one per line)
                          </label>
                          <textarea
                            rows={3}
                            value={audience.goalsText}
                            onChange={e =>
                              updateAudience(idx, 'goalsText', e.target.value)
                            }
                            placeholder="e.g. Ship reliable AI features faster&#10;Proven architectures they can show leadership&#10;Clear ROI"
                            className="border-border bg-surface text-foreground focus:ring-accent w-full resize-none rounded-md border px-3 py-1.5 text-xs focus:ring-1"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Form actions */}
            <div className="border-border flex items-center justify-end gap-4 border-t pt-4">
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
      <label className="text-foreground mb-1.5 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
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
