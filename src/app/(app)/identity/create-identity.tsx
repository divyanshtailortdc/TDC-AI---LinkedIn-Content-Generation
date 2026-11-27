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
  linkFieldKey,
  SectionCard,
  validateIdentityValues,
  type AccountType,
  type IdentityFieldErrors,
  type IdentityValues
} from '@/components/identity-fields'
import { PlatformMark } from '@/components/platform-mark'
import { PlatformCards, type PlatformCardNote } from '@/components/platform-cards'
import { showToast } from '@/components/toast-notification'
import { FIELD_CLASS, TextArea } from '@/components/ui/field'
import type { IdentitySetupAnalysis } from '@/lib/ai/skills/profile-setup/schema'
import { cn } from '@/lib/cn'
import {
  DEFAULT_STYLES,
  CREATABLE_PLATFORMS,
  PLATFORMS,
  type ContentStyle,
  type PlatformId
} from '@/lib/formats'
import { EMPTY_PROFILE, optionalUrlError } from '@/lib/identity-profile'
import {
  mainProfileLink,
  platformOfLink,
  profileLinkErrors,
  profileLinkPlaceholder,
  type ProfileLinks
} from '@/lib/profile-links'
import { profileSuggestionValues } from '@/lib/settings-merge'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Loader2,
  Sparkles,
  UsersRound
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  createProgressKey,
  parseCreateProgress,
  serializeCreateProgress
} from '@/lib/onboarding/create-progress'
import { createAccount } from './actions'

