'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  User,
  Building2,
  Briefcase,
  Users,
  Plus,
  Trash2,
  Save,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  ExternalLink
} from 'lucide-react'
import { updateAccountAction } from '../actions'

type AccountType = 'personal' | 'company'

export interface OfferingItem {
  id?: string
  name: string
  type: string
  tagline: string
  description: string
  url: string
}

export interface AudienceItem {
  id?: string
  name: string
  painPointsText: string
  goalsText: string
}

interface EditIdentityFormProps {
  account: {
    id: string
    name: string
    handle: string
    headline: string
    bio?: string | null
    avatarUrl?: string | null
    accountType: string
    company?: string | null
    websiteUrl?: string | null
  }
  initialOfferings: Array<{
    id: string
    name: string
    type: string
    tagline?: string | null
    description?: string | null
    url?: string | null
  }>
  initialAudiences: Array<{
    id: string
    name: string
    painPoints?: string[] | null
    goals?: string[] | null
  }>
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

export function EditIdentityForm({
  account,
  initialOfferings,
  initialAudiences
}: EditIdentityFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Form states
  const [accountType, setAccountType] = useState<AccountType>(
    (account.accountType as AccountType) || 'personal'
  )
  const [name, setName] = useState(account.name || '')
  const [handle, setHandle] = useState(account.handle || '')
  const [headline, setHeadline] = useState(account.headline || '')
  const [bio, setBio] = useState(account.bio || '')
  const [company, setCompany] = useState(account.company || '')
  const [websiteUrl, setWebsiteUrl] = useState(account.websiteUrl || '')
  const [avatarUrl, setAvatarUrl] = useState(account.avatarUrl || '')

  // Offerings state
  const [offerings, setOfferings] = useState<OfferingItem[]>(
    initialOfferings.map(o => ({
      id: o.id,
      name: o.name,
      type: o.type || 'service',
      tagline: o.tagline || '',
      description: o.description || '',
      url: o.url || ''
    }))
  )

  // Audiences state
  const [audiences, setAudiences] = useState<AudienceItem[]>(
    initialAudiences.map(a => ({
      id: a.id,
      name: a.name,
      painPointsText: Array.isArray(a.painPoints) ? a.painPoints.join('\n') : '',
      goalsText: Array.isArray(a.goals) ? a.goals.join('\n') : ''
    }))
  )

  const clearFieldError = (fieldName: string) => {
    if (fieldErrors[fieldName]) {
      setFieldErrors(prev => {
        const next = { ...prev }
        delete next[fieldName]
        return next
      })
    }
    if (error) setError(null)
  }

  // Offering helpers
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

  // Audience helpers
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

  // Save changes
  const handleSave = () => {
    setError(null)
    setSaveSuccess(false)

    // Client validation
    const errors: Record<string, string> = {}
    if (!name.trim()) {
      errors.name = 'Display name is required'
    }
    const cleanHandle = handle.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    if (!cleanHandle) {
      errors.handle = 'LinkedIn handle is required'
    }
    if (!headline.trim()) {
      errors.headline = 'Headline is required'
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields marked with *.')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }

    setFieldErrors({})

    startTransition(async () => {
      const res = await updateAccountAction({
        id: account.id,
        name: name.trim(),
        accountType,
        handle: cleanHandle,
        headline: headline.trim(),
        bio: bio.trim() || undefined,
        company: company.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
        offerings: offerings
          .filter(o => o.name.trim().length > 0)
          .map(o => ({
            name: o.name.trim(),
            type: o.type,
            tagline: o.tagline?.trim() || undefined,
            description: o.description?.trim() || undefined,
            url: o.url?.trim() || undefined
          })),
        audiences: audiences
          .filter(a => a.name.trim().length > 0)
          .map(a => ({
            name: a.name.trim(),
            painPoints: a.painPointsText
              .split('\n')
              .map(p => p.trim())
              .filter(Boolean),
            goals: a.goalsText
              .split('\n')
              .map(g => g.trim())
              .filter(Boolean)
          }))
      })

      if (res.success) {
        setSaveSuccess(true)
        router.refresh()
        setTimeout(() => setSaveSuccess(false), 4000)
      } else {
        setError(res.error || 'Failed to update identity')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    })
  }

  return (
    <div className="space-y-8 mt-8">
      {/* Notifications */}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-400 animate-in fade-in duration-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold leading-relaxed">{error}</p>
              {Object.keys(fieldErrors).length > 0 && (
                <p className="text-[11px] opacity-85">
                  Please review the highlighted fields below.
                </p>
              )}
            </div>
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

      {saveSuccess && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-600 dark:text-emerald-400 animate-in fade-in duration-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-medium">
            LinkedIn Identity updated successfully! Profile header and setup details are synced.
          </p>
        </div>
      )}

      {/* Section 1 — Identity Type */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xs">
        <label className="block text-sm font-semibold text-[var(--foreground)] mb-1">
          What kind of Identity is this?
        </label>
        <p className="text-xs text-[var(--muted)] mb-4">
          Defines whether the AI drafts content from an executive individual perspective or a brand/company voice.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {typeOptions.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAccountType(opt.value)}
              className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                accountType === opt.value
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/40'
              }`}
            >
              <span
                className={`mt-0.5 shrink-0 ${
                  accountType === opt.value
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--muted)]'
                }`}
              >
                {opt.icon}
              </span>
              <div>
                <p
                  className={`text-sm font-semibold ${
                    accountType === opt.value
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--foreground)]'
                  }`}
                >
                  {opt.label}
                </p>
                <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">
                  {opt.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Section 2 — Core identity */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              Core identity
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Essential background information used by AI across ideation, hooks, and drafts.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-[var(--muted)] uppercase">
            ID: {account.id.slice(0, 8)}...
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
              Display name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => {
                setName(e.target.value)
                clearFieldError('name')
              }}
              placeholder={
                accountType === 'personal'
                  ? 'e.g. Aditya Sharma'
                  : 'e.g. Acme AI'
              }
              className={`w-full rounded-lg border bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors ${
                fieldErrors.name
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-[var(--border)]'
              }`}
            />
            {fieldErrors.name && (
              <p className="text-xs text-red-500 mt-1">{fieldErrors.name}</p>
            )}
          </div>

          {/* LinkedIn handle / slug */}
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
              LinkedIn handle / slug <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={handle}
              onChange={e => {
                setHandle(e.target.value)
                clearFieldError('handle')
              }}
              placeholder="e.g. aditya-sharma"
              className={`w-full rounded-lg border bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors ${
                fieldErrors.handle
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-[var(--border)]'
              }`}
            />
            <p className="text-xs text-[var(--muted)] mt-1.5">
              Unique identifier slug for this identity
            </p>
            {fieldErrors.handle && (
              <p className="text-xs text-red-500 mt-1">{fieldErrors.handle}</p>
            )}
          </div>
        </div>

        {/* Headline */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
            Headline <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={headline}
            onChange={e => {
              setHeadline(e.target.value)
              clearFieldError('headline')
            }}
            placeholder={
              accountType === 'personal'
                ? 'e.g. Founder & CEO @ Acme | Scaling AI to 1M Users'
                : 'e.g. The Autonomous LinkedIn AI Engine for High-Growth Founders'
            }
            className={`w-full rounded-lg border bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors ${
              fieldErrors.headline
                ? 'border-red-500/60 ring-1 ring-red-500/30'
                : 'border-[var(--border)]'
            }`}
          />
          <p className="text-xs text-[var(--muted)] mt-1.5">
            Paste it verbatim — the AI uses this to match how you present yourself.
          </p>
          {fieldErrors.headline && (
            <p className="text-xs text-red-500 mt-1">{fieldErrors.headline}</p>
          )}
        </div>

        {/* Bio / About */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
            Bio / About
          </label>
          <textarea
            rows={4}
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Paste your LinkedIn 'About' section or a short overview of your background, experience, and ethos."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors resize-none"
          />
        </div>

        {/* Company & Website URL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {accountType === 'personal' ? (
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                Current company / Project
              </label>
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="e.g. The Developer Company"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
                Parent Company / Brand
              </label>
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
              Website URL
            </label>
            <input
              type="url"
              value={websiteUrl}
              onChange={e => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
            />
          </div>
        </div>

        {/* Avatar URL */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
            Profile avatar URL
          </label>
          <input
            type="url"
            value={avatarUrl}
            onChange={e => setAvatarUrl(e.target.value)}
            placeholder="https://images.unsplash.com/... or https://media.licdn.com/..."
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--muted)]/50 focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]/40 focus:border-[var(--accent)] transition-colors"
          />
          <p className="text-xs text-[var(--muted)] mt-1.5">
            Image URL used for avatar and LinkedIn post previews.
          </p>
        </div>
      </section>

      {/* Section 3 — Offerings (What you sell & Proof points) */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-[var(--accent)]" />
              Offerings & Proof Points
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              What you sell, who it is for, and real proof points (metrics, customers, logos) to prevent hallucinations.
            </p>
          </div>
          <button
            type="button"
            onClick={addOffering}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg transition-colors border border-[var(--accent)]/20"
          >
            <Plus className="w-3.5 h-3.5" />
            Add offering
          </button>
        </div>

        {offerings.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-[var(--border)] rounded-xl bg-[var(--background)]/50">
            <p className="text-xs text-[var(--muted)]">
              No offerings added yet. Click &quot;Add offering&quot; to define what you sell.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {offerings.map((offering, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] space-y-3 relative shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => removeOffering(idx)}
                  className="absolute top-3 right-3 text-[var(--muted)] hover:text-rose-500 transition-colors p-1"
                  title="Remove offering"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-8">
                  <div>
                    <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                      Offering Name
                    </label>
                    <input
                      type="text"
                      value={offering.name}
                      onChange={e => updateOffering(idx, 'name', e.target.value)}
                      placeholder="e.g. AI Engineering Consulting"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                      Type
                    </label>
                    <select
                      value={offering.type}
                      onChange={e => updateOffering(idx, 'type', e.target.value)}
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)]"
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
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Who it is for &amp; Problem solved
                  </label>
                  <input
                    type="text"
                    value={offering.tagline}
                    onChange={e => updateOffering(idx, 'tagline', e.target.value)}
                    placeholder="e.g. For Seed-Stage CTOs struggling with AI accuracy and latency"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Description &amp; Proof Points (Real numbers, client results)
                  </label>
                  <textarea
                    rows={2}
                    value={offering.description}
                    onChange={e => updateOffering(idx, 'description', e.target.value)}
                    placeholder="e.g. Helped TechCorp reduce LLM cost by 62% in 3 weeks. 15 enterprise deployments completed."
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)] resize-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Offering URL (optional)
                  </label>
                  <input
                    type="url"
                    value={offering.url}
                    onChange={e => updateOffering(idx, 'url', e.target.value)}
                    placeholder="https://acme.com/services"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 4 — Target Audiences */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-5 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
              <Users className="w-4 h-4 text-[var(--accent)]" />
              Target Audiences
            </h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Define the job titles, seniority, pain points, and desires of who you write for.
            </p>
          </div>
          <button
            type="button"
            onClick={addAudience}
            className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 px-3 py-1.5 rounded-lg transition-colors border border-[var(--accent)]/20"
          >
            <Plus className="w-3.5 h-3.5" />
            Add audience
          </button>
        </div>

        {audiences.length === 0 ? (
          <div className="py-8 text-center border border-dashed border-[var(--border)] rounded-xl bg-[var(--background)]/50">
            <p className="text-xs text-[var(--muted)]">
              No audiences added yet. Click &quot;Add audience&quot; to define your target reader.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {audiences.map((audience, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] space-y-3 relative shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => removeAudience(idx)}
                  className="absolute top-3 right-3 text-[var(--muted)] hover:text-rose-500 transition-colors p-1"
                  title="Remove audience"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <div className="pr-8">
                  <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                    Audience Segment &amp; Seniority
                  </label>
                  <input
                    type="text"
                    value={audience.name}
                    onChange={e => updateAudience(idx, 'name', e.target.value)}
                    placeholder="e.g. Senior Product Managers & VP of Product at B2B SaaS"
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                      Pain points (one per line)
                    </label>
                    <textarea
                      rows={3}
                      value={audience.painPointsText}
                      onChange={e =>
                        updateAudience(idx, 'painPointsText', e.target.value)
                      }
                      placeholder="e.g. AI prototypes failing in production&#10;High token costs&#10;Lack of evaluation benchmarks"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)] resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                      Goals &amp; Desires (one per line)
                    </label>
                    <textarea
                      rows={3}
                      value={audience.goalsText}
                      onChange={e =>
                        updateAudience(idx, 'goalsText', e.target.value)
                      }
                      placeholder="e.g. Ship reliable AI features faster&#10;Proven architectures they can show leadership&#10;Clear ROI"
                      className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--foreground)] focus:ring-1 focus:ring-[var(--accent)] resize-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Sticky Save Footer */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-4 shadow-lg backdrop-blur-md">
        <div className="text-xs text-[var(--muted)]">
          {saveSuccess ? (
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ Core identity updated and saved
            </span>
          ) : (
            <span>Ready to commit changes to this LinkedIn identity</span>
          )}
        </div>

        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="flex items-center gap-2 rounded-xl bg-[var(--accent)] px-6 py-2.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
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
