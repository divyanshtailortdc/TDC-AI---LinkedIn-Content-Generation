'use client'

import { AlertCircle, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { analyzeIdentitySetupAction } from '@/app/(app)/accounts/ai-setup-actions'
import type { IdentitySetupAnalysis } from '@/lib/ai/identity-setup/analyze'

const EXAMPLE_DESCRIPTION = `I'm Priya Rao, founder of Ledgerly, a bookkeeping and month-end close service for direct-to-consumer brands in India. We work with founders doing ₹5–50 Cr in revenue who are tired of waiting three weeks for their numbers.

I want LinkedIn to position me as the person D2C founders trust on finance operations, and to bring in discovery calls. I write best when I explain how things actually work behind the scenes, plainly, without hype.`

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors disabled:opacity-60'

export function AnalyzeWithAiDialog({
  accountId,
  defaultLinkedinUrl = '',
  defaultWebsiteUrl = '',
  onClose,
  onAnalyzed
}: {
  accountId?: string
  defaultLinkedinUrl?: string
  defaultWebsiteUrl?: string
  onClose: () => void
  onAnalyzed: (analysis: IdentitySetupAnalysis) => void
}) {
  const [description, setDescription] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState(defaultLinkedinUrl)
  const [websiteUrl, setWebsiteUrl] = useState(defaultWebsiteUrl)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null)
  // A request that finishes after Cancel is ignored rather than applied.
  const requestId = useRef(0)

  const close = () => {
    requestId.current++
    onClose()
  }

  const analyze = async () => {
    if (!description.trim()) {
      setValidationError('Describe yourself or your business before analyzing.')
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
        websiteUrl: websiteUrl.trim() || undefined
      })
      if (current !== requestId.current) return
      if (res.success) {
        onAnalyzed(res.data)
      } else {
        setFailure({ message: res.error, retryable: res.retryable })
      }
    } catch {
      if (current !== requestId.current) return
      setFailure({
        message: 'Could not reach the server. Check your connection and try again.',
        retryable: true
      })
    } finally {
      if (current === requestId.current) setIsAnalyzing(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyze-ai-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={e => {
        if (e.target === e.currentTarget && !isAnalyzing) close()
      }}
    >
      <div className="border-border bg-surface relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border shadow-2xl">
        <div className="border-border flex items-start justify-between gap-4 border-b p-6">
          <div className="flex items-start gap-3">
            <div className="bg-accent/10 text-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 id="analyze-ai-title" className="text-foreground text-base font-bold">
                Analyze with AI
              </h2>
              <p className="text-muted mt-1 text-xs leading-relaxed">
                Describe yourself or your business in your own words. AI suggests
                your Profile, Voice, Knowledge, Goals and Preferences for you to
                review. Nothing is saved until you apply it.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="text-muted hover:bg-surface-hover hover:text-foreground rounded-lg p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="ai-description" className="text-foreground text-sm font-medium">
                Description <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                disabled={isAnalyzing}
                onClick={() => {
                  setDescription(EXAMPLE_DESCRIPTION)
                  setValidationError(null)
                }}
                className="text-accent text-xs font-medium hover:underline disabled:opacity-50"
              >
                Use an example
              </button>
            </div>
            <textarea
              id="ai-description"
              rows={9}
              value={description}
              disabled={isAnalyzing}
              onChange={e => {
                setDescription(e.target.value)
                if (validationError) setValidationError(null)
              }}
              placeholder="Who you are, your company and role, your industry, who you want to reach, what you offer, how you want to come across, and what you want LinkedIn to do for you."
              className={`${inputClass} resize-y ${validationError ? 'border-red-500/60 ring-1 ring-red-500/30' : ''}`}
            />
            {validationError ? (
              <p className="mt-1.5 text-xs text-red-500">{validationError}</p>
            ) : (
              <p className="text-muted mt-1.5 text-xs">
                The more specific you are, the less the AI has to guess. It will
                not invent facts, numbers or customers.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ai-linkedin" className="text-foreground mb-1.5 block text-sm font-medium">
                LinkedIn Profile / Page URL <span className="text-muted font-normal">(optional)</span>
              </label>
              <input
                id="ai-linkedin"
                type="url"
                value={linkedinUrl}
                disabled={isAnalyzing}
                onChange={e => setLinkedinUrl(e.target.value)}
                placeholder="https://www.linkedin.com/in/your-name"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="ai-website" className="text-foreground mb-1.5 block text-sm font-medium">
                Website URL <span className="text-muted font-normal">(optional)</span>
              </label>
              <input
                id="ai-website"
                type="url"
                value={websiteUrl}
                disabled={isAnalyzing}
                onChange={e => setWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
                className={inputClass}
              />
            </div>
          </div>
          <p className="text-muted -mt-2 text-xs">
            LinkedIn usually blocks automated access. If a page can&apos;t be
            read, the analysis uses your description instead.
          </p>

          {failure && (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="leading-relaxed font-medium">{failure.message}</p>
            </div>
          )}
        </div>

        <div className="border-border flex items-center justify-between gap-3 border-t p-4">
          <p className="text-muted text-xs" aria-live="polite">
            {isAnalyzing ? 'Analyzing… this usually takes about a minute.' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={close}
              className="text-muted hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={analyze}
              disabled={isAnalyzing}
              className="bg-accent hover:bg-accent-hover text-background inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
                  Analyze
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
