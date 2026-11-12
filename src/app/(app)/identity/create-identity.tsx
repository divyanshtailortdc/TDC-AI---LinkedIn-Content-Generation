'use client'

import {
  SetupFrame,
  SetupStepper,
  useStepSave
} from '@/components/account-setup/setup-frame'
import {
  NEW_IDENTITY_KEY,
  resetDraft,
  saveDraft
} from '@/components/ai-setup/draft-store'
import {
  IdentityFields,
  SectionCard,
  validateIdentityValues,
  type AccountType,
  type IdentityFieldErrors,
  type IdentityValues
} from '@/components/identity-fields'
import { PlatformMark } from '@/components/platform-mark'
import { PlatformCards, type PlatformCardNote } from '@/components/platform-cards'
import { StyleLegend } from '@/components/platform-styles'
import { showToast } from '@/components/toast-notification'
import type { IdentitySetupAnalysis } from '@/lib/ai/skills/profile-setup/schema'
import {
  DEFAULT_STYLES,
  PLATFORM_IDS,
  PLATFORMS,
  type ContentStyle,
  type PlatformId
} from '@/lib/formats'
import { EMPTY_PROFILE, optionalUrlError } from '@/lib/identity-profile'
import { profileSuggestionValues } from '@/lib/settings-merge'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Link2,
  Loader2,
  Sparkles,
  UsersRound
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { createAccount } from './actions'

/**
 * Onboarding: creating the identity, in three short steps.
 *
 * 1. Where do you post? The platforms decide which formats are drafted.
 * 2. Tell us about you, in your own words (and a link or two). The AI fills
 *    in the profile and picks how posts should sound on each platform; or
 *    the person fills it in themselves.
 * 3. Review: the profile, who is posting (a person or a brand) and a card
 *    per platform (its style, who follows them there, how they sound there
 *    and their emoji), all editable, then save.
 *
 * Nothing is saved until the last step. The AI's other suggestions (voice,
 * goals, knowledge) wait in the setup draft and are offered once the identity
 * exists.
 */

type Step = 'where' | 'about' | 'review'

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'where', label: 'Where you post' },
  { key: 'about', label: 'About you' },
  { key: 'review', label: 'Review' }
]

/** What each platform is drafted as, under its name. */
const PLATFORM_HINTS: Record<PlatformId, string> = {
  linkedin: 'Posts',
  x: 'Posts and threads',
  threads: 'Posts',
  facebook: 'Posts',
  instagram: 'Posts with an image',
  youtube: 'Shorts scripts'
}

type Styles = Partial<Record<PlatformId, ContentStyle>>
type Notes = Partial<Record<PlatformId, PlatformCardNote>>

/** Every picked platform's style: the one chosen, else its default. */
const stylesFor = (platforms: PlatformId[], chosen: Styles): Record<string, ContentStyle> =>
  Object.fromEntries(platforms.map(p => [p, chosen[p] ?? DEFAULT_STYLES[p]]))

