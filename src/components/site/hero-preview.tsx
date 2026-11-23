'use client'

import { PlatformMark } from '@/components/platform-mark'
import {
  BookOpen,
  CalendarClock,
  Check,
  Globe,
  LoaderCircle,
  Newspaper,
  UserRound
} from 'lucide-react'
import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType
} from 'react'
import {
  Chip,
  MockAuthor,
  MockWindow,
  SAMPLE_IDEA,
  SAMPLE_POST,
  SAMPLE_SCORES,
  ScoreBar
} from './mock-parts'

/** The four moments the preview plays through, and how long each lasts. */
const STAGES = [
  { label: 'Research', ms: 3800 },
  { label: 'Idea', ms: 4200 },
  { label: 'Draft', ms: 6200 },
  { label: 'Schedule', ms: 3600 }
] as const

const TICK_MS = 50
const DRAFT_STAGE = 2

const stageMs = (index: number) => STAGES[index]?.ms ?? 0

const SOURCES: {
  icon: ComponentType<{ className?: string }>
  kind: string
  title: string
}[] = [
  { icon: UserRound, kind: 'Your profile', title: 'Voice, goals and audience' },
  {
    icon: Newspaper,
    kind: 'Newsletter story',
    title: 'Onboarding emails people actually answer'
  },
  {
    icon: Globe,
    kind: 'Web article',
    title: 'What changed in SaaS activation this year'
  },
  {
    icon: BookOpen,
    kind: 'Your knowledge',
    title: 'Case study: our Q3 onboarding rewrite'
  }
]

type PlayState = { stage: number; elapsed: number; chosen: number | null }
type PlayAction = { type: 'tick' } | { type: 'choose'; stage: number }

