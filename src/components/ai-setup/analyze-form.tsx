'use client'

import { analyzeIdentitySetupAction } from '@/app/(app)/accounts/ai-setup-actions'
import type {
  AnalysisGuidance,
  IdentitySetupAnalysis
} from '@/lib/ai/skills/profile-setup/schema'
import { IDENTITY_FIELDS } from '@/lib/identity-profile'
import {
  AlertCircle,
  ChevronRight,
  Globe,
  Info,
  Link2,
  Loader2,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { AdvancedAnalyzeDialog } from './advanced-analyze-dialog'

const EXAMPLE_DESCRIPTION = `I'm Priya Rao, founder of Ledgerly, a bookkeeping and month-end close service for direct-to-consumer brands in India. We work with founders doing ₹5–50 Cr in revenue who are tired of waiting three weeks for their numbers.

I want LinkedIn to position me as the person D2C founders trust on finance operations, and to bring in discovery calls. I write best when I explain how things actually work behind the scenes, plainly, without hype.`

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors disabled:opacity-60'

/**
 * The Analyze with AI inputs: paste a description (and optional links), then
 * analyze. In the "rail" look (the AI Suggestions card beside most steps) the
 * description box grows to fill the card; the "assistant" look is the Profile
 * step's compact panel, which also holds the Online presence links. The
 * LinkedIn and Website URLs there are the profile's own (`presence`, shared
 * with the Profile form).
 */
export function AnalyzeForm({
  variant = 'rail',
  accountId,
  defaultLinkedinUrl = '',
  defaultWebsiteUrl = '',
  urls,
  presence,
  accountType = 'personal',
  accountTypeLocked = false,
  onAccountTypeChosen,
  onAnalyzed,
  onCancel
}: {
  variant?: 'rail' | 'assistant'
  accountId?: string
  defaultLinkedinUrl?: string
  defaultWebsiteUrl?: string
  /**
   * Given on the create page, whose own form holds the LinkedIn and Website
   * URLs: they are read from there instead of being asked for a second time.
   */
  urls?: { linkedinUrl?: string | null; websiteUrl?: string | null }
  /**
   * The Profile step's LinkedIn and Website URLs, shown as inputs in
   * the assistant. Without it the assistant keeps them in its own state.
   */
  presence?: {
    urls: { linkedinUrl: string; websiteUrl: string }
    errors: { linkedinUrl?: string; websiteUrl?: string }
    onChange: (patch: { linkedinUrl?: string; websiteUrl?: string }) => void
  }
  accountType?: 'personal' | 'company'
  /** True for an existing identity, whose type is changed on the Profile step. */
  accountTypeLocked?: boolean
  /** The create page follows the type picked in Advanced analysis. */
  onAccountTypeChosen?: (value: 'personal' | 'company') => void
  onAnalyzed: (analysis: IdentitySetupAnalysis) => void
  /** Shown when there are earlier suggestions to go back to. */
  onCancel?: () => void
}) {
  const [description, setDescription] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState(defaultLinkedinUrl)
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsiteUrl)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [failure, setFailure] = useState<{
    message: string
    retryable: boolean
  } | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // A request that finishes after Cancel is ignored rather than applied.
  const requestId = useRef(0)

  const assistant = variant === 'assistant'
  const urlsFromForm = urls !== undefined
  const linkedin = presence
    ? presence.urls.linkedinUrl
    : urlsFromForm
      ? (urls.linkedinUrl ?? '')
      : linkedinUrl
  const website = presence
    ? presence.urls.websiteUrl
    : urlsFromForm
      ? (urls.websiteUrl ?? '')
      : websiteUrl
  const setLinkedin = presence
    ? (value: string) => presence.onChange({ linkedinUrl: value })
    : setLinkedinUrl
  const setWebsite = presence
    ? (value: string) => presence.onChange({ websiteUrl: value })
    : setWebsiteUrl
  // LinkedIn is never fetched, so only the website is actually read.
  const hasReadableLink = Boolean(website.trim())

  // Quick analysis sends just the text; Advanced adds the user's choices.
  const analyze = async (guidance?: AnalysisGuidance) => {
    if (!description.trim()) {
      setValidationError('Describe yourself or your business first.')
      return
    }
    setValidationError(null)
    setFailure(null)
    setIsAnalyzing(true)
    const current = ++requestId.current

    try {
      const res = await analyzeIdentitySetupAction({
        accountId,
        description,
        linkedinUrl: linkedin.trim() || undefined,
        websiteUrl: website.trim() || undefined,
        // Quick analysis still tells the AI the type it already knows.
        guidance: guidance ?? { accountType }
      })
      if (current !== requestId.current) return
      if (res.success) {
        if (guidance?.accountType && !accountTypeLocked) {
          onAccountTypeChosen?.(guidance.accountType)
        }
        setAdvancedOpen(false)
        onAnalyzed(res.data)
      } else {
        setFailure({ message: res.error, retryable: res.retryable })
      }
    } catch {
      if (current !== requestId.current) return
      setFailure({
        message:
          'Could not reach the server. Check your connection and try again.',
        retryable: true
      })
    } finally {
      if (current === requestId.current) setIsAnalyzing(false)
    }
  }

  return (
    <>
      <form
        noValidate
        onSubmit={e => {
          e.preventDefault()
          void analyze()
        }}
        className={
          assistant
            ? 'mt-4 flex flex-col gap-3'
            : 'flex min-h-0 flex-1 flex-col gap-3'
        }
      >
        <div className={assistant ? '' : 'flex min-h-0 flex-1 flex-col'}>
          {assistant ? (
            <label htmlFor="ai-description" className="sr-only">
              Your LinkedIn bio, company description or website content
            </label>
          ) : (
            <div className="mb-1 flex items-center justify-between gap-2">
              <label
                htmlFor="ai-description"
                className="text-foreground text-xs font-medium"
              >
                Company details <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => {
                  setDescription(EXAMPLE_DESCRIPTION)
                  setValidationError(null)
                }}
                className="text-accent text-[11px] font-medium hover:underline disabled:opacity-50"
              >
                Use an example
              </button>
            </div>
          )}
          <textarea
            id="ai-description"
            value={description}
            disabled={isAnalyzing}
            onChange={e => {
              setDescription(e.target.value)
              if (validationError) setValidationError(null)
            }}
            placeholder={
              assistant
                ? 'Paste your LinkedIn bio, company description, or website content...'
                : 'Paste anything about you or your company: who you are, what you offer, who you want to reach and what LinkedIn should do for you.'
            }
            className={`${inputClass} ${
              assistant
                ? 'h-28 resize-y text-sm'
                : 'min-h-28 flex-1 resize-none text-xs leading-relaxed'
            } ${validationError ? 'border-red-500/60 ring-1 ring-red-500/30' : ''}`}
          />
          {validationError && (
            <p className="mt-1 text-[11px] text-red-500">{validationError}</p>
          )}
          {assistant && (
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <p className="text-muted text-[11px] leading-snug">
                {hasReadableLink
                  ? 'Also reads the links under Online presence.'
                  : 'LinkedIn often blocks reading; your text is used instead.'}
              </p>
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => {
                  setDescription(EXAMPLE_DESCRIPTION)
                  setValidationError(null)
                }}
                className="text-accent shrink-0 text-[11px] font-medium hover:underline disabled:opacity-50"
              >
                Use an example
              </button>
            </div>
          )}
        </div>

        {assistant && (
          <OnlinePresence
            disabled={isAnalyzing}
            linkedinUrl={linkedin}
            onLinkedinUrlChange={setLinkedin}
            websiteUrl={website}
            onWebsiteUrlChange={setWebsite}
            errors={presence?.errors ?? {}}
          />
        )}

        {!assistant &&
          (urlsFromForm ? (
            <p className="text-muted text-[11px] leading-snug">
              Also reads the LinkedIn and Website URLs under Online presence, if
              you fill them in.
            </p>
          ) : (
            <>
              <div>
                <label
                  htmlFor="ai-linkedin"
                  className="text-foreground mb-1 block text-xs font-medium"
                >
                  LinkedIn URL{' '}
                  <span className="text-muted font-normal">(optional)</span>
                </label>
                <input
                  id="ai-linkedin"
                  type="url"
                  value={linkedinUrl}
                  disabled={isAnalyzing}
                  onChange={e => setLinkedinUrl(e.target.value)}
                  placeholder="linkedin.com/in/your-name"
                  className={`${inputClass} text-xs`}
                />
              </div>

              <div>
                <label
                  htmlFor="ai-website"
                  className="text-foreground mb-1 block text-xs font-medium"
                >
                  Website URL{' '}
                  <span className="text-muted font-normal">(optional)</span>
                </label>
                <input
                  id="ai-website"
                  type="url"
                  value={websiteUrl}
                  disabled={isAnalyzing}
                  onChange={e => setWebsiteUrl(e.target.value)}
                  placeholder="example.com"
                  className={`${inputClass} text-xs`}
                />
              </div>
            </>
          ))}

        {failure && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] leading-snug text-red-600 dark:text-red-400">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {failure.message}
          </p>
        )}

        <div className={assistant ? 'space-y-3' : 'space-y-1.5'}>
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={isAnalyzing}
              className="bg-accent hover:bg-accent-hover text-background flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing…
                </>
              ) : failure?.retryable ? (
                <>
                  <RotateCcw className="h-4 w-4" />
                  Try again
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Analyze with AI
                </>
              )}
            </button>
            {!assistant && (
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => setAdvancedOpen(true)}
                title="Advanced analysis: set identity type, voice, goal and topics for more accurate results"
                className="border-border text-foreground hover:bg-surface-hover flex w-full items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Advanced analysis
              </button>
            )}
          </div>

          {assistant ? (
            <>
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => setAdvancedOpen(true)}
                title="Set identity type, voice, goal and topics for more accurate results"
                className="border-border text-muted hover:text-foreground flex w-full items-center gap-2 border-t pt-3 text-xs font-medium transition-colors disabled:opacity-60"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Advanced analysis options
                <ChevronRight className="ml-auto h-3.5 w-3.5" />
              </button>
              <p
                className="border-border text-muted flex items-start gap-2 border-t pt-3 text-[11px] leading-snug"
                aria-live="polite"
              >
                <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                {isAnalyzing
                  ? 'This usually takes about a minute.'
                  : 'AI suggestions never overwrite filled fields without your confirmation.'}
              </p>
            </>
          ) : (
            <p
              className="text-muted text-center text-[11px]"
              aria-live="polite"
            >
              {isAnalyzing
                ? 'This usually takes about a minute.'
                : 'LinkedIn often blocks reading; your text is used instead.'}
            </p>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={() => {
                requestId.current++
                setIsAnalyzing(false)
                onCancel()
              }}
              className="text-muted hover:text-foreground w-full text-center text-xs"
            >
              Back to current suggestions
            </button>
          )}
        </div>
      </form>

      {advancedOpen && (
        <AdvancedAnalyzeDialog
          description={description}
          onDescriptionChange={value => {
            setDescription(value)
            if (validationError) setValidationError(null)
          }}
          linkedinUrl={linkedin}
          onLinkedinUrlChange={setLinkedinUrl}
          websiteUrl={website}
          onWebsiteUrlChange={setWebsiteUrl}
          // The assistant card asks for the links itself.
          urlsFromForm={urlsFromForm || assistant}
          accountType={accountType}
          accountTypeLocked={accountTypeLocked}
          isAnalyzing={isAnalyzing}
          failure={failure}
          onRun={guidance => void analyze(guidance)}
          onClose={() => setAdvancedOpen(false)}
        />
      )}
    </>
  )
}

