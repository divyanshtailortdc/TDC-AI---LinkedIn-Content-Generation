'use client'

import { buttonClassName } from '@/components/button'
import { ProgressBar } from '@/components/ui/meter'
import { cn } from '@/lib/cn'
import { ONBOARDING_PHASES, STEP_CONTENT } from '@/lib/onboarding/content'
import type {
  OnboardingStepKey,
  OnboardingStepState,
  OnboardingStepStatus
} from '@/lib/onboarding/progress'
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  Lightbulb,
  Loader2,
  Lock,
  Minus,
  Newspaper,
  PartyPopper,
  SkipForward
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useOnboarding } from './onboarding-provider'
import { StepDetails, useBufferOutcome } from './step-details'

const STATUS_LABEL: Record<OnboardingStepStatus, string> = {
  done: 'Done',
  skipped: 'Skipped',
  todo: '',
  working: 'In progress',
  attention: 'Needs attention',
  blocked: '',
  unavailable: 'Not available'
}

function StatusIcon({
  status,
  number,
  current
}: {
  status: OnboardingStepStatus
  number: number
  current: boolean
}) {
  const base =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums'
  switch (status) {
    case 'done':
      return (
        <span
          className={cn(
            base,
            'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      )
    case 'skipped':
      return (
        <span
          className={cn(base, 'border-border text-muted border border-dashed')}
        >
          <SkipForward className="h-3 w-3" />
        </span>
      )
    case 'working':
      return (
        <span className={cn(base, 'bg-brand/15 text-brand-strong')}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      )
    case 'attention':
      return (
        <span
          className={cn(
            base,
            'bg-rose-500/15 text-rose-700 dark:text-rose-400'
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
      )
    case 'blocked':
      return (
        <span className={cn(base, 'border-border text-muted border')}>
          <Lock className="h-3 w-3" />
        </span>
      )
    case 'unavailable':
      return (
        <span className={cn(base, 'text-muted bg-surface-hover')}>
          <Minus className="h-3 w-3" />
        </span>
      )
    default:
      return (
        <span
          className={cn(
            base,
            current
              ? 'bg-accent text-background'
              : 'border-border text-muted border'
          )}
        >
          {number}
        </span>
      )
  }
}

/**
 * The dashboard's getting-started checklist: every step from the identity to
 * the first published post, grouped in three parts, with the next step
 * spelled out. Each step is ticked from saved data, so it is right however
 * the work was done, and picks up where the user left off on any device.
 * Any step can be opened to read what it involves.
 */
export function OnboardingChecklist() {
  const ctx = useOnboarding()
  const outcome = useBufferOutcome()
  const [selected, setSelected] = useState<OnboardingStepKey | null>(null)
  if (!ctx) return null
  const { view, change } = ctx
  const { progress } = view

  if (progress.complete) {
    return view.hidden ? null : (
      <CompleteCard onHide={() => change({ hidden: true })} />
    )
  }

  const shownKey = selected ?? progress.current
  const shown =
    progress.steps.find(s => s.key === shownKey) ?? progress.steps[0]!
  const numbered = progress.steps.filter(s => s.status !== 'unavailable')
  const numberOf = (key: OnboardingStepKey) =>
    numbered.findIndex(s => s.key === key) + 1
  const isCurrent = shown.key === progress.current

  return (
    <section
      aria-labelledby="onboarding-title"
      className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs"
    >
      <header className="border-border flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-brand-strong text-[11px] font-semibold tracking-[0.14em] uppercase">
            Getting started
          </p>
          <h2
            id="onboarding-title"
            className="text-foreground mt-1 text-lg font-semibold tracking-tight"
          >
            Get to your first published post
          </h2>
          <p className="text-muted mt-1 max-w-xl text-sm leading-relaxed">
            Short steps, from your brand to a live post. Everything you save
            counts straight away, so you can stop at any point and pick up here
            where you left off.
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-52">
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="text-foreground font-semibold">
              {progress.completed} of {progress.total} done
            </span>
            <span className="text-muted tabular-nums">
              {Math.round(
                (progress.completed / Math.max(progress.total, 1)) * 100
              )}
              %
            </span>
          </div>
          <ProgressBar
            value={progress.completed}
            max={progress.total}
            size="sm"
            label="Getting started progress"
          />
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* The step to work on (or the one opened from the list). */}
        <div className="border-border p-5 sm:p-6 lg:border-r">
          {outcome && (
            <p
              role="status"
              className={cn(
                'mb-4 rounded-lg border px-3 py-2.5 text-[13px]',
                outcome.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300'
              )}
            >
              {outcome.message}
            </p>
          )}
          <p className="text-muted text-[11px] font-semibold tracking-wider uppercase">
            {isCurrent ? 'Up next' : STATUS_LABEL[shown.status] || 'Step'}
            {shown.status !== 'unavailable' &&
              ` · Step ${numberOf(shown.key)} of ${progress.total}`}
          </p>
          <h3 className="text-foreground mt-1.5 text-base font-semibold tracking-tight">
            {STEP_CONTENT[shown.key].title}
          </h3>
          <p className="text-muted mt-1 mb-4 text-sm leading-relaxed">
            {STEP_CONTENT[shown.key].summary}
          </p>
          <StepDetails key={shown.key} step={shown} />
          {!isCurrent && progress.current && (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-brand-strong mt-4 inline-flex items-center gap-1 text-[13px] font-medium hover:underline"
            >
              Back to the next step: {STEP_CONTENT[progress.current].title}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Every step, by part of the journey. */}
        <div className="bg-surface-hover/30 space-y-5 p-5 sm:p-6">
          {ONBOARDING_PHASES.map(phase => {
            const steps = phase.steps
              .map(key => progress.steps.find(s => s.key === key)!)
              .filter(s => s.status !== 'unavailable' || s.key === 'buffer')
            const applies = steps.filter(s => s.status !== 'unavailable')
            const finished = applies.filter(
              s => s.status === 'done' || s.status === 'skipped'
            ).length
            return (
              <div key={phase.title}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h4 className="text-foreground text-xs font-semibold">
                    {phase.title}
                  </h4>
                  <span className="text-muted text-[11px] tabular-nums">
                    {finished}/{applies.length}
                  </span>
                </div>
                <ol className="space-y-1">
                  {steps.map(step => (
                    <StepRow
                      key={step.key}
                      step={step}
                      number={numberOf(step.key)}
                      current={step.key === progress.current}
                      selected={step.key === shown.key}
                      onSelect={() =>
                        setSelected(
                          step.key === progress.current ? null : step.key
                        )
                      }
                    />
                  ))}
                </ol>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function StepRow({
  step,
  number,
  current,
  selected,
  onSelect
}: {
  step: OnboardingStepState
  number: number
  current: boolean
  selected: boolean
  onSelect: () => void
}) {
  const label = STATUS_LABEL[step.status]
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={current ? 'step' : undefined}
        aria-pressed={selected}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
          selected
            ? 'bg-surface ring-border shadow-xs ring-1'
            : 'hover:bg-surface/70'
        )}
      >
        <StatusIcon status={step.status} number={number} current={current} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[13px]',
            step.status === 'done' || step.status === 'skipped'
              ? 'text-muted'
              : current
                ? 'text-foreground font-semibold'
                : step.status === 'blocked' || step.status === 'unavailable'
                  ? 'text-muted'
                  : 'text-foreground font-medium'
          )}
        >
          {STEP_CONTENT[step.key].title}
        </span>
        {label && (
          <span
            className={cn(
              'shrink-0 text-[11px] font-medium',
              step.status === 'done' &&
                'text-emerald-700 dark:text-emerald-400',
              step.status === 'attention' && 'text-rose-700 dark:text-rose-400',
              step.status === 'working' && 'text-brand-strong',
              (step.status === 'skipped' || step.status === 'unavailable') &&
                'text-muted'
            )}
          >
            {label}
          </span>
        )}
        <ChevronRight className="text-muted h-3.5 w-3.5 shrink-0" />
      </button>
    </li>
  )
}

function CompleteCard({ onHide }: { onHide: () => Promise<string | null> }) {
  const [hiding, setHiding] = useState(false)
  const next = [
    {
      href: '/goals',
      icon: Lightbulb,
      title: 'Generate more ideas',
      text: 'Start a run whenever you want new posts.'
    },
    {
      href: '/schedule',
      icon: CalendarDays,
      title: 'Plan your schedule',
      text: 'Pick the days posts go out.'
    },
    {
      href: '/newsletters',
      icon: Newspaper,
      title: 'Feed it newsletters',
      text: 'Fresh stories for every run.'
    }
  ]
  return (
    <section className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
          <PartyPopper className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground text-lg font-semibold tracking-tight">
            Your first post is out. You&apos;re all set.
          </h2>
          <p className="text-muted mt-1 text-sm">
            Everything is in place: your brand, publishing and the way from idea
            to post.
          </p>
        </div>
        <button
          type="button"
          disabled={hiding}
          onClick={async () => {
            setHiding(true)
            await onHide()
            setHiding(false)
          }}
          className={buttonClassName({
            size: 'sm',
            variant: 'secondary',
            className: 'shrink-0'
          })}
        >
          {hiding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Hide this
        </button>
      </div>
      <ul className="border-border divide-border grid divide-y border-t sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {next.map(item => (
          <li key={item.href} className="bg-surface">
            <Link
              href={item.href}
              className="hover:bg-surface-hover flex items-start gap-3 p-4 transition-colors"
            >
              <item.icon className="text-brand-strong mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="text-foreground block text-[13px] font-semibold">
                  {item.title}
                </span>
                <span className="text-muted block text-xs">{item.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
