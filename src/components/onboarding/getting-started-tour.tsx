'use client'

import { cn } from '@/lib/cn'
import { IDENTITY_PATH } from '@/lib/identity-path'
import { ArrowRight, Check, Compass, X } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore
} from 'react'
import { useOnboarding } from './onboarding-provider'

/**
 * The first-run tour: a highlight with an arrowed card that points at what
 * to click next, in four steps (create the identity, pick its platforms,
 * set a goal, generate the first ideas). Which step it is comes from what is saved
 * (useOnboarding) and the page being shown, so it resumes by itself after
 * a reload. The page stays usable underneath: the highlighted control is
 * clicked as normal. Skip tour puts it away for good in this browser; it is
 * also put away once the identity has ideas or has started a run, so
 * existing users never see it.
 *
 * A step's anchor is an element marked `data-tour="…"`:
 * - create-identity: the dashboard's Create your identity button,
 * - identity-steps: the create-identity wizard's step bar (Start tour),
 * - platforms: the platform picker of the create-identity wizard,
 * - nav-goals: the sidebar's Goals link (only while its group is open),
 * - suggest-goals: the Goals page's Suggest Goals button,
 * - nav-ideas: the sidebar's Ideas link,
 * - generate-ideas: Generate ideas on the Goals page or the Ideas page.
 * Without a visible anchor (another page, the drawer closed on a phone) the
 * card shows in a corner with a button that goes there instead.
 *
 * Start tour (StartTourButton, at the top right of the create-identity
 * page) replays the four steps for anyone, with Back and Next. Next (and
 * Finish) stays disabled until the step's work is done: the identity
 * wizard opened, a platform picked, a goal saved, ideas generated. An
 * identity set up earlier counts, so a replay moves straight through what
 * is already done.
 */

const STEPS = ['identity', 'platforms', 'goals', 'ideas'] as const
type StepKey = (typeof STEPS)[number]

type Step = {
  key: StepKey
  title: string
  body: string
  /** The element to point at; none: the card sits in a corner. */
  target: string | null
  /** The card's main button; none: the highlighted control is the way on. */
  primary: { label: string; run: () => void; arrow?: boolean } | null
  /** Back to the previous step (a replay only). */
  back?: () => void
  /** Shown only beside its anchor, never in a corner. */
  needsTarget?: boolean
  /** The step's work is done; until then a replay's Next is disabled. */
  done?: boolean
}

// ── Put away (per user, in this browser) ──────────────────────────────────

const storageKey = (userId: string) => `getting-started-tour:${userId}`
const STORE_EVENT = 'getting-started-tour'

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(STORE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(STORE_EVENT, onChange)
  }
}

function readPutAway(userId: string) {
  try {
    return window.localStorage.getItem(storageKey(userId)) !== null
  } catch {
    // Storage blocked: the tour shows, and Skip hides it for this visit.
    return false
  }
}

function putAway(userId: string, how: 'skipped' | 'done') {
  try {
    window.localStorage.setItem(storageKey(userId), how)
  } catch {
    // Blocked: the in-memory flag below still hides it until a reload.
  }
  window.dispatchEvent(new Event(STORE_EVENT))
}

// ── Replay (Start tour), for this tab ──────────────────────────────────────

/**
 * Start tour walks the three steps again whatever is saved, with Back and
 * Next, until Finish or Skip. Kept for the tab (sessionStorage), so it
 * carries on across pages and reloads.
 */
const REPLAY_KEY = 'getting-started-tour:replay'
let replayInMemory: number | null = null

function readReplay(): number | null {
  let value: number | null = replayInMemory
  try {
    const raw = window.sessionStorage.getItem(REPLAY_KEY)
    value = raw === null ? null : Number(raw)
  } catch {
    // Storage blocked: the copy in memory serves this page.
  }
  return value !== null &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < STEPS.length
    ? value
    : null
}

