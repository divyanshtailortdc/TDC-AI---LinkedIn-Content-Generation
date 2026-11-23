'use client'

import { buttonClassName } from '@/components/button'
import { ProgressBar } from '@/components/ui/meter'
import { cn } from '@/lib/cn'
import { STEP_CONTENT } from '@/lib/onboarding/content'
import { stepForPath, type OnboardingStepKey } from '@/lib/onboarding/progress'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Compass,
  Loader2,
  PartyPopper,
  X
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useSyncExternalStore } from 'react'
import { useOnboarding } from './onboarding-provider'
import { StepDetails, useBufferOutcome } from './step-details'

/** Which step the user folded the instructions away on; they stay folded there. */
const FOLDED_KEY = 'onboarding-guide-folded'

const foldListeners = new Set<() => void>()

function subscribeFolded(listener: () => void) {
  foldListeners.add(listener)
  return () => {
    foldListeners.delete(listener)
  }
}

function readFolded(): string | null {
  try {
    return window.sessionStorage.getItem(FOLDED_KEY)
  } catch {
    return null
  }
}

function writeFolded(step: string | null) {
  try {
    if (step) window.sessionStorage.setItem(FOLDED_KEY, step)
    else window.sessionStorage.removeItem(FOLDED_KEY)
  } catch {
    // Private mode: folding just is not remembered.
  }
  for (const listener of foldListeners) listener()
}

/**
 * The getting-started bar above every page until the first post is out:
 * how far along the user is, the next step, and on that step's own page,
 * what to click. It ticks a step off as soon as its data is saved, and says
 * what comes next. The dashboard has the full checklist, so the bar is not
 * shown there; it can be hidden, and shown again from the dashboard.
 */
