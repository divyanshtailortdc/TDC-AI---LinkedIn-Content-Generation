'use client'

import { useSuggestedSections } from '@/components/ai-setup/draft-store'
import { ThemeToggle } from '@/components/theme-toggle'
import type { SetupSection } from '@/lib/ai/skills/profile-setup/schema'
import { Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { SETUP_STEPS } from './steps'

// ---------------------------------------------------------------------------
// Save & Next: the step's form hands its save to the header button
// ---------------------------------------------------------------------------

/** Saves the step; resolves false when it failed and the user should stay. */
type StepSave = () => Promise<boolean> | boolean

const StepSaveContext = createContext<{
  setSave: (save: StepSave | null) => void
} | null>(null)

/**
 * Lets a step's form take part in the header's Save & Next. The latest
 * `save` is always the one called, so it can read current form state.
 */
export function useStepSave(save: StepSave) {
  const ctx = useContext(StepSaveContext)
  const latest = useRef(save)
  useEffect(() => {
    latest.current = save
  })
  useEffect(() => {
    if (!ctx) return
    ctx.setSave(() => latest.current())
    return () => ctx.setSave(null)
  }, [ctx])
}

// ---------------------------------------------------------------------------
// Step bar
// ---------------------------------------------------------------------------

/**
 * The numbered step bar with connectors. Steps link to their pages when an
 * account exists; on the create page they are shown but not clickable yet.
 */
export function SetupStepper({
  activeIndex,
  accountId,
  draftKey
}: {
  activeIndex: number
  accountId?: string
  /** Which AI draft decides the "suggestions ready" dots. */
  draftKey: string
}) {
  const suggested = useSuggestedSections(draftKey)

  return (
    <nav aria-label="Setup steps">
      <ol className="flex items-start">
        {SETUP_STEPS.map((step, index) => {
          const active = index === activeIndex
          const Icon = step.icon
          const hasSuggestions = suggested.has(step.key as SetupSection)

          const content = (
            <>
              <span
                className={`relative flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-accent text-background shadow-sm'
                    : step.optional
                      ? 'border-border bg-surface text-muted group-hover:text-foreground border border-dashed'
                      : 'border-border bg-surface text-muted group-hover:border-accent/40 group-hover:text-foreground border'
                }`}
              >
                {active ? index + 1 : <Icon className="h-3.5 w-3.5" />}
                {hasSuggestions && (
                  <span
                    title="AI suggestions ready"
                    className="border-surface absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 bg-indigo-500"
                  />
                )}
              </span>
              <span
                className={`flex items-center gap-1 text-xs whitespace-nowrap transition-colors ${
                  active
                    ? 'text-foreground font-semibold'
                    : 'text-muted group-hover:text-foreground hidden font-medium sm:flex'
                }`}
              >
                {step.label}
                {step.optional && (
                  <span className="rounded bg-amber-100 px-1 text-[9px] leading-3.5 font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                    Opt
                  </span>
                )}
              </span>
            </>
          )

          return (
            <Fragment key={step.key}>
              {index > 0 && (
                <li
                  aria-hidden
                  className="bg-border mx-1.5 mt-4 h-px min-w-3 flex-1 sm:mx-2.5"
                />
              )}
              <li className="flex shrink-0 flex-col items-center">
                {accountId ? (
                  <Link
                    href={`/accounts/${accountId}${step.path}`}
                    aria-current={active ? 'step' : undefined}
                    className="group flex flex-col items-center gap-1.5"
                  >
                    {content}
                  </Link>
                ) : (
                  <span
                    aria-current={active ? 'step' : undefined}
                    className="group flex cursor-default flex-col items-center gap-1.5"
                  >
                    {content}
                  </span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

/**
 * The frame shared by every setup step, filling exactly the screen: a header
 * card (who, the steps, theme, Save & Next), then the AI Suggestions card
 * beside one main card holding the step's title and content. Only the body
 * scrolls.
 */
export function SetupFrame({
  identity,
  nav,
  aside,
  stepIndex,
  nextHref,
  title,
  description,
  children
}: {
  identity: ReactNode
  nav: ReactNode
  aside: ReactNode
  stepIndex: number
  /** Where Save & Next goes after a successful save; none on the last step. */
  nextHref?: string
  /** Override the step's own title and description. */
  title?: string
  description?: string
  children: ReactNode
}) {
  const router = useRouter()
  const step = SETUP_STEPS[stepIndex]!
  const isLast = stepIndex === SETUP_STEPS.length - 1

  const saveRef = useRef<StepSave | null>(null)
  const setSave = useCallback((save: StepSave | null) => {
    saveRef.current = save
  }, [])
  const ctx = useMemo(() => ({ setSave }), [setSave])
  const [saving, setSaving] = useState(false)

  const saveAndNext = async () => {
    setSaving(true)
    try {
      const ok = saveRef.current ? await saveRef.current() : true
      if (ok && nextHref) router.push(nextHref)
    } finally {
      setSaving(false)
    }
  }

  return (
    <StepSaveContext.Provider value={ctx}>
      <div className="bg-surface-hover/40 flex h-dvh min-h-0 flex-col">
        <div className="shrink-0 px-4 pt-4 sm:px-6">
          {/* Sized by its own width, not the screen's: the app sidebar takes
              part of the screen, so a "wide" screen can still be a narrow header. */}
          <header className="border-border bg-surface @container mx-auto max-w-screen-2xl rounded-2xl border px-4 py-3 shadow-xs sm:px-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex min-w-0 flex-1 items-center gap-3 @4xl:w-44 @4xl:flex-none">
                {identity}
              </div>

              <div className="order-last w-full @4xl:order-0 @4xl:w-auto @4xl:flex-1">
                {nav}
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                <div className="border-border rounded-xl border">
                  <ThemeToggle />
                </div>
                {!isLast && (
                  <button
                    type="button"
                    onClick={saveAndNext}
                    disabled={saving}
                    className="bg-accent hover:bg-accent-hover text-background inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold whitespace-nowrap shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:h-10"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    {saving ? 'Saving…' : 'Save & Next'}
                  </button>
                )}
              </div>
            </div>
          </header>
        </div>

        {/* On wide screens both cards fill the remaining height and width on
            every step, and only the main card's content scrolls. Narrower
            screens stack the cards and let the page scroll instead. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:pb-5 xl:overflow-hidden">
          <div className="mx-auto grid max-w-screen-2xl gap-5 xl:h-full xl:grid-cols-[16rem_minmax(0,1fr)]">
            <aside className="min-h-0 xl:h-full">{aside}</aside>

            <section className="border-border bg-surface flex min-h-0 min-w-0 flex-col rounded-xl border shadow-xs xl:h-full">
              <div className="flex shrink-0 items-start justify-between gap-4 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
                <div className="min-w-0">
                  <h1 className="text-foreground text-lg font-bold tracking-tight">
                    {title ?? step.title}
                  </h1>
                  <p className="text-muted mt-0.5 text-sm">
                    {description ?? step.description}
                  </p>
                </div>
                <span className="border-border bg-surface text-foreground shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium">
                  Step {stepIndex + 1} of {SETUP_STEPS.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 px-4 pb-4 sm:px-6 sm:pb-5 xl:overflow-y-auto">
                {children}
              </div>
            </section>
          </div>
        </div>
      </div>
    </StepSaveContext.Provider>
  )
}
