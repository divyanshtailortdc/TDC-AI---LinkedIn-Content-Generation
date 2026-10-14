'use client'

import { analyzeIdentitySetupAction } from '@/app/(app)/accounts/ai-setup-actions'
import type {
  AnalysisGuidance,
  IdentitySetupAnalysis
} from '@/lib/ai/skills/profile-setup/schema'
import {
  AlertCircle,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import { useRef, useState } from 'react'
import { AdvancedAnalyzeDialog } from './advanced-analyze-dialog'

const EXAMPLE_DESCRIPTION = `I'm Priya Rao, founder of Ledgerly, a bookkeeping and month-end close service for direct-to-consumer brands in India. We work with founders doing ₹5–50 Cr in revenue who are tired of waiting three weeks for their numbers.

I want LinkedIn to position me as the person D2C founders trust on finance operations, and to bring in discovery calls. I write best when I explain how things actually work behind the scenes, plainly, without hype.`

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors disabled:opacity-60'

/**
 * The Analyze with AI inputs, shown inside the AI Suggestions card: paste a
 * description (and optional links), then analyze. The description box grows
 * to fill whatever height the card has.
 */
export function AnalyzeForm({
  accountId,
  defaultLinkedinUrl = '',
  defaultWebsiteUrl = '',
  accountType = 'personal',
  accountTypeLocked = false,
  onAccountTypeChosen,
  onAnalyzed,
  onCancel
}: {
  accountId?: string
  defaultLinkedinUrl?: string
  defaultWebsiteUrl?: string
  accountType?: 'personal' | 'company'
  /** True for an existing identity, whose type cannot change. */
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
        linkedinUrl: linkedinUrl.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
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
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <div className="flex min-h-0 flex-1 flex-col">
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
          <textarea
            id="ai-description"
            value={description}
            disabled={isAnalyzing}
            onChange={e => {
              setDescription(e.target.value)
              if (validationError) setValidationError(null)
            }}
            placeholder="Paste anything about you or your company: who you are, what you offer, who you want to reach and what LinkedIn should do for you."
            className={`${inputClass} min-h-28 flex-1 resize-none text-xs leading-relaxed ${
              validationError ? 'border-red-500/60 ring-1 ring-red-500/30' : ''
            }`}
          />
          {validationError && (
            <p className="mt-1 text-[11px] text-red-500">{validationError}</p>
          )}
        </div>

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

        {failure && (
          <p className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] leading-snug text-red-600 dark:text-red-400">
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {failure.message}
          </p>
        )}

        <div className="space-y-1.5">
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
          </div>
          <p className="text-muted text-center text-[11px]" aria-live="polite">
            {isAnalyzing
              ? 'This usually takes about a minute.'
              : 'LinkedIn often blocks reading; your text is used instead.'}
          </p>
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
          linkedinUrl={linkedinUrl}
          onLinkedinUrlChange={setLinkedinUrl}
          websiteUrl={websiteUrl}
          onWebsiteUrlChange={setWebsiteUrl}
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
