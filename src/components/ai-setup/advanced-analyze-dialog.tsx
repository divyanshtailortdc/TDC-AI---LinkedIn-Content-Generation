'use client'

import type {
  AnalysisGuidance,
  GOAL_OBJECTIVES
} from '@/lib/ai/skills/profile-setup/schema'
import { WRITING_STYLES } from '@/lib/ai/skills/voice-analysis/schema'
import {
  AlertCircle,
  Building2,
  Loader2,
  Lock,
  SlidersHorizontal,
  Sparkles,
  User,
  X
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

type AccountType = 'personal' | 'company'
type Objective = (typeof GOAL_OBJECTIVES)[number]

const OBJECTIVES: Array<{ value: Objective; label: string }> = [
  { value: 'authority', label: 'Authority (thought leadership & POV)' },
  { value: 'awareness', label: 'Awareness (reach & impressions)' },
  { value: 'engagement', label: 'Engagement (discussions & DMs)' },
  { value: 'lead_gen', label: 'Lead gen (inbound inquiries & demos)' },
  { value: 'recruiting', label: 'Recruiting (attracting talent)' },
  { value: 'community', label: 'Community (peer network building)' }
]

const PERSPECTIVES = [
  { value: 'I', label: 'Me' },
  { value: 'we', label: 'My team' },
  { value: 'third person', label: 'Brand' }
] as const

const FORMALITY = [
  { value: 2, label: 'Casual' },
  { value: 3, label: 'Balanced' },
  { value: 4, label: 'Formal' }
] as const

const EMOJI = [
  { value: 'none', label: 'None' },
  { value: 'bullets only', label: 'As bullets' },
  { value: 'liberal', label: 'Freely' }
] as const

const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors disabled:opacity-60'

function Section({
  title,
  hint,
  children
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="border-border space-y-3 border-t pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-foreground text-sm font-semibold">{title}</h3>
        <p className="text-muted mt-0.5 text-xs">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Label({
  htmlFor,
  children
}: {
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-foreground mb-1.5 block text-xs font-medium"
    >
      {children}
    </label>
  )
}

/** A row of choices where the first, "Let AI decide", clears the choice. */
function Choices<T extends string | number>({
  label,
  value,
  options,
  disabled,
  onChange
}: {
  label: string
  value: T | undefined
  options: ReadonlyArray<{ value: T; label: string }>
  disabled?: boolean
  onChange: (value: T | undefined) => void
}) {
  const all = [{ value: undefined, label: 'Auto' }, ...options]
  return (
    <div>
      <Label>{label}</Label>
      <div
        role="radiogroup"
        aria-label={label}
        className="border-border bg-surface-hover grid grid-cols-2 gap-1 rounded-lg border p-1 sm:grid-cols-4"
      >
        {all.map(option => {
          const selected = option.value === value
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              title={option.value === undefined ? 'Let AI decide' : undefined}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`rounded-md px-2 py-1.5 text-xs transition-colors ${
                selected
                  ? 'bg-surface text-foreground font-semibold shadow-xs'
                  : 'text-muted hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Advanced analysis: the user states the things the AI would otherwise guess
 * (identity type, voice, goal, audience, topics). Every choice is optional;
 * anything left on "Let AI decide" is suggested as usual.
 */
export function AdvancedAnalyzeDialog({
  description,
  onDescriptionChange,
  linkedinUrl,
  onLinkedinUrlChange,
  websiteUrl,
  onWebsiteUrlChange,
  accountType,
  accountTypeLocked,
  isAnalyzing,
  failure,
  onRun,
  onClose
}: {
  description: string
  onDescriptionChange: (value: string) => void
  linkedinUrl: string
  onLinkedinUrlChange: (value: string) => void
  websiteUrl: string
  onWebsiteUrlChange: (value: string) => void
  accountType: AccountType
  /** True for an existing identity, whose type is fixed. */
  accountTypeLocked: boolean
  isAnalyzing: boolean
  failure: { message: string; retryable: boolean } | null
  onRun: (guidance: AnalysisGuidance) => void
  onClose: () => void
}) {
  const [type, setType] = useState<AccountType>(accountType)
  const [tone, setTone] = useState<AnalysisGuidance['tone']>()
  const [perspective, setPerspective] =
    useState<AnalysisGuidance['perspective']>()
  const [formality, setFormality] = useState<number>()
  const [emojiPolicy, setEmojiPolicy] =
    useState<AnalysisGuidance['emojiPolicy']>()
  const [objectiveType, setObjectiveType] = useState<Objective | ''>('')
  const [goal, setGoal] = useState('')
  const [callToAction, setCallToAction] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [focusTopics, setFocusTopics] = useState('')
  const [avoidTopics, setAvoidTopics] = useState('')
  const [descriptionError, setDescriptionError] = useState<string | null>(null)

  const run = () => {
    if (!description.trim()) {
      setDescriptionError('Describe yourself or your business first.')
      return
    }
    onRun({
      accountType: type,
      tone,
      perspective,
      formality,
      emojiPolicy,
      objectiveType: objectiveType || undefined,
      goal: goal.trim() || undefined,
      callToAction: callToAction.trim() || undefined,
      ctaUrl: ctaUrl.trim() || undefined,
      targetAudience: targetAudience.trim() || undefined,
      focusTopics: focusTopics.trim() || undefined,
      avoidTopics: avoidTopics.trim() || undefined
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="advanced-ai-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={e => {
        if (e.target === e.currentTarget && !isAnalyzing) onClose()
      }}
    >
      <div className="border-border bg-surface flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-2xl border shadow-2xl">
        <div className="border-border flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="bg-accent/10 text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <SlidersHorizontal className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2
                id="advanced-ai-title"
                className="text-foreground text-base font-bold"
              >
                Advanced analysis
              </h2>
              <p className="text-muted mt-0.5 text-xs">
                Tell the AI what you already know for more accurate, less
                generic suggestions. Your choices are used exactly; leave
                anything on &ldquo;Let AI decide&rdquo;.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAnalyzing}
            aria-label="Close"
            className="text-muted hover:bg-surface-hover hover:text-foreground rounded-lg p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* A fieldset cannot be the scroll container in a flex column, so
            the scrolling happens on this wrapper instead. */}
        <div className="scrollbar-visible min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <fieldset disabled={isAnalyzing} className="min-w-0 space-y-5">
            <Section
              title="Identity"
              hint="Who is posting, and what the AI should know about them."
            >
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-foreground text-xs font-medium">
                    Identity type
                  </span>
                  {accountTypeLocked && (
                    <span className="text-muted inline-flex items-center gap-1 text-[11px]">
                      <Lock className="h-3 w-3" />
                      Change it on the Profile step
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { value: 'personal', label: 'Person', icon: User },
                      {
                        value: 'company',
                        label: 'Company / Product',
                        icon: Building2
                      }
                    ] as const
                  ).map(option => {
                    const selected = type === option.value
                    const Icon = option.icon
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={accountTypeLocked}
                        onClick={() => setType(option.value)}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                          selected
                            ? 'border-accent bg-accent/5 text-foreground ring-accent/20 ring-1'
                            : 'border-border text-muted hover:text-foreground'
                        } ${accountTypeLocked && !selected ? 'opacity-50' : ''}`}
                      >
                        <Icon className="h-4 w-4" />
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <Label htmlFor="adv-description">
                  Company details <span className="text-rose-500">*</span>
                </Label>
                <textarea
                  id="adv-description"
                  rows={4}
                  value={description}
                  onChange={e => {
                    onDescriptionChange(e.target.value)
                    if (descriptionError) setDescriptionError(null)
                  }}
                  placeholder="Who you are, what you offer and who you serve."
                  className={`${inputClass} scrollbar-visible resize-none ${
                    descriptionError
                      ? 'border-red-500/60 ring-1 ring-red-500/30'
                      : ''
                  }`}
                />
                {descriptionError && (
                  <p className="mt-1 text-xs text-red-500">
                    {descriptionError}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="adv-linkedin">
                    LinkedIn URL{' '}
                    <span className="text-muted font-normal">(optional)</span>
                  </Label>
                  <input
                    id="adv-linkedin"
                    type="url"
                    value={linkedinUrl}
                    onChange={e => onLinkedinUrlChange(e.target.value)}
                    placeholder="linkedin.com/in/your-name"
                    className={inputClass}
                  />
                </div>
                <div>
                  <Label htmlFor="adv-website">
                    Website URL{' '}
                    <span className="text-muted font-normal">(optional)</span>
                  </Label>
                  <input
                    id="adv-website"
                    type="url"
                    value={websiteUrl}
                    onChange={e => onWebsiteUrlChange(e.target.value)}
                    placeholder="example.com"
                    className={inputClass}
                  />
                </div>
              </div>
            </Section>

            <Section
              title="Voice"
              hint="Pick a default voice, or leave it to the AI."
            >
              <div>
                <Label>Writing style</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <button
                    type="button"
                    aria-pressed={!tone}
                    onClick={() => setTone(undefined)}
                    className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      !tone
                        ? 'border-accent bg-accent/5 text-foreground ring-accent/20 font-semibold ring-1'
                        : 'border-border text-muted hover:text-foreground'
                    }`}
                  >
                    <Sparkles className="mb-1 h-3.5 w-3.5" />
                    Let AI decide
                  </button>
                  {WRITING_STYLES.map(style => {
                    const selected = tone === style.value
                    return (
                      <button
                        key={style.value}
                        type="button"
                        aria-pressed={selected}
                        title={style.description}
                        onClick={() => setTone(style.value)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'border-accent bg-accent/5 ring-accent/20 ring-1'
                            : 'border-border hover:border-accent/40'
                        }`}
                      >
                        <span className="text-foreground block text-xs font-semibold">
                          {style.label}
                        </span>
                        <span className="text-muted line-clamp-2 text-[11px] leading-snug">
                          {style.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <Choices
                  label="Who is speaking"
                  value={perspective}
                  options={PERSPECTIVES}
                  onChange={setPerspective}
                />
                <Choices
                  label="Formality"
                  value={formality}
                  options={FORMALITY}
                  onChange={setFormality}
                />
                <Choices
                  label="Emoji"
                  value={emojiPolicy}
                  options={EMOJI}
                  onChange={setEmojiPolicy}
                />
              </div>
            </Section>

            <Section
              title="Goal"
              hint="What your posts should achieve. A link is only used if you add it."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="adv-objective">Objective</Label>
                  <select
                    id="adv-objective"
                    value={objectiveType}
                    onChange={e =>
                      setObjectiveType(e.target.value as Objective | '')
                    }
                    className={inputClass}
                  >
                    <option value="">Let AI decide</option>
                    {OBJECTIVES.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="adv-cta">Call to action</Label>
                  <input
                    id="adv-cta"
                    value={callToAction}
                    onChange={e => setCallToAction(e.target.value)}
                    placeholder="e.g. Book a demo"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="adv-goal">
                  What should LinkedIn do for you?
                </Label>
                <textarea
                  id="adv-goal"
                  rows={2}
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder="e.g. Be known as the go-to expert on B2B commerce and bring in 10 qualified demos a month."
                  className={`${inputClass} scrollbar-visible resize-none`}
                />
              </div>
              <div>
                <Label htmlFor="adv-cta-url">
                  CTA link{' '}
                  <span className="text-muted font-normal">(optional)</span>
                </Label>
                <input
                  id="adv-cta-url"
                  type="url"
                  value={ctaUrl}
                  onChange={e => setCtaUrl(e.target.value)}
                  placeholder="https://example.com/book-a-demo"
                  className={inputClass}
                />
              </div>
            </Section>

            <Section
              title="Audience & topics"
              hint="Separate several entries with commas or new lines."
            >
              <div>
                <Label htmlFor="adv-audience">Target audience</Label>
                <textarea
                  id="adv-audience"
                  rows={2}
                  value={targetAudience}
                  onChange={e => setTargetAudience(e.target.value)}
                  placeholder="e.g. Heads of eCommerce at B2B manufacturers, CFOs at mid-size distributors"
                  className={`${inputClass} scrollbar-visible resize-none`}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="adv-focus">Topics to focus on</Label>
                  <textarea
                    id="adv-focus"
                    rows={2}
                    value={focusTopics}
                    onChange={e => setFocusTopics(e.target.value)}
                    placeholder="e.g. ERP integration, B2B checkout, pricing"
                    className={`${inputClass} scrollbar-visible resize-none`}
                  />
                </div>
                <div>
                  <Label htmlFor="adv-avoid">Topics to avoid</Label>
                  <textarea
                    id="adv-avoid"
                    rows={2}
                    value={avoidTopics}
                    onChange={e => setAvoidTopics(e.target.value)}
                    placeholder="e.g. politics, competitor names"
                    className={`${inputClass} scrollbar-visible resize-none`}
                  />
                </div>
              </div>
            </Section>
          </fieldset>
        </div>

        <div className="border-border flex flex-col gap-3 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-xs" aria-live="polite">
            {failure ? (
              <p className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                {failure.message}
              </p>
            ) : (
              <p className="text-muted">
                {isAnalyzing
                  ? 'Analyzing… this usually takes about a minute.'
                  : 'Nothing is saved until you review and apply.'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isAnalyzing}
              className="text-muted hover:text-foreground rounded-lg px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={run}
              disabled={isAnalyzing}
              className="bg-accent hover:bg-accent-hover text-background inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {isAnalyzing
                ? 'Analyzing…'
                : failure?.retryable
                  ? 'Try again'
                  : 'Run advanced analysis'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