/**
 * The assistant's Online presence block: the profile's own LinkedIn and
 * Website URLs.
 */
function OnlinePresence({
  disabled,
  linkedinUrl,
  onLinkedinUrlChange,
  websiteUrl,
  onWebsiteUrlChange,
  errors
}: {
  disabled: boolean
  linkedinUrl: string
  onLinkedinUrlChange: (value: string) => void
  websiteUrl: string
  onWebsiteUrlChange: (value: string) => void
  errors: { linkedinUrl?: string; websiteUrl?: string }
}) {
  const field = ({
    id,
    label,
    value,
    onChange,
    placeholder,
    icon,
    error
  }: {
    id: string
    label: ReactNode
    value: string
    onChange: (value: string) => void
    placeholder: string
    icon: ReactNode
    error?: string
  }) => (
    <div>
      <label
        htmlFor={id}
        className="text-foreground mb-1 block text-xs font-medium"
      >
        {label}
      </label>
      <div className="relative">
        <span className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2">
          {icon}
        </span>
        <input
          id={id}
          type="url"
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputClass} pl-8 text-xs ${
            error ? 'border-red-500/60 ring-1 ring-red-500/30' : ''
          }`}
        />
      </div>
      {error && <p className="mt-1 text-[11px] text-red-500">{error}</p>}
    </div>
  )

  const linkedinDef = IDENTITY_FIELDS.find(f => f.name === 'linkedinUrl')!
  const websiteDef = IDENTITY_FIELDS.find(f => f.name === 'websiteUrl')!

  return (
    <fieldset className="border-border min-w-0 space-y-3 border-t pt-3">
      <legend className="sr-only">Online presence</legend>
      <p className="text-foreground text-xs font-semibold">
        Online presence{' '}
        <span className="text-muted font-normal">(optional)</span>
      </p>

      {field({
        id: 'ai-linkedin',
        label: linkedinDef.label,
        value: linkedinUrl,
        onChange: onLinkedinUrlChange,
        placeholder: linkedinDef.placeholder,
        icon: <Link2 className="h-3.5 w-3.5" />,
        error: errors.linkedinUrl
      })}
      {field({
        id: 'ai-website',
        label: websiteDef.label,
        value: websiteUrl,
        onChange: onWebsiteUrlChange,
        placeholder: websiteDef.placeholder,
        icon: <Globe className="h-3.5 w-3.5" />,
        error: errors.websiteUrl
      })}
    </fieldset>
  )
}