export function CreateIdentity({
  another = false
}: {
  /** The user already has an identity and is adding one. */
  another?: boolean
} = {}) {
  // Every visit starts blank: suggestions left by an earlier visit that was
  // never saved are dropped before anything reads them. A lazy initializer
  // runs once per mount, during the first render.
  useState(() => resetDraft(NEW_IDENTITY_KEY))
  const [step, setStep] = useState<Step>('where')
  const [platforms, setPlatforms] = useState<PlatformId[]>([])
  const [about, setAbout] = useState({ description: '', linkedinUrl: '', websiteUrl: '' })
  const [values, setValues] = useState<IdentityValues>(EMPTY_PROFILE)
  const [accountType, setAccountType] = useState<AccountType>('personal')
  const [styles, setStyles] = useState<Styles>({})
  const [notes, setNotes] = useState<Notes>({})
  // What still holds the AI's suggestion, marked until edited.
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set())
  const [aiStyles, setAiStyles] = useState<Set<PlatformId>>(new Set())
  const [usedAi, setUsedAi] = useState(false)

  /** The person skipped the AI: their own words and links start the form. */
  const fillMyself = () => {
    setValues(prev => ({
      ...prev,
      description: prev.description || about.description.trim(),
      linkedinUrl: prev.linkedinUrl || about.linkedinUrl.trim(),
      websiteUrl: prev.websiteUrl || about.websiteUrl.trim()
    }))
    setStep('review')
  }

  const applyAnalysis = (analysis: IdentitySetupAnalysis) => {
    const suggested = profileSuggestionValues(analysis.suggestions.profile)
    const filled = Object.entries(suggested).filter(
      ([, v]) => typeof v === 'string' && v.trim()
    ) as Array<[keyof IdentityValues, string]>
    setValues({
      ...EMPTY_PROFILE,
      description: about.description.trim(),
      ...Object.fromEntries(filled),
      // Links the person typed are theirs; the AI's only fill a blank.
      ...(about.linkedinUrl.trim() ? { linkedinUrl: about.linkedinUrl.trim() } : {}),
      ...(about.websiteUrl.trim() ? { websiteUrl: about.websiteUrl.trim() } : {})
    })
    setAiFilled(
      new Set(
        filled
          .map(([key]) => key)
          .filter(
            key =>
              !(key === 'linkedinUrl' && about.linkedinUrl.trim()) &&
              !(key === 'websiteUrl' && about.websiteUrl.trim())
          )
      )
    )
    setAccountType(analysis.accountType)
    const picked = analysis.styles ?? {}
    setStyles(prev => ({ ...prev, ...picked }))
    // The AI's notes replace an earlier analysis's for the same platform.
    setNotes(prev => ({ ...prev, ...(analysis.channelNotes ?? {}) }))
    setAiStyles(new Set(platforms.filter(p => picked[p])))
    setUsedAi(true)
    setStep('review')
  }

  const reachable = (key: Step) =>
    key === 'where' ||
    (key === 'about' && platforms.length > 0) ||
    (key === 'review' && step === 'review')

  return (
    <SetupFrame
      stepIndex={0}
      title={another ? 'Create Another Identity' : 'Create Your Identity'}
      description={
        another
          ? 'A separate persona or brand with its own voice, goals and connected accounts. Your other identities stay as they are.'
          : 'Three quick steps: where you post, a few words about you, then check what we filled in.'
      }
      identity={
        <Link
          href="/"
          className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>
      }
      nav={<SetupStepper activeIndex={0} draftKey={NEW_IDENTITY_KEY} />}
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Progress">
          {STEPS.map((s, i) => {
            const index = STEPS.findIndex(x => x.key === step)
            const done = i < index
            const active = s.key === step
            return (
              <li key={s.key} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="bg-border h-px w-6" />}
                <button
                  type="button"
                  disabled={!reachable(s.key) || active}
                  onClick={() => setStep(s.key)}
                  aria-current={active ? 'step' : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-medium transition-colors disabled:cursor-default ${
                    active
                      ? 'bg-accent/10 text-accent'
                      : done
                        ? 'text-foreground hover:bg-surface-hover'
                        : 'text-muted'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                      active
                        ? 'bg-accent text-background'
                        : done
                          ? 'bg-accent/15 text-accent'
                          : 'border-border border'
                    }`}
                  >
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            )
          })}
        </ol>

        {step === 'where' && (
          <WhereStep
            platforms={platforms}
            onChange={setPlatforms}
            onNext={() => setStep('about')}
            another={another}
          />
        )}
        {step === 'about' && (
          <AboutStep
            platforms={platforms}
            value={about}
            onChange={setAbout}
            onBack={() => setStep('where')}
            onAnalyzed={(analysis, input) => {
              saveDraft(NEW_IDENTITY_KEY, analysis, input)
              applyAnalysis(analysis)
            }}
            onFillMyself={fillMyself}
          />
        )}
        {step === 'review' && (
          <ReviewStep
            platforms={platforms}
            values={values}
            setValues={setValues}
            accountType={accountType}
            setAccountType={setAccountType}
            styles={stylesFor(platforms, styles)}
            onStyleChange={(platform, style) => {
              setStyles(prev => ({ ...prev, [platform]: style }))
              setAiStyles(prev => {
                const next = new Set(prev)
                next.delete(platform)
                return next
              })
            }}
            notes={notes}
            onNoteChange={(platform, note) =>
              setNotes(prev => ({ ...prev, [platform]: note }))
            }
            aiFilled={aiFilled}
            onEdited={field =>
              setAiFilled(prev => {
                if (!prev.has(field)) return prev
                const next = new Set(prev)
                next.delete(field)
                return next
              })
            }
            aiStyles={aiStyles}
            usedAi={usedAi}
            onChangePlatforms={() => setStep('where')}
            onRedo={() => setStep('about')}
          />
        )}
      </div>
    </SetupFrame>
  )
}

const primaryButton =
  'bg-accent hover:bg-accent-hover text-background inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'border-border text-foreground hover:bg-surface-hover inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-50'
const inputClass =
  'w-full rounded-lg border border-border bg-surface px-3.5 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition-colors disabled:opacity-60'

function WhereStep({
  platforms,
  onChange,
  onNext,
  another = false
}: {
  platforms: PlatformId[]
  onChange: (next: PlatformId[]) => void
  onNext: () => void
  /** The user already has an identity and is adding a separate one. */
  another?: boolean
}) {
  const toggle = (platform: PlatformId) =>
    onChange(
      platforms.includes(platform)
        ? platforms.filter(p => p !== platform)
        : PLATFORM_IDS.filter(p => p === platform || platforms.includes(p))
    )
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-foreground text-base font-semibold">
          {another ? 'Where does this identity post?' : 'Where do you post?'}
        </h2>
        <p className="text-muted mt-0.5 text-sm">
          Pick every platform this identity posts on. Each one gets its own
          style (professional on LinkedIn, fun on Instagram), and goals and
          ideas can be kept to one platform. You can change this later in
          Preferences.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORM_IDS.map(platform => {
          const selected = platforms.includes(platform)
          return (
            <button
              key={platform}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => toggle(platform)}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                selected
                  ? 'border-accent bg-accent/5 ring-accent/20 ring-1'
                  : 'border-border bg-surface hover:border-accent/40 hover:bg-surface-hover'
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  selected ? 'bg-accent text-background' : 'bg-surface-hover text-foreground'
                }`}
              >
                <PlatformMark platform={platform} className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-sm font-semibold">
                  {PLATFORMS[platform].label}
                </span>
                <span className="text-muted block text-xs">{PLATFORM_HINTS[platform]}</span>
              </span>
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                  selected ? 'border-accent bg-accent text-background' : 'border-border'
                }`}
              >
                {selected && <Check className="h-3.5 w-3.5" />}
              </span>
            </button>
          )
        })}
      </div>
      <div className="border-border bg-surface-hover/40 flex items-start gap-3 rounded-xl border px-4 py-3">
        <UsersRound aria-hidden className="text-accent mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-muted text-xs leading-relaxed">
          {another ? (
            <>
              <span className="text-foreground font-medium">
                This is a separate identity:
              </span>{' '}
              its own profile, voice, goals, ideas and connected accounts. Your
              other identities are not changed, and you switch between them in
              the sidebar.
            </>
          ) : (
            <>
              <span className="text-foreground font-medium">
                Same you, different platforms?
              </span>{' '}
              Pick them all here. Posting somewhere as a different person or
              brand (a separate persona on Instagram, say)? Create a separate
              identity for it later from the sidebar, with its own voice,
              goals and connected accounts.
            </>
          )}
        </p>
      </div>
      <div className="flex items-center justify-end gap-3">
        {platforms.length === 0 && (
          <span className="text-muted text-xs">Pick at least one platform.</span>
        )}
        <button
          type="button"
          onClick={onNext}
          disabled={platforms.length === 0}
          className={primaryButton}
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  )
}

type About = { description: string; linkedinUrl: string; websiteUrl: string }

function AboutStep({
  platforms,
  value,
  onChange,
  onBack,
  onAnalyzed,
  onFillMyself
}: {
  platforms: PlatformId[]
  value: About
  onChange: (next: About) => void
  onBack: () => void
  onAnalyzed: (
    analysis: IdentitySetupAnalysis,
    input: { description: string; linkedinUrl: string; websiteUrl: string }
  ) => void
  onFillMyself: () => void
}) {
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [urlErrors, setUrlErrors] = useState<{ linkedinUrl?: string; websiteUrl?: string }>({})
  // Cancel aborts the request (which stops the analysis on the server); a
  // response that still arrives after it is ignored.
  const controller = useRef<AbortController | null>(null)
  const requestId = useRef(0)

  const set = (field: keyof About, next: string) => {
    onChange({ ...value, [field]: next })
    if (field !== 'description') setUrlErrors(prev => ({ ...prev, [field]: undefined }))
    setError(null)
  }

  const analyze = async () => {
    if (!value.description.trim()) {
      setError('Write a few words about yourself first, or fill it in yourself.')
      return
    }
    const found = {
      linkedinUrl: optionalUrlError(value.linkedinUrl),
      websiteUrl: optionalUrlError(value.websiteUrl)
    }
    setUrlErrors(found)
    if (found.linkedinUrl || found.websiteUrl) return
    setError(null)
    setAnalyzing(true)
    const current = ++requestId.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    const input = {
      description: value.description.trim(),
      linkedinUrl: value.linkedinUrl.trim(),
      websiteUrl: value.websiteUrl.trim()
    }
    try {
      // A plain fetch, not a server action, so it can be cancelled.
      const response = await fetch('/api/ai-setup/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          description: input.description,
          linkedinUrl: input.linkedinUrl || undefined,
          websiteUrl: input.websiteUrl || undefined,
          guidance: { platforms }
        })
      })
      const res = (await response.json()) as
        | { success: true; data: IdentitySetupAnalysis }
        | { success: false; error: string }
      if (current !== requestId.current) return
      if (res.success) onAnalyzed(res.data, input)
      else setError(res.error)
    } catch {
      if (current !== requestId.current) return
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      if (current === requestId.current) setAnalyzing(false)
    }
  }

  const cancel = () => {
    requestId.current++
    controller.current?.abort()
    setAnalyzing(false)
  }

  const where = platforms.map(p => PLATFORMS[p].label).join(', ')

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-foreground text-base font-semibold">Tell us about you</h2>
        <p className="text-muted mt-0.5 text-sm">
          In your own words. We&apos;ll fill in your profile and pick how your
          posts should sound on {where}.
        </p>
      </div>

      <div>
        <label htmlFor="about-description" className="text-foreground mb-1.5 block text-sm font-medium">
          What do you post about, and who is it for?
        </label>
        <textarea
          id="about-description"
          value={value.description}
          disabled={analyzing}
          onChange={e => set('description', e.target.value)}
          rows={5}
          placeholder={`e.g. I'm Priya, a dance teacher in Pune. I post short Bollywood tutorials and funny rehearsal bloopers with my students, for teens learning at home. I also run weekend classes.

or: I run Ledgerly, a bookkeeping service for D2C brands, and want founders to see me as the person to trust on finance.`}
          className={`${inputClass} scrollbar-visible h-36 resize-y leading-relaxed`}
        />
        <p className="text-muted mt-1.5 text-xs">
          Who you are, what you post, who follows you, and anything you promote.
          The more specific, the better the posts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LinkInput
          id="about-profile"
          label="Main profile link"
          hint="(optional)"
          placeholder="https://www.instagram.com/your-handle"
          icon={<Link2 className="h-4 w-4" />}
          value={value.linkedinUrl}
          error={urlErrors.linkedinUrl}
          disabled={analyzing}
          onChange={v => set('linkedinUrl', v)}
        />
        <LinkInput
          id="about-website"
          label="Website"
          hint="(optional, we'll read it)"
          placeholder="https://example.com"
          icon={<Globe className="h-4 w-4" />}
          value={value.websiteUrl}
          error={urlErrors.websiteUrl}
          disabled={analyzing}
          onChange={v => set('websiteUrl', v)}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{error}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} disabled={analyzing} className={secondaryButton}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center">
          {analyzing ? (
            <button type="button" onClick={cancel} className={secondaryButton}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={onFillMyself}
              className="text-muted hover:text-foreground px-2 py-2 text-sm font-medium transition-colors"
            >
              I&apos;ll fill it in myself
            </button>
          )}
          <button type="button" onClick={analyze} disabled={analyzing} className={primaryButton}>
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Setting it up… about a minute
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Set it up with AI
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  )
}

function LinkInput({
  id,
  label,
  hint,
  placeholder,
  icon,
  value,
  error,
  disabled,
  onChange
}: {
  id: string
  label: string
  hint: string
  placeholder: string
  icon: React.ReactNode
  value: string
  error?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="text-foreground mb-1.5 block text-sm font-medium">
        {label}
        <span className="text-muted ml-1.5 text-xs font-normal">{hint}</span>
      </label>
      <div className="relative">
        <span className="text-muted pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
          {icon}
        </span>
        <input
          id={id}
          type="url"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={`${inputClass} pl-9 ${error ? 'border-red-500/60 ring-1 ring-red-500/30' : ''}`}
        />
      </div>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  )
}

/** The last step: everything editable, then one save creates the identity. */
function ReviewStep({
  platforms,
  values,
  setValues,
  accountType,
  setAccountType,
  styles,
  onStyleChange,
  notes,
  onNoteChange,
  aiFilled,
  onEdited,
  aiStyles,
  usedAi,
  onChangePlatforms,
  onRedo
}: {
  platforms: PlatformId[]
  values: IdentityValues
  setValues: React.Dispatch<React.SetStateAction<IdentityValues>>
  accountType: AccountType
  setAccountType: (value: AccountType) => void
  styles: Record<string, ContentStyle>
  onStyleChange: (platform: PlatformId, style: ContentStyle) => void
  notes: Notes
  onNoteChange: (platform: PlatformId, note: PlatformCardNote) => void
  aiFilled: ReadonlySet<string>
  onEdited: (field: string) => void
  aiStyles: ReadonlySet<PlatformId>
  usedAi: boolean
  onChangePlatforms: () => void
  onRedo: () => void
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [errors, setErrors] = useState<IdentityFieldErrors>({})
  const [saving, setSaving] = useState(false)
  // The header and the button below can both save; only one create may run.
  // (The server creates at most one identity per user anyway.)
  const creating = useRef(false)

  // Creates the identity, then goes to the page the action names (the Voice
  // step, or Profile when AI suggestions for the other steps are waiting).
  const save = async (): Promise<boolean> => {
    if (creating.current) return false
    const found = validateIdentityValues(values)
    setErrors(found)
    if (Object.keys(found).length > 0 || !formRef.current) {
      const first = Object.keys(found)[0]
      if (first) {
        const field = formRef.current?.querySelector<HTMLElement>(`#${first}`)
        field?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        field?.focus({ preventScroll: true })
      }
      return false
    }
    creating.current = true
    setSaving(true)
    try {
      const { redirectTo } = await createAccount(new FormData(formRef.current))
      // Stays busy until the next page replaces this one. When the identity
      // already existed that is this same URL, so refresh to render it.
      router.push(redirectTo)
      router.refresh()
    } catch (err: any) {
      creating.current = false
      setSaving(false)
      showToast({
        type: 'error',
        title: 'Could not create identity',
        message: err?.message || 'Please try again.'
      })
    }
    return false
  }
  useStepSave(save)

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={e => {
        e.preventDefault()
        void save()
      }}
      className="space-y-5"
    >
      {usedAi && <input type="hidden" name="claimAiDraft" value="1" />}
      <input type="hidden" name="platforms" value={JSON.stringify(platforms)} />
      <input type="hidden" name="styles" value={JSON.stringify(styles)} />
      <input type="hidden" name="notes" value={JSON.stringify(notes)} />

      {usedAi && (
        <div className="border-accent/30 bg-accent/5 flex items-start gap-3 rounded-xl border px-4 py-3">
          <Sparkles className="text-accent mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="text-foreground font-medium">
              We filled this in from what you wrote. Check it and change anything.
            </p>
            <p className="text-muted">
              Nothing is saved until you create the identity. Voice, goals and
              knowledge suggestions come next.
            </p>
          </div>
          <button
            type="button"
            onClick={onRedo}
            className="text-muted hover:text-foreground shrink-0 text-xs font-medium"
          >
            Rewrite
          </button>
        </div>
      )}

      <SectionCard
        title="Your platforms"
        description="Pick a style for each platform: you can be professional on one and fun on another. Edit to say who follows you there and how you sound."
        aside={
          <button
            type="button"
            onClick={onChangePlatforms}
            className="text-accent hover:text-accent-hover shrink-0 text-xs font-medium"
          >
            Change platforms
          </button>
        }
      >
        <div className="space-y-3">
          <PlatformCards
            platforms={platforms}
            styles={styles}
            notes={notes}
            onStyleChange={onStyleChange}
            onNoteChange={onNoteChange}
            aiPicked={aiStyles}
          />
          <StyleLegend />
        </div>
      </SectionCard>

      <IdentityFields
        values={values}
        errors={errors}
        aiFilled={aiFilled}
        accountType={accountType}
        onAccountTypeChange={setAccountType}
        onChange={(field, value) => {
          setValues(prev => ({ ...prev, [field]: value }))
          onEdited(field)
          if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }))
        }}
      />

      <div className="flex justify-end">
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? 'Creating…' : 'Create identity'}
        </button>
      </div>
    </form>
  )
}
