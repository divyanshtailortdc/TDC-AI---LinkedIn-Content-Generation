'use client'

import {
  AlertCircle,
  Briefcase,
  Building2,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Trash2,
  User,
  Users,
  X
} from 'lucide-react'
import { DeleteIdentityDialog } from '@/components/delete-identity-dialog'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
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
      painPointsText: Array.isArray(a.painPoints)
        ? a.painPoints.join('\n')
        : '',
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

  // Save changes
  const handleSave = () => {
    setError(null)
    setSaveSuccess(false)

    // Client validation
    const errors: Record<string, string> = {}
    if (!name.trim()) {
      errors.name = 'Display name is required'
    }
    const cleanHandle = handle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
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
    <div className="mt-8 space-y-8">
      {/* Notifications */}
      {error && (
        <div className="animate-in fade-in flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 duration-200 dark:text-red-400">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="leading-relaxed font-semibold">{error}</p>
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
        <div className="animate-in fade-in flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-600 duration-200 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-medium">
            LinkedIn Identity updated successfully! Profile header and setup
            details are synced.
          </p>
        </div>
      )}

      {/* Section 1 — Identity Type */}
      <section className="rounded-xl border border-border bg-surface p-6 shadow-xs">
        <label className="mb-1 block text-sm font-semibold text-foreground">
          What kind of Identity is this?
        </label>
        <p className="mb-4 text-xs text-muted">
          Defines whether the AI drafts content from an executive individual
          perspective or a brand/company voice.
        </p>

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
              }`}
            >
              <span
                className={`mt-0.5 shrink-0 ${
                  accountType === opt.value
                    ? 'text-accent'
                    : 'text-muted'
                }`}
              >
                {opt.icon}
              </span>
              <div>
                <p
                  className={`text-sm font-semibold ${
                    accountType === opt.value
                      ? 'text-accent'
                      : 'text-foreground'
                  }`}
                >
                  {opt.label}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {opt.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Section 2 — Core identity */}
      <section className="space-y-5 rounded-xl border border-border bg-surface p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Core identity
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Essential background information used by AI across ideation,
              hooks, and drafts.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-muted uppercase">
            ID: {account.id.slice(0, 8)}...
          </span>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {/* Display Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
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
              className={`w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden ${
                fieldErrors.name
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>
            )}
          </div>

          {/* LinkedIn handle / slug */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
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
              className={`w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden ${
                fieldErrors.handle
                  ? 'border-red-500/60 ring-1 ring-red-500/30'
                  : 'border-border'
              }`}
            />
            <p className="mt-1.5 text-xs text-muted">
              Unique identifier slug for this identity
            </p>
            {fieldErrors.handle && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.handle}</p>
            )}
          </div>
        </div>

        {/* Headline */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
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
            className={`w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden ${
              fieldErrors.headline
                ? 'border-red-500/60 ring-1 ring-red-500/30'
                : 'border-border'
            }`}
          />
          <p className="mt-1.5 text-xs text-muted">
            Paste it verbatim — the AI uses this to match how you present
            yourself.
          </p>
          {fieldErrors.headline && (
            <p className="mt-1 text-xs text-red-500">{fieldErrors.headline}</p>
          )}
        </div>

        {/* Bio / About */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Bio / About
          </label>
          <textarea
            rows={4}
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder="Paste your LinkedIn 'About' section or a short overview of your background, experience, and ethos."
            className="w-full resize-none rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden"
          />
        </div>

        {/* Company & Website URL */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {accountType === 'personal' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Current company / Project
              </label>
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="e.g. The Developer Company"
                className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Parent Company / Brand
              </label>
              <input
                type="text"
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Website URL
            </label>
            <input
              type="url"
              value={websiteUrl}
              onChange={e => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden"
            />
          </div>
        </div>

        {/* Avatar URL */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Profile avatar URL
          </label>
          <input
            type="url"
            value={avatarUrl}
            onChange={e => setAvatarUrl(e.target.value)}
            placeholder="https://images.unsplash.com/... or https://media.licdn.com/..."
            className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-2 focus:ring-accent/40 focus:outline-hidden"
          />
          <p className="mt-1.5 text-xs text-muted">
            Image URL used for avatar and LinkedIn post previews.
          </p>
        </div>
      </section>

      {/* Section 3 — Offerings (What you sell & Proof points) */}
      <section className="space-y-5 rounded-xl border border-border bg-surface p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Briefcase className="h-4 w-4 text-accent" />
              Offerings & Proof Points
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              What you sell, who it is for, and real proof points (metrics,
              customers, logos) to prevent hallucinations.
            </p>
          </div>
          <button
            type="button"
            onClick={addOffering}
            className="flex items-center gap-1.5 rounded-lg border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
          >
            <Plus className="h-3.5 w-3.5" />
            Add offering
          </button>
        </div>

        {offerings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background/50 py-8 text-center">
            <p className="text-xs text-muted">
              No offerings added yet. Click &quot;Add offering&quot; to define
              what you sell.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {offerings.map((offering, idx) => (
              <div
                key={idx}
                className="relative space-y-3 rounded-xl border border-border bg-surface-hover p-4 shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => removeOffering(idx)}
                  className="absolute top-3 right-3 p-1 text-muted transition-colors hover:text-rose-500"
                  title="Remove offering"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                <div className="grid grid-cols-1 gap-3 pr-8 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">
                      Offering Name
                    </label>
                    <input
                      type="text"
                      value={offering.name}
                      onChange={e =>
                        updateOffering(idx, 'name', e.target.value)
                      }
                      placeholder="e.g. AI Engineering Consulting"
                      className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">
                      Type
                    </label>
                    <select
                      value={offering.type}
                      onChange={e =>
                        updateOffering(idx, 'type', e.target.value)
                      }
                      className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                    >
                      <option value="service">Service / Agency</option>
                      <option value="product">SaaS / Software Product</option>
                      <option value="community">Community / Membership</option>
                      <option value="course">Course / Info Product</option>
                      <option value="lead_magnet">
                        Free Lead Magnet / Newsletter
                      </option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    Who it is for &amp; Problem solved
                  </label>
                  <input
                    type="text"
                    value={offering.tagline}
                    onChange={e =>
                      updateOffering(idx, 'tagline', e.target.value)
                    }
                    placeholder="e.g. For Seed-Stage CTOs struggling with AI accuracy and latency"
                    className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    Description &amp; Proof Points (Real numbers, client
                    results)
                  </label>
                  <textarea
                    rows={2}
                    value={offering.description}
                    onChange={e =>
                      updateOffering(idx, 'description', e.target.value)
                    }
                    placeholder="e.g. Helped TechCorp reduce LLM cost by 62% in 3 weeks. 15 enterprise deployments completed."
                    className="w-full resize-none rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    Offering URL (optional)
                  </label>
                  <input
                    type="url"
                    value={offering.url}
                    onChange={e => updateOffering(idx, 'url', e.target.value)}
                    placeholder="https://acme.com/services"
                    className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 4 — Target Audiences */}
      <section className="space-y-5 rounded-xl border border-border bg-surface p-6 shadow-xs">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Users className="h-4 w-4 text-accent" />
              Target Audiences
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Define the job titles, seniority, pain points, and desires of who
              you write for.
            </p>
          </div>
          <button
            type="button"
            onClick={addAudience}
            className="flex items-center gap-1.5 rounded-lg border border-accent/20 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
          >
            <Plus className="h-3.5 w-3.5" />
            Add audience
          </button>
        </div>

        {audiences.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background/50 py-8 text-center">
            <p className="text-xs text-muted">
              No audiences added yet. Click &quot;Add audience&quot; to define
              your target reader.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {audiences.map((audience, idx) => (
              <div
                key={idx}
                className="relative space-y-3 rounded-xl border border-border bg-surface-hover p-4 shadow-2xs"
              >
                <button
                  type="button"
                  onClick={() => removeAudience(idx)}
                  className="absolute top-3 right-3 p-1 text-muted transition-colors hover:text-rose-500"
                  title="Remove audience"
                >
                  <Trash2 className="h-4 w-4" />
                </button>

                <div className="pr-8">
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    Audience Segment &amp; Seniority
                  </label>
                  <input
                    type="text"
                    value={audience.name}
                    onChange={e => updateAudience(idx, 'name', e.target.value)}
                    placeholder="e.g. Senior Product Managers & VP of Product at B2B SaaS"
                    className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">
                      Pain points (one per line)
                    </label>
                    <textarea
                      rows={3}
                      value={audience.painPointsText}
                      onChange={e =>
                        updateAudience(idx, 'painPointsText', e.target.value)
                      }
                      placeholder="e.g. AI prototypes failing in production&#10;High token costs&#10;Lack of evaluation benchmarks"
                      className="w-full resize-none rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">
                      Goals &amp; Desires (one per line)
                    </label>
                    <textarea
                      rows={3}
                      value={audience.goalsText}
                      onChange={e =>
                        updateAudience(idx, 'goalsText', e.target.value)
                      }
                      placeholder="e.g. Ship reliable AI features faster&#10;Proven architectures they can show leadership&#10;Clear ROI"
                      className="w-full resize-none rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Danger Zone */}
      <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.02] p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">
              Delete Identity
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Permanently remove this LinkedIn identity and all associated voice
              profiles, knowledge bases, posts, and campaign data.
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

      {/* Sticky Save Footer */}
      <div className="sticky bottom-4 z-20 flex items-center justify-between rounded-2xl border border-border bg-surface/95 p-4 shadow-lg backdrop-blur-md">
        <div className="text-xs text-muted">
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
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-6 py-2.5 text-xs font-semibold text-background shadow-sm transition-all hover:bg-accent-hover disabled:opacity-50"
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