function play(state: PlayState, action: PlayAction): PlayState {
  if (action.type === 'choose') {
    return { stage: action.stage, elapsed: 0, chosen: action.stage }
  }
  const elapsed = state.elapsed + TICK_MS
  // On to the next moment once this one has played.
  return elapsed >= stageMs(state.stage)
    ? { ...state, stage: (state.stage + 1) % STAGES.length, elapsed: 0 }
    : { ...state, elapsed }
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * The hero's moving picture: a run researching, an idea with its scorecard,
 * the post being drafted, then scheduled. It pauses off screen, and anyone
 * who prefers reduced motion gets each moment whole and still, starting
 * with the finished draft.
 */
export function HeroPreview() {
  const [state, dispatch] = useReducer(play, {
    stage: 0,
    elapsed: 0,
    chosen: null
  })
  const still = useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false
  )
  const [onScreen, setOnScreen] = useState(true)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    const node = root.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) =>
      setOnScreen(entry?.isIntersecting ?? true)
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (still || !onScreen) return
    const timer = setInterval(() => dispatch({ type: 'tick' }), TICK_MS)
    return () => clearInterval(timer)
  }, [still, onScreen])

  const stage = still ? (state.chosen ?? DRAFT_STAGE) : state.stage
  const elapsed = still ? stageMs(stage) : state.elapsed
  const choose = (index: number) => dispatch({ type: 'choose', stage: index })

  return (
    <div ref={root}>
      <MockWindow
        title={
          <span className="flex items-center gap-2">
            <span className="bg-brand h-2 w-2 rounded-full" />
            Content Engine
          </span>
        }
        aside={<Chip>Northwind Studio</Chip>}
      >
        <div
          role="tablist"
          aria-label="What the engine does"
          className="border-border grid grid-cols-4 border-b"
        >
          {STAGES.map((item, index) => {
            const active = index === stage
            return (
              <button
                key={item.label}
                type="button"
                role="tab"
                id={`${id}-tab-${index}`}
                aria-selected={active}
                aria-controls={`${id}-panel`}
                onClick={() => choose(index)}
                className={`relative px-2 py-2.5 text-xs font-medium transition-colors sm:text-[13px] ${
                  active ? 'text-foreground' : 'text-muted hover:text-foreground'
                }`}
              >
                {item.label}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 bottom-0 h-0.5 rounded-full ${
                    active ? 'bg-brand' : 'bg-transparent'
                  }`}
                />
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${stage}`}
          className="h-120 overflow-hidden p-4 sm:h-112 sm:p-5"
        >
          <div key={stage} className="site-fade-up h-full">
            {stage === 0 && <ResearchStage elapsed={elapsed} />}
            {stage === 1 && <IdeaStage elapsed={elapsed} />}
            {stage === 2 && <DraftStage elapsed={elapsed} />}
            {stage === 3 && <ScheduleStage />}
          </div>
        </div>
      </MockWindow>
    </div>
  )
}

function ResearchStage({ elapsed }: { elapsed: number }) {
  const step = 750
  const progress = Math.min(1, elapsed / stageMs(0))
  return (
    <div className="flex h-full flex-col">
      <p className="text-muted text-xs font-medium tracking-wide uppercase">
        Run · Researching your field
      </p>
      <ul className="mt-4 space-y-2.5">
        {SOURCES.map((source, index) => {
          const shown = elapsed >= index * step
          const done = elapsed >= (index + 1) * step
          const Icon = source.icon
          return (
            <li
              key={source.title}
              className={`border-border flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all duration-500 ${
                shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
            >
              <span className="bg-brand/10 text-brand-strong flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-muted block text-[11px]">
                  {source.kind}
                </span>
                <span className="text-foreground block truncate text-sm">
                  {source.title}
                </span>
              </span>
              {done ? (
                <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <LoaderCircle className="text-muted h-4 w-4 shrink-0 animate-spin" />
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-auto">
        <div className="text-muted flex justify-between text-xs">
          <span>Writing ideas for your goal</span>
          <span className="tabular-nums">{Math.round(progress * 100)}%</span>
        </div>
        <div className="bg-surface-hover mt-2 h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-brand h-full rounded-full"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function IdeaStage({ elapsed }: { elapsed: number }) {
  const scores = SAMPLE_SCORES.filter(score =>
    ['Goal fit', 'Engagement potential', 'Originality', 'Source quality'].includes(
      score.label
    )
  )
  const approved = elapsed > 3000
  return (
    <div className="flex h-full flex-col">
      <Chip tone="brand">Goal · {SAMPLE_IDEA.goal}</Chip>
      <h3 className="text-foreground mt-3 text-lg leading-snug font-semibold">
        {SAMPLE_IDEA.title}
      </h3>
      <p className="text-muted mt-1.5 text-sm">
        A story post: one change, the result, and a question for founders.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3.5">
        {scores.map(score => (
          <ScoreBar key={score.label} {...score} shown={elapsed > 150} />
        ))}
      </div>
      <p className="border-border text-muted mt-5 rounded-lg border border-dashed px-3 py-2 text-xs leading-relaxed">
        <span className="text-foreground font-medium">Originality 88:</span> no
        earlier idea of yours is about replies rather than opens.
      </p>
      <div className="mt-auto flex justify-end gap-2 pt-4">
        <span className="border-border text-muted rounded-lg border px-3.5 py-1.5 text-sm">
          Reject
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-300 ${
            approved
              ? 'bg-emerald-600 text-white'
              : elapsed > 2200
                ? 'bg-cta text-cta-text ring-brand/30 ring-4'
                : 'bg-cta text-cta-text'
          }`}
        >
          {approved && <Check className="h-4 w-4" />}
          {approved ? 'Approved' : 'Approve'}
        </span>
      </div>
    </div>
  )
}

function DraftStage({ elapsed }: { elapsed: number }) {
  const typingMs = 4200
  const shown = Math.min(
    SAMPLE_POST.length,
    Math.floor((elapsed / typingMs) * SAMPLE_POST.length)
  )
  const typed = shown >= SAMPLE_POST.length
  return (
    <div className="flex h-full flex-col">
      <MockAuthor />
      <p className="text-foreground/90 mt-4 text-[13px] leading-relaxed whitespace-pre-line">
        {SAMPLE_POST.slice(0, shown)}
        {!typed && (
          <span
            aria-hidden
            className="bg-brand ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse"
          />
        )}
      </p>
      <div className="border-border mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="brand">Written in your voice</Chip>
          <Chip tone="amber">Awaiting review</Chip>
        </div>
        <span
          className={`bg-cta text-cta-text rounded-lg px-3.5 py-1.5 text-sm font-medium transition-opacity duration-300 ${
            typed ? 'opacity-100' : 'opacity-40'
          }`}
        >
          Approve
        </span>
      </div>
    </div>
  )
}

function ScheduleStage() {
  const lines = SAMPLE_POST.split('\n').filter(Boolean)
  return (
    <div className="flex h-full flex-col">
      <div className="border-border rounded-xl border p-4">
        <MockAuthor />
        <p className="text-foreground/90 mt-3 line-clamp-2 text-[13px] leading-relaxed">
          {lines[0]} {lines[1]}
        </p>
        <div className="mt-3">
          <Chip tone="green">
            <Check className="h-3 w-3" /> Approved
          </Chip>
        </div>
      </div>

      <div className="border-brand/30 bg-brand/5 mt-4 flex items-center gap-3 rounded-xl border p-4">
        <span className="bg-brand/15 text-brand-strong flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          <CalendarClock className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-semibold">
            Scheduled for Tuesday, 9:00 AM
          </p>
          <p className="text-muted text-xs">
            Goes out through your connected account
          </p>
        </div>
        <PlatformMark platform="linkedin" className="h-5 w-5 shrink-0" />
      </div>

      <p className="text-muted mt-5 text-xs font-medium tracking-wide uppercase">
        Also drafted from this idea
      </p>
      <ul className="mt-2.5 space-y-2">
        {(
          [
            ['x', 'X thread · 5 posts'],
            ['threads', 'Threads post']
          ] as const
        ).map(([platform, label]) => (
          <li
            key={platform}
            className="border-border flex items-center gap-3 rounded-lg border px-3 py-2.5"
          >
            <PlatformMark platform={platform} className="h-4 w-4 shrink-0" />
            <span className="text-foreground flex-1 text-sm">{label}</span>
            <Chip tone="amber">Awaiting review</Chip>
          </li>
        ))}
      </ul>
    </div>
  )
}