function setReplay(step: number | null) {
  replayInMemory = step
  try {
    if (step === null) window.sessionStorage.removeItem(REPLAY_KEY)
    else window.sessionStorage.setItem(REPLAY_KEY, String(step))
  } catch {
    // Blocked: the copy in memory is used instead.
  }
  window.dispatchEvent(new Event(STORE_EVENT))
}

/** Starts the tour from its first step, for anyone, whatever is saved. */
export function startTour() {
  setReplay(0)
}

export function StartTourButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={startTour}
      className={cn(
        'border-border text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors',
        className
      )}
    >
      <Compass className="text-accent h-3.5 w-3.5" />
      Start tour
    </button>
  )
}

// ── Where the anchor is ────────────────────────────────────────────────────

type Rect = { top: number; left: number; width: number; height: number }

function visibleRect(selector: string | null): Rect | null {
  if (!selector) return null
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    // A folded sidebar group keeps its links, hidden and inert.
    if (el.closest('[inert]')) continue
    const r = el.getBoundingClientRect()
    const onScreen =
      r.width > 0 &&
      r.height > 0 &&
      r.right > 0 &&
      r.bottom > 0 &&
      r.left < window.innerWidth &&
      r.top < window.innerHeight
    if (onScreen)
      return { top: r.top, left: r.left, width: r.width, height: r.height }
  }
  return null
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height))

/** Follows the anchor as the page scrolls, resizes or re-renders. */
function useAnchorRect(selector: string | null) {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    const measure = () =>
      setRect(prev => {
        const next = visibleRect(selector)
        return sameRect(prev, next) ? prev : next
      })
    measure()
    // Anchors come and go with the page (a wizard step, a list loading), so
    // a cheap poll catches them; scroll and resize keep the card glued on.
    const timer = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [selector])
  return selector ? rect : null
}

// ── Placement ──────────────────────────────────────────────────────────────

const CARD_WIDTH = 320
const GAP = 14
const MARGIN = 16
const PAD = 6

type Side = 'right' | 'bottom' | 'top' | 'left'

function place(rect: Rect, cardHeight: number) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(CARD_WIDTH, vw - MARGIN * 2)
  const room: Record<Side, number> = {
    right: vw - (rect.left + rect.width) - PAD,
    bottom: vh - (rect.top + rect.height) - PAD,
    top: rect.top - PAD,
    left: rect.left - PAD
  }
  // Beside a narrow anchor (a sidebar link), under a wide one.
  const order: Side[] =
    rect.width < 300 ? ['right', 'bottom', 'top', 'left'] : ['bottom', 'top', 'right', 'left']
  const side =
    order.find(s =>
      s === 'right' || s === 'left'
        ? room[s] >= width + GAP + MARGIN
        : room[s] >= cardHeight + GAP + MARGIN
    ) ?? 'bottom'

  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(v, Math.max(min, max)))
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  let top: number
  let left: number
  if (side === 'right' || side === 'left') {
    left =
      side === 'right'
        ? rect.left + rect.width + PAD + GAP
        : rect.left - PAD - GAP - width
    top = clamp(centerY - cardHeight / 2, MARGIN, vh - cardHeight - MARGIN)
  } else {
    top =
      side === 'bottom'
        ? rect.top + rect.height + PAD + GAP
        : rect.top - PAD - GAP - cardHeight
    left = clamp(centerX - width / 2, MARGIN, vw - width - MARGIN)
  }
  // The arrow points at the anchor's middle, kept off the card's corners.
  const arrow =
    side === 'right' || side === 'left'
      ? clamp(centerY - top, 20, cardHeight - 20)
      : clamp(centerX - left, 20, width - 20)
  return { side, top, left, width, arrow }
}

// ── The tour ───────────────────────────────────────────────────────────────