/**
 * Onboarding: creating the identity, in three short steps.
 *
 * 1. Where do you post? The platforms decide which formats are drafted.
 * 2. Tell us about you, in your own words (and your profile link on each
 *    platform, and your website). The AI fills
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

/** The typed links of the picked platforms, trimmed; empty ones left out. */
const linksFor = (platforms: PlatformId[], links: ProfileLinks): ProfileLinks =>
  Object.fromEntries(
    platforms
      .map(p => [p, links[p]?.trim() ?? ''] as const)
      .filter(([, url]) => url)
  )

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
  const [about, setAbout] = useState<About>({ description: '', links: {}, websiteUrl: '' })
  const [values, setValues] = useState<IdentityValues>(EMPTY_PROFILE)
  const [links, setLinks] = useState<ProfileLinks>({})
  const [accountType, setAccountType] = useState<AccountType>('personal')
  const [styles, setStyles] = useState<Styles>({})
  const [notes, setNotes] = useState<Notes>({})
  // What still holds the AI's suggestion, marked until edited.
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set())
  const [aiStyles, setAiStyles] = useState<Set<PlatformId>>(new Set())
  const [usedAi, setUsedAi] = useState(false)

  // What the person entered is kept in this browser until the identity is
  // created, so leaving half way resumes here (src/lib/onboarding/create-progress).
  // Restored after the first render: the server has no storage to read.
  const progressKey = createProgressKey(another)
  const [resumed, setResumed] = useState(false)
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    let saved = null
    try {
      saved = parseCreateProgress(window.localStorage.getItem(progressKey))
    } catch {
      // Storage blocked: nothing to resume.
    }
    if (!saved || (saved.platforms.length === 0 && !saved.about.description)) return
    setPlatforms(saved.platforms)
    setAbout(saved.about)
    setValues(saved.values)
    setLinks(saved.links)
    setAccountType(saved.accountType)
    setStyles(saved.styles)
    setNotes(saved.notes)
    setUsedAi(saved.usedAi)
    setStep(saved.step)
    setResumed(true)
  }, [progressKey])
  useEffect(() => {
    // Not before the restore has run, or it would overwrite what it reads.
    if (!restored.current) return
    if (platforms.length === 0 && !about.description.trim()) return
    try {
      window.localStorage.setItem(
        progressKey,
        serializeCreateProgress({ step, platforms, about, values, links, accountType, styles, notes, usedAi })
      )
    } catch {
      // Storage full or blocked: the wizard still works, it just won't resume.
    }
  }, [progressKey, step, platforms, about, values, links, accountType, styles, notes, usedAi])
  const forgetProgress = () => {
    try {
      window.localStorage.removeItem(progressKey)
    } catch {
      // Nothing kept.
    }
  }
  const startOver = () => {
    forgetProgress()
    setPlatforms([])
    setAbout({ description: '', links: {}, websiteUrl: '' })
    setValues(EMPTY_PROFILE)
    setLinks({})
    setAccountType('personal')
    setStyles({})
    setNotes({})
    setAiFilled(new Set())
    setAiStyles(new Set())
    setUsedAi(false)
    setStep('where')
    setResumed(false)
  }

  /** The person skipped the AI: their own words and links start the form. */
  const fillMyself = () => {
    setValues(prev => ({
      ...prev,
      description: prev.description || about.description.trim(),
      websiteUrl: prev.websiteUrl || about.websiteUrl.trim()
    }))
    setLinks(prev => ({ ...linksFor(platforms, about.links), ...linksFor(platforms, prev) }))
    setStep('review')
  }

  const applyAnalysis = (analysis: IdentitySetupAnalysis) => {
    const suggested = profileSuggestionValues(analysis.suggestions.profile)
    // The AI suggests one profile link; the form keeps one per platform.
    const filled = Object.entries(suggested).filter(
      ([key, v]) => key !== 'linkedinUrl' && typeof v === 'string' && v.trim()
    ) as Array<[keyof IdentityValues, string]>
    setValues({
      ...EMPTY_PROFILE,
      description: about.description.trim(),
      ...Object.fromEntries(filled),
      // Links the person typed are theirs; the AI's only fill a blank.
      ...(about.websiteUrl.trim() ? { websiteUrl: about.websiteUrl.trim() } : {})
    })
    // Links the person typed are theirs; the AI's fill the picked platforms
    // left blank: its LinkedIn page (the one link the profile suggests), and
    // the accounts research found on the others.
    const typed = linksFor(platforms, about.links)
    const found: ProfileLinks = { ...analysis.profileLinks }
    const aiLink = suggested.linkedinUrl?.trim()
    const aiOn = aiLink ? platformOfLink(aiLink) : null
    if (aiLink && aiOn && !found[aiOn]) found[aiOn] = aiLink
    const aiLinks = platforms.filter(p => !typed[p] && found[p]?.trim())
    setLinks({ ...typed, ...Object.fromEntries(aiLinks.map(p => [p, found[p]!.trim()])) })
    setAiFilled(
      new Set([
        ...filled
          .map(([key]) => key as string)
          .filter(key => !(key === 'websiteUrl' && about.websiteUrl.trim())),
        ...aiLinks.map(linkFieldKey)
      ])
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
      hideStepCount
      title={another ? 'Create Another Identity' : 'Create Your Identity'}
      description={
        another
          ? 'A separate brand or persona with its own voice and goals.'
          : 'Choose your platforms, describe yourself, and review your profile.'
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
      <div className="mx-auto w-full max-w-5xl space-y-8 py-2 sm:py-6">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm sm:gap-x-3" aria-label="Progress">
          {STEPS.map((s, i) => {
            const index = STEPS.findIndex(x => x.key === step)
            const done = i < index
            const active = s.key === step
            return (
              <li key={s.key} className="flex items-center gap-2 sm:gap-3">
                {i > 0 && <span aria-hidden className="bg-border h-px w-5 sm:w-10" />}
                <button
                  type="button"
                  disabled={!reachable(s.key) || active}
                  onClick={() => setStep(s.key)}
                  aria-current={active ? 'step' : undefined}
                  className={`inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 font-medium transition-colors disabled:cursor-default ${active ? 'pr-3.5' : 'pr-1.5 sm:pr-3.5'} ${
                    active
                      ? 'bg-accent/10 text-accent'
                      : done
                        ? 'text-foreground hover:bg-surface-hover'
                        : 'text-muted'
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                      active
                        ? 'bg-accent text-background'
                        : done
                          ? 'bg-accent/15 text-accent'
                          : 'border-border border'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  {/* On phones only the current step is named, so the bar fits one line. */}
                  <span className={active ? '' : 'sr-only sm:not-sr-only'}>{s.label}</span>
                </button>
              </li>
            )
          })}
        </ol>

        {resumed && (
          <p
            role="status"
            className="border-border bg-surface-hover/50 text-muted flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3.5 py-2.5 text-sm"
          >
            <span>
              <span className="text-foreground font-medium">Welcome back.</span> We kept what you
              entered last time, so you can carry on where you left off.
            </span>
            <button
              type="button"
              onClick={startOver}
              className="text-foreground font-medium underline underline-offset-2 hover:no-underline"
            >
              Start over
            </button>
          </p>
        )}

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
            links={links}
            setLinks={setLinks}
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
            onCreated={forgetProgress}
          />
        )}
      </div>
    </SetupFrame>
  )
}

const primaryButton =
  'bg-accent hover:bg-accent-hover text-background inline-flex h-11 items-center justify-center gap-2 rounded-lg px-6 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton =
  'border-border text-foreground hover:bg-surface-hover inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-5 text-sm font-medium transition-colors disabled:opacity-50'
const inputClass = cn(FIELD_CLASS, 'bg-surface px-4 py-2.5 text-[15px]')

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
        : CREATABLE_PLATFORMS.filter(p => p === platform || platforms.includes(p))
    )
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
          {another ? 'Where does this identity post?' : 'Where do you post?'}
        </h2>

<p className="text-muted mt-1.5 text-sm leading-relaxed sm:text-[15px]">
  Select platforms for this identity. Each gets its own style and content goals. You can change this later in Preferences.
</p>

      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CREATABLE_PLATFORMS.map(platform => {
          const selected = platforms.includes(platform)
          return (
            <button
              key={platform}
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => toggle(platform)}
              className={`flex min-h-24 items-center gap-4 rounded-2xl border px-5 py-5 text-left transition-all ${
                selected
                  ? 'border-accent bg-accent/5 ring-accent/20 ring-2'
                  : 'border-border bg-surface hover:border-accent/40 hover:bg-surface-hover hover:shadow-sm'
              }`}
            >
              <span
                className="bg-surface-hover flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
              >
                <PlatformMark platform={platform} colored className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-base font-semibold">
                  {PLATFORMS[platform].label}
                </span>
                <span className="text-muted mt-0.5 block text-sm">{PLATFORM_HINTS[platform]}</span>
              </span>
              <span
                aria-hidden
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
                  selected ? 'border-accent bg-accent text-background' : 'border-border'
                }`}
              >
                {selected && <Check className="h-4 w-4" />}
              </span>
            </button>
          )
        })}
      </div>
   
      <div className="flex items-center justify-end gap-4 pt-2">
        {platforms.length === 0 && (
          <span className="text-muted text-sm">Pick at least one platform.</span>
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

type About = { description: string; links: ProfileLinks; websiteUrl: string }

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
  const [urlErrors, setUrlErrors] = useState<{
    links?: Partial<Record<PlatformId, string>>
    websiteUrl?: string
  }>({})
  // Cancel aborts the request (which stops the analysis on the server); a
  // response that still arrives after it is ignored.
  const controller = useRef<AbortController | null>(null)
  const requestId = useRef(0)

  const set = (field: 'description' | 'websiteUrl', next: string) => {
    onChange({ ...value, [field]: next })
    if (field === 'websiteUrl') setUrlErrors(prev => ({ ...prev, websiteUrl: undefined }))
    setError(null)
  }
  const setLink = (platform: PlatformId, next: string) => {
    onChange({ ...value, links: { ...value.links, [platform]: next } })
    setUrlErrors(prev => ({ ...prev, links: { ...prev.links, [platform]: undefined } }))
    setError(null)
  }

  const analyze = async () => {
    if (!value.description.trim()) {
      setError('Write a few words about yourself first, or fill it in yourself.')
      return
    }
    const links = linksFor(platforms, value.links)
    const found = {
      links: profileLinkErrors(links),
      websiteUrl: optionalUrlError(value.websiteUrl)
    }
    setUrlErrors(found)
    if (Object.keys(found.links).length > 0 || found.websiteUrl) return
    setError(null)
    setAnalyzing(true)
    const current = ++requestId.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    // The analysis reads one profile link: the main one.
    const input = {
      description: value.description.trim(),
      linkedinUrl: mainProfileLink(links) ?? '',
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
          // Every link typed; the picked platforms without one are looked up.
          profileLinks: links,
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
    <section className="space-y-6">
      <div>
        <h2 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">Tell us about you</h2>

      </div>

      <div>
        <label htmlFor="about-description" className="text-foreground mb-2 block text-base font-semibold">
          What do you post about, and who is it for?
        </label>
        <TextArea
          id="about-description"
          value={value.description}
          disabled={analyzing}
          onChange={e => set('description', e.target.value)}
          rows={5}
          autoGrow={false}
          placeholder="e.g. I'm a dance teacher in Pune. I post short dance tutorials for teens learning at home."
          className={cn(inputClass, 'scrollbar-visible h-48 px-4 py-3 leading-relaxed')}
        />
      </div>
    
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {platforms.map(platform => (
          <LinkInput
            key={platform}
            id={`about-link-${platform}`}
            label={`${PLATFORMS[platform].label} profile`}
            hint="(optional)"
            placeholder={profileLinkPlaceholder(platform)}
            icon={<PlatformMark platform={platform} colored className="h-4.5 w-4.5" />}
            value={value.links[platform] ?? ''}
            error={urlErrors.links?.[platform]}
            disabled={analyzing}
            onChange={v => setLink(platform, v)}
          />
        ))}
        <LinkInput
          id="about-website"
          label="Website"
          hint="(optional)"
          placeholder="https://example.com"
          icon={<Globe className="h-4.5 w-4.5" />}
          value={value.websiteUrl}
          error={urlErrors.websiteUrl}
          disabled={analyzing}
          onChange={v => set('websiteUrl', v)}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{error}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
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
              className="text-muted hover:text-foreground px-3 py-2.5 text-sm font-medium transition-colors"
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
      <label htmlFor={id} className="text-foreground mb-2 block text-[15px] font-semibold">
        {label}
        <span className="text-muted ml-1.5 text-sm font-normal">{hint}</span>
      </label>
      <div className="relative">
        <span className="text-muted pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2">
          {icon}
        </span>
        <input
          id={id}
          type="url"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={cn(inputClass, 'h-11 pl-10', error && 'border-red-500/60 ring-1 ring-red-500/30')}
        />
      </div>
      {error && <p className="mt-1.5 text-sm text-red-500">{error}</p>}
    </div>
  )
}

/** The last step: everything editable, then one save creates the identity. */
function ReviewStep({
  platforms,
  values,
  setValues,
  links,
  setLinks,
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
  onRedo,
  onCreated
}: {
  platforms: PlatformId[]
  values: IdentityValues
  setValues: React.Dispatch<React.SetStateAction<IdentityValues>>
  /** A profile link per picked platform. */
  links: ProfileLinks
  setLinks: React.Dispatch<React.SetStateAction<ProfileLinks>>
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
  /** The identity was created: what was kept for resuming can go. */
  onCreated: () => void
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [errors, setErrors] = useState<IdentityFieldErrors>({})
  const [linkErrors, setLinkErrors] = useState<Partial<Record<PlatformId, string>>>({})
  const [saving, setSaving] = useState(false)
  // Only the picked platforms' links are kept; one typed for a platform
  // since unpicked is left out.
  const pickedLinks = linksFor(platforms, links)
  // The header and the button below can both save; only one create may run.
  // (The server creates at most one identity per user anyway.)
  const creating = useRef(false)

  // Creates the identity, then goes to the page the action names (the Voice
  // step, or Profile when AI suggestions for the other steps are waiting).
  const save = async (): Promise<boolean> => {
    if (creating.current) return false
    const found = validateIdentityValues(values)
    const badLinks = profileLinkErrors(pickedLinks)
    setErrors(found)
    setLinkErrors(badLinks)
    if (
      Object.keys(found).length > 0 ||
      Object.keys(badLinks).length > 0 ||
      !formRef.current
    ) {
      const first =
        Object.keys(found)[0] ??
        platforms.filter(p => badLinks[p]).map(linkFieldKey)[0]
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
      onCreated()
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
      <input type="hidden" name="profileLinks" value={JSON.stringify(pickedLinks)} />

      {usedAi && (
        <div className="border-accent/30 bg-accent/5 flex items-start gap-3 rounded-xl border px-4 py-3">
          <Sparkles className="text-accent mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 text-xs leading-relaxed">
            <p className="text-foreground font-medium">
              We filled this in for you. Check it and edit anything.
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
        <PlatformCards
          platforms={platforms}
          styles={styles}
          notes={notes}
          onStyleChange={onStyleChange}
          onNoteChange={onNoteChange}
          aiPicked={aiStyles}
        />
      </SectionCard>

      <IdentityFields
        values={values}
        errors={errors}
        aiFilled={aiFilled}
        accountType={accountType}
        onAccountTypeChange={setAccountType}
        links={{
          platforms,
          values: links,
          errors: linkErrors,
          onChange: (platform, value) => {
            setLinks(prev => ({ ...prev, [platform]: value }))
            onEdited(linkFieldKey(platform))
            if (linkErrors[platform]) {
              setLinkErrors(prev => ({ ...prev, [platform]: undefined }))
            }
          }
        }}
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