export function OnboardingGuideBar() {
  const ctx = useOnboarding()
  const pathname = usePathname()
  const outcome = useBufferOutcome()
  // null: follow the page (open on the current step's page); else the user's choice.
  const [open, setOpen] = useState<boolean | null>(null)
  const [hiding, setHiding] = useState(false)
  // Read after hydration (the server has no sessionStorage), so the first
  // paint matches the server's.
  const foldedStep = useSyncExternalStore(
    subscribeFolded,
    readFolded,
    () => null
  )

  if (!ctx) return null
  const { view, change } = ctx
  const { progress } = view
  if (view.hidden || pathname === '/') return null

  const hide = async () => {
    setHiding(true)
    await change({ hidden: true })
    setHiding(false)
  }

  if (progress.complete) {
    const published = view.facts.publication?.draftId
    return (
      <Shell>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <PartyPopper className="h-4 w-4" />
          </span>
          <p className="text-foreground min-w-0 flex-1 text-[13px]">
            <span className="font-semibold">Your first post is out.</span>{' '}
            <span className="text-muted">
              You&apos;re all set up: generate ideas whenever you want more
              posts.
            </span>
          </p>
          {published && (
            <Link
              href={`/posts/${published}`}
              className={buttonClassName({ size: 'sm', variant: 'secondary' })}
            >
              View post
            </Link>
          )}
          <button
            type="button"
            onClick={() => void hide()}
            disabled={hiding}
            className={buttonClassName({ size: 'sm' })}
          >
            {hiding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Finish
          </button>
        </div>
      </Shell>
    )
  }

  const current = progress.current
  if (!current) return null
  const currentStep = progress.steps.find(s => s.key === current)!
  const pageStepKey = stepForPath(pathname, current)
  const pageStep = pageStepKey
    ? progress.steps.find(s => s.key === pageStepKey)
    : null
  const onCurrentPage = pageStepKey === current
  // The step this page is for was just finished: say so, and point onward.
  const justDone =
    pageStep &&
    pageStep.key !== current &&
    (pageStep.status === 'done' || pageStep.status === 'skipped')
      ? pageStep
      : null

  // Open by itself on the current step's page (the identity wizard explains
  // itself), unless folded there before; and after coming back from Buffer.
  const autoOpen =
    Boolean(outcome) ||
    (onCurrentPage && current !== 'profile' && foldedStep !== current)
  const expanded = open ?? autoOpen
  const toggle = () => {
    const next = !expanded
    setOpen(next)
    if (onCurrentPage) writeFolded(next ? null : current)
  }

  const stepNumber =
    progress.steps
      .filter(s => s.status !== 'unavailable')
      .findIndex(s => s.key === current) + 1
  const content = STEP_CONTENT[current]

  return (
    <Shell>
      <div className="flex items-center gap-x-3 px-4 py-2 sm:px-6">
        <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
          <span className="bg-brand/15 text-brand-strong flex h-7 w-7 items-center justify-center rounded-full">
            <Compass className="h-4 w-4" />
          </span>
          <div className="w-28">
            <p className="text-foreground text-[11px] leading-4 font-semibold tracking-wide uppercase">
              Getting started
            </p>
            <div className="mt-1 flex items-center gap-2">
              <ProgressBar
                value={progress.completed}
                max={progress.total}
                size="xs"
                label="Getting started progress"
              />
              <span className="text-muted shrink-0 text-[11px] tabular-nums">
                {progress.completed}/{progress.total}
              </span>
            </div>
          </div>
        </div>
        <span
          aria-hidden
          className="bg-border hidden h-8 w-px shrink-0 sm:block"
        />

        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="group flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
        >
          {justDone ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : currentStep.status === 'working' ? (
            <Loader2 className="text-brand-strong h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <span className="bg-accent text-background flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums">
              {stepNumber}
            </span>
          )}
          <span className="min-w-0 truncate text-[13px]">
            {justDone && (
              <span className="text-foreground font-semibold">
                {doneLine(justDone.key, justDone.status === 'skipped')}{' '}
              </span>
            )}
            <span
              className={
                justDone ? 'text-muted' : 'text-foreground font-semibold'
              }
            >
              {justDone || !onCurrentPage ? 'Next: ' : ''}
              {content.title}
            </span>
            {!justDone && onCurrentPage && (
              <span className="text-muted hidden md:inline">
                {' '}
                · {content.summary}
              </span>
            )}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              'text-muted group-hover:text-foreground h-4 w-4 shrink-0 transition-transform',
              expanded && 'rotate-180'
            )}
          />
          <span className="sr-only">
            {expanded ? 'Hide the instructions' : 'Show the instructions'}
          </span>
        </button>

        {!onCurrentPage && (
          <Link
            href={currentStep.href}
            className={buttonClassName({
              size: 'sm',
              className: 'shrink-0 font-semibold'
            })}
          >
            <span className="hidden sm:inline">
              {justDone ? 'Continue' : 'Go'}
            </span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <button
          type="button"
          onClick={() => void hide()}
          disabled={hiding}
          title="Hide the guide (show it again from the dashboard)"
          aria-label="Hide the getting started guide"
          className="text-muted hover:bg-surface-hover hover:text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors"
        >
          {hiding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="max-h-[45vh] overflow-y-auto px-4 pb-4 sm:px-6 sm:pl-[3.25rem]">
          <div className="max-w-3xl space-y-3">
            {outcome && (
              <p
                role="status"
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-[13px]',
                  outcome.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300'
                )}
              >
                {outcome.message}
              </p>
            )}
            {!onCurrentPage && (
              <p className="text-muted text-[13px]">{content.summary}</p>
            )}
            <StepDetails step={currentStep} onPage={onCurrentPage} />
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Getting started guide"
      className="border-border bg-surface relative z-20 shrink-0 border-b shadow-xs"
    >
      {children}
    </section>
  )
}

/** What the page's step being finished means, in a few words. */
function doneLine(key: OnboardingStepKey, skipped: boolean) {
  if (skipped) return `${STEP_CONTENT[key].title}: skipped for now.`
  const DONE: Partial<Record<OnboardingStepKey, string>> = {
    profile: 'Identity created.',
    voice: 'Voice saved.',
    knowledge: 'Source added.',
    goals: 'Goal saved.',
    preferences: 'Preferences confirmed.',
    brandTheme: 'Brand theme saved.',
    buffer: 'Buffer connected.',
    channels: 'Channels confirmed.',
    ideas: 'Your ideas are ready.',
    post: 'Your post is written.',
    review: 'Post approved.'
  }
  return DONE[key] ?? 'Done.'
}
