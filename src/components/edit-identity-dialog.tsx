'use client'

import { updateAccountAction } from '@/app/(app)/accounts/actions'
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  User,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'

type AccountType = 'personal' | 'company'

interface EditIdentityDialogProps {
  account: {
    id: string
    name: string
    handle: string
    headline: string
    accountType: string
    bio?: string | null
    avatarUrl?: string | null
    company?: string | null
    websiteUrl?: string | null
  }
}

export function EditIdentityDialog({ account }: EditIdentityDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState(false)
  const router = useRouter()

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

  // Reset states whenever dialog opens
  const openDialog = () => {
    setAccountType((account.accountType as AccountType) || 'personal')
    setName(account.name || '')
    setHandle(account.handle || '')
    setHeadline(account.headline || '')
    setBio(account.bio || '')
    setCompany(account.company || '')
    setWebsiteUrl(account.websiteUrl || '')
    setAvatarUrl(account.avatarUrl || '')
    setError(null)
    setFieldErrors({})
    setSuccess(false)
    setIsOpen(true)
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isPending) {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPending])

  const clearFieldError = (field: string) => {
    if (fieldErrors[field]) {
      setFieldErrors(prev => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
    if (error) setError(null)
  }

  const handleSave = () => {
    setError(null)
    setSuccess(false)

    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = 'Display name is required'
    const cleanHandle = handle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
    if (!cleanHandle) errors.handle = 'LinkedIn handle / slug is required'
    if (!headline.trim()) errors.headline = 'Headline is required'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      setError('Please fill in all required fields marked with *.')
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
        avatarUrl: avatarUrl.trim() || undefined
      })

      if (res.success) {
        setSuccess(true)
        router.refresh()
        setTimeout(() => {
          setIsOpen(false)
          setSuccess(false)
        }, 800)
      } else {
        setError(res.error || 'Failed to update identity')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 hover:underline"
      >
        <Pencil className="h-3.5 w-3.5" />
        <span>Edit Identity</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={e => {
            if (e.target === e.currentTarget && !isPending) {
              setIsOpen(false)
            }
          }}
        >
          <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-border bg-surface shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Pencil className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Edit LinkedIn Identity
                  </h3>
                  <p className="text-[11px] text-muted">
                    Update core identity settings used across ideation and drafting
                  </p>
                </div>
              </div>
              {!isPending && (
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-lg p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Scrollable Form Body */}
            <div className="flex-1 space-y-4 overflow-y-auto p-6 text-left">
              {error && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>Identity updated successfully!</span>
                </div>
              )}

              {/* Identity Type Selector */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Identity Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setAccountType('personal')}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                      accountType === 'personal'
                        ? 'border-accent bg-accent/10 shadow-xs'
                        : 'border-border bg-surface hover:bg-surface-hover'
                    }`}
                  >
                    <User
                      className={`h-4 w-4 ${
                        accountType === 'personal'
                          ? 'text-accent'
                          : 'text-muted'
                      }`}
                    />
                    <div>
                      <p className="text-xs font-bold text-foreground">
                        Person
                      </p>
                      <p className="text-[10px] text-muted">
                        Individual executive or creator
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setAccountType('company')}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                      accountType === 'company'
                        ? 'border-accent bg-accent/10 shadow-xs'
                        : 'border-border bg-surface hover:bg-surface-hover'
                    }`}
                  >
                    <Building2
                      className={`h-4 w-4 ${
                        accountType === 'company'
                          ? 'text-accent'
                          : 'text-muted'
                      }`}
                    />
                    <div>
                      <p className="text-xs font-bold text-foreground">
                        Company
                      </p>
                      <p className="text-[10px] text-muted">
                        Brand, agency or startup
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Display Name & Handle */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Display Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    disabled={isPending}
                    value={name}
                    onChange={e => {
                      setName(e.target.value)
                      clearFieldError('name')
                    }}
                    placeholder="e.g. Aditya Sharma"
                    className={`w-full rounded-xl border bg-surface px-3.5 py-2 text-xs text-foreground transition-colors focus:ring-1 focus:ring-accent ${
                      fieldErrors.name
                        ? 'border-red-500'
                        : 'border-border'
                    }`}
                  />
                  {fieldErrors.name && (
                    <p className="mt-1 text-[11px] text-red-500">
                      {fieldErrors.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    LinkedIn Handle / Slug <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    disabled={isPending}
                    value={handle}
                    onChange={e => {
                      setHandle(e.target.value)
                      clearFieldError('handle')
                    }}
                    placeholder="e.g. aditya-sharma"
                    className={`w-full rounded-xl border bg-surface px-3.5 py-2 text-xs font-mono text-foreground transition-colors focus:ring-1 focus:ring-accent ${
                      fieldErrors.handle
                        ? 'border-red-500'
                        : 'border-border'
                    }`}
                  />
                  {fieldErrors.handle && (
                    <p className="mt-1 text-[11px] text-red-500">
                      {fieldErrors.handle}
                    </p>
                  )}
                </div>
              </div>

              {/* Headline */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Professional Headline <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  disabled={isPending}
                  value={headline}
                  onChange={e => {
                    setHeadline(e.target.value)
                    clearFieldError('headline')
                  }}
                  placeholder="e.g. Founder @ FlowERP | Helping B2B businesses simplify commerce operations"
                  className={`w-full rounded-xl border bg-surface px-3.5 py-2 text-xs text-foreground transition-colors focus:ring-1 focus:ring-accent ${
                    fieldErrors.headline
                      ? 'border-red-500'
                      : 'border-border'
                  }`}
                />
                {fieldErrors.headline && (
                  <p className="mt-1 text-[11px] text-red-500">
                    {fieldErrors.headline}
                  </p>
                )}
              </div>

              {/* Company / Org & Website */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Company / Organization
                  </label>
                  <input
                    type="text"
                    disabled={isPending}
                    value={company}
                    onChange={e => setCompany(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-xs text-foreground focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Website or LinkedIn URL
                  </label>
                  <input
                    type="text"
                    disabled={isPending}
                    value={websiteUrl}
                    onChange={e => setWebsiteUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-xs text-foreground focus:ring-1 focus:ring-accent"
                  />
                </div>
              </div>

              {/* Bio / Summary */}
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  About / Bio Summary
                </label>
                <textarea
                  rows={3}
                  disabled={isPending}
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="Short bio, background, mission statement, or areas of expertise..."
                  className="w-full rounded-xl border border-border bg-surface px-3.5 py-2 text-xs leading-relaxed text-foreground focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Deep Settings Link */}
              <div className="rounded-xl border border-border bg-surface-hover p-3 text-xs flex items-center justify-between">
                <div>
                  <p className="font-semibold text-foreground">
                    Looking for Offerings & Audiences?
                  </p>
                  <p className="text-[11px] text-muted">
                    Configure your products, value props, and target reader profiles.
                  </p>
                </div>
                <Link
                  href={`/accounts/${account.id}`}
                  onClick={() => setIsOpen(false)}
                  className="flex shrink-0 items-center gap-1 font-semibold text-accent hover:underline"
                >
                  <span>Advanced Setup</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <Link
                href={`/accounts/${account.id}`}
                onClick={() => setIsOpen(false)}
                className="text-xs text-muted hover:text-foreground hover:underline"
              >
                Open Full Identity Page →
              </Link>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setIsOpen(false)}
                  className="cursor-pointer rounded-xl border border-border px-4 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={handleSave}
                  className="flex cursor-pointer items-center gap-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-background shadow-sm transition-all hover:bg-accent-hover disabled:opacity-50"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Saving Changes...</span>
                    </>
                  ) : (
                    <span>Save Identity</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