export function GettingStartedTour({ userId }: { userId: string }) {
  const onboarding = useOnboarding()
  const pathname = usePathname()
  const router = useRouter()
  const titleId = useId()
  const storedAway = useSyncExternalStore(
    subscribe,
    () => readPutAway(userId),
    // Not on the server: it cannot know, and a flash of the card is worse.
    () => true
  )
  const [skipped, setSkipped] = useState(false)
  // "Got it" on the platform picker: no need to keep covering the wizard.
  const [seenPlatforms, setSeenPlatforms] = useState(false)
  // Suggest Goals clicked: the card makes way for the suggestions.
  const [suggestedGoals, setSuggestedGoals] = useState(false)
  // A platform was picked in the wizard (it says how many on its grid);
  // kept once seen, as the grid goes when the wizard moves on.
  const [pickedPlatforms, setPickedPlatforms] = useState(false)

  const view = onboarding?.view
  const hasIdentity = Boolean(view?.identity)
  // Ideas exist, or a run was started: the tour has done its job.
  const finished = Boolean(
    view &&
      hasIdentity &&
      (view.facts.ideas.total > 0 || view.facts.latestRun !== null)
  )
  useEffect(() => {
    if (finished && !storedAway) putAway(userId, 'done')
  }, [finished, storedAway, userId])

  const replay = useSyncExternalStore(subscribe, readReplay, () => null)

  const onIdeas = pathname === '/ideas' || pathname.startsWith('/ideas/')
  const onGoals = pathname === '/goals'
  const onDashboard = pathname === '/'
  const onCreate =
    (!hasIdentity && pathname === IDENTITY_PATH) ||
    pathname === `${IDENTITY_PATH}/new`
  const go = (href: string) => () => router.push(href)
  const hasGoals = (view?.facts.goals ?? 0) > 0
  const hasIdeas = Boolean(
    view && (view.facts.ideas.total > 0 || view.facts.latestRun !== null)
  )

  const identityBody = onCreate
    ? 'Create who you post as in three short steps: where you post, a few words about you, and a quick review. The AI can fill most of it in for you.'
    : 'Tell the engine who you post as: you, your company or a client. It uses this to write in your voice.'
  const platformsBody =
    'Pick every network you post on. Each one gets its own writing style, and you can change them later in Preferences.'
  const goalsBody = onGoals
    ? 'Click Suggest Goals and the AI proposes goals from your identity. Pick one, adjust it and save it, or add your own with New Goal.'
    : hasIdentity
      ? 'Goals say what your posts are for, such as winning clients or building a reputation. Every idea is written for one. Head to Goals to set your first.'
      : 'Once your identity is created, open Goals and click Suggest Goals: the AI proposes goals that say what your posts are for.'
  const goalsTarget = onGoals
    ? '[data-tour="suggest-goals"]'
    : '[data-tour="nav-goals"]'
  const ideasBody =
    onIdeas || onGoals
      ? 'Click Generate ideas. Choose your goals and a platform, and the engine researches your field and proposes post ideas for you to approve.'
      : hasGoals
        ? 'Your goal is set. Click Generate ideas on Goals or Ideas, and the engine researches your field and proposes your first posts.'
        : 'With a goal saved, click Generate ideas: the engine researches your field and proposes posts for you to approve.'
  const ideasTarget =
    onIdeas || onGoals
      ? '[data-tour="generate-ideas"]'
      : '[data-tour="nav-ideas"]'

  let step: Step | null = null
  if (replay !== null) {
    // Start tour: every step in turn, whatever is saved.
    const to = (index: number | null) => () => setReplay(index)
    const replaySteps: Step[] = [
      {
        key: 'identity',
        title: 'Set up your identity',
        body: identityBody,
        target: onDashboard
          ? '[data-tour="create-identity"]'
          : onCreate
            ? '[data-tour="identity-steps"]'
            : null,
        primary: { label: 'Next', run: to(1), arrow: true },
        done: hasIdentity || onCreate
      },
      {
        key: 'platforms',
        title: 'Select your platforms',
        body: platformsBody,
        target: '[data-tour="platforms"]',
        primary: { label: 'Next', run: to(2), arrow: true },
        back: to(0),
        done: hasIdentity || pickedPlatforms
      },
      {
        key: 'goals',
        title: 'Set your goals',
        body: goalsBody,
        target: goalsTarget,
        primary: { label: 'Next', run: to(3), arrow: true },
        back: to(1),
        done: hasGoals
      },
      {
        key: 'ideas',
        title: 'Generate your first ideas',
        body: ideasBody,
        target: ideasTarget,
        primary: { label: 'Finish', run: to(null) },
        back: to(2),
        done: hasIdeas
      }
    ]
    step = replaySteps[replay] ?? null
  } else if (!view || storedAway || skipped || finished) {
    step = null
  } else if (!hasIdentity) {
    if (pathname === IDENTITY_PATH) {
      step = seenPlatforms
        ? null
        : {
            key: 'platforms',
            title: 'Select your platforms',
            body: `${platformsBody} Then press Continue.`,
            target: '[data-tour="platforms"]',
            primary: { label: 'Got it', run: () => setSeenPlatforms(true) },
            needsTarget: true
          }
    } else {
      step = {
        key: 'identity',
        title: 'Set up your identity',
        body: identityBody,
        target: onDashboard ? '[data-tour="create-identity"]' : null,
        primary: onDashboard
          ? null
          : { label: 'Set up identity', run: go(IDENTITY_PATH), arrow: true }
      }
    }
  } else if (!hasGoals) {
    step =
      onGoals && suggestedGoals
        ? null
        : {
            key: 'goals',
            title: 'Set your goals',
            body: goalsBody,
            target: goalsTarget,
            primary: onGoals
              ? null
              : { label: 'Go to Goals', run: go('/goals'), arrow: true }
          }
  } else {
    step = {
      key: 'ideas',
      title: 'Generate your first ideas',
      body: ideasBody,
      target: ideasTarget,
      primary:
        onIdeas || onGoals
          ? null
          : { label: 'Go to Ideas', run: go('/ideas'), arrow: true }
    }
  }

  const rect = useAnchorRect(step?.target ?? null)

  // The card stepped aside for the goal suggestions: still waiting on a goal.
  const waitingOn =
    step && !step.done
      ? step.key
      : hasIdentity && !hasGoals && suggestedGoals && replay === null
        ? 'goals'
        : null
  useEffect(() => {
    if (waitingOn !== 'platforms') return
    const timer = setInterval(() => {
      const picked = Number(
        document.querySelector('[data-tour="platforms"]')?.getAttribute('data-selected') ?? 0
      )
      if (picked > 0) setPickedPlatforms(true)
    }, 300)
    return () => clearInterval(timer)
  }, [waitingOn])
  // A goal saved or a run started on the page being shown: re-read the
  // progress now and then, so the step is ticked off without a reload.
  const refreshOnboarding = onboarding?.refresh
  useEffect(() => {
    if (!refreshOnboarding) return
    if (waitingOn !== 'goals' && waitingOn !== 'ideas') return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshOnboarding()
    }, 5_000)
    return () => clearInterval(timer)
  }, [waitingOn, refreshOnboarding])

  // The anchor is scrolled into view once when its step begins.
  const scrolledFor = useRef<string | null>(null)
  useEffect(() => {
    if (!step?.target || scrolledFor.current === step.target) return
    const el = document.querySelector<HTMLElement>(step.target)
    if (!el) return
    scrolledFor.current = step.target
    const r = el.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight)
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })

  // Clicking Generate ideas is the last step: the tour gets out of the way
  // of the dialog it opens. Clicking Suggest Goals makes way for the
  // suggestions (a replay moves on to the last step).
  const replaying = replay !== null
  const finish = useCallback(() => {
    if (replaying) {
      setReplay(null)
      return
    }
    setSkipped(true)
    putAway(userId, 'done')
  }, [userId, replaying])
  const stepKey = step?.key ?? null
  useEffect(() => {
    if (stepKey !== 'ideas' && stepKey !== 'goals') return
    const onClick = (e: MouseEvent) => {
      const hit = (name: string) =>
        Boolean((e.target as Element | null)?.closest?.(`[data-tour="${name}"]`))
      if (stepKey === 'ideas' && hit('generate-ideas')) finish()
      if (stepKey === 'goals' && hit('suggest-goals')) {
        if (replaying) setReplay(3)
        else setSuggestedGoals(true)
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [stepKey, replaying, finish])

  const cardRef = useRef<HTMLDivElement>(null)
  const [cardHeight, setCardHeight] = useState(180)
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setCardHeight(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  })

  if (!step) return null
  // A step that only makes sense beside its anchor waits for it (the wizard
  // past its first page, the Ideas list still loading).
  const pointed = rect !== null
  if (!pointed && (step.primary === null || step.needsTarget)) return null

  const index = STEPS.indexOf(step.key)
  const skip = () => {
    if (replaying) {
      setReplay(null)
      return
    }
    setSkipped(true)
    putAway(userId, 'skipped')
  }
  const { primary, back } = step
  // In a replay, Next waits for the step's work; null: no lock shown.
  const locked = replaying ? !step.done : null
  const placement = rect ? place(rect, cardHeight) : null

  return (
    <>
      {rect && (
        <div
          aria-hidden
          className="ring-accent pointer-events-none fixed z-60 rounded-xl ring-2 transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.4)'
          }}
        >
          <span className="ring-accent/60 absolute inset-0 animate-ping rounded-xl ring-2 [animation-duration:1.8s]" />
        </div>
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby={titleId}
        className={cn(
          'border-border bg-surface text-foreground fixed z-61 rounded-2xl border p-4 shadow-2xl',
          !placement && 'right-4 bottom-4 left-4 sm:left-auto sm:w-80'
        )}
        style={
          placement
            ? { top: placement.top, left: placement.left, width: placement.width }
            : undefined
        }
      >
        {placement && (
          <span
            aria-hidden
            className={cn(
              'border-border bg-surface absolute h-3 w-3 rotate-45 border',
              placement.side === 'right' && '-left-1.5 border-t-0 border-r-0',
              placement.side === 'left' && '-right-1.5 border-b-0 border-l-0',
              placement.side === 'bottom' && '-top-1.5 border-r-0 border-b-0',
              placement.side === 'top' && '-bottom-1.5 border-t-0 border-l-0'
            )}
            style={
              placement.side === 'right' || placement.side === 'left'
                ? { top: placement.arrow - 6 }
                : { left: placement.arrow - 6 }
            }
          />
        )}

        <div className="flex items-start justify-between gap-3">
          <p className="text-accent text-[11px] font-semibold tracking-[0.12em] uppercase">
            Step {index + 1} of {STEPS.length}
          </p>
          <button
            type="button"
            onClick={skip}
            aria-label="Skip tour"
            className="text-muted hover:bg-surface-hover hover:text-foreground -mt-1 -mr-1 rounded-md p-1 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id={titleId} className="mt-1 text-[15px] font-semibold tracking-tight">
          {step.title}
        </h2>
        <p className="text-muted mt-1.5 text-[13px] leading-relaxed">{step.body}</p>
        {locked !== null && (
          <p
            role="status"
            className={cn(
              'mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium',
              locked ? 'text-muted' : 'text-emerald-700 dark:text-emerald-400'
            )}
          >
            {locked ? (
              'Finish this step to continue.'
            ) : (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Done
              </>
            )}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" aria-hidden>
            {STEPS.map((key, i) => (
              <span
                key={key}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  i === index ? 'bg-accent w-4' : i < index ? 'bg-accent/50 w-1.5' : 'bg-border w-1.5'
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={skip}
              className="text-muted hover:text-foreground h-8 rounded-lg px-1.5 text-[13px] font-medium whitespace-nowrap transition-colors"
            >
              Skip tour
            </button>
            {back && (
              <button
                type="button"
                onClick={back}
                className="border-border text-foreground hover:bg-surface-hover h-8 rounded-lg border px-3 text-[13px] font-medium transition-colors"
              >
                Back
              </button>
            )}
            {primary && (
              <button
                type="button"
                onClick={primary.run}
                disabled={locked === true}
                title={locked ? 'Finish this step to continue' : undefined}
                className="bg-accent text-background hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
              >
                {primary.label}
                {primary.arrow && <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
