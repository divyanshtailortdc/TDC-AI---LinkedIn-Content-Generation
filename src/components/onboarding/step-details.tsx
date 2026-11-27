'use client'

import { ideationStageOf } from '@/app/(app)/runs/run-display'
import { buttonClassName } from '@/components/button'
import { PlatformMark } from '@/components/platform-mark'
import { cn } from '@/lib/cn'
import { formatAbsoluteDateTime } from '@/lib/format-date'
import { STEP_CONTENT } from '@/lib/onboarding/content'
import {
  CONFIRMABLE_STEPS,
  ONBOARDING_STEP_KEYS,
  SKIPPABLE_STEPS,
  type OnboardingStepKey,
  type OnboardingStepState
} from '@/lib/onboarding/progress'
import type { OnboardingView } from '@/lib/onboarding/view'
import { getPlatform } from '@/lib/platforms'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Lock,
  Undo2
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useOnboarding } from './onboarding-provider'

/** The route that starts connecting Buffer; a full navigation to Buffer. */
const BUFFER_CONNECT_URL = '/api/integrations/buffer/connect'

/** Connect Buffer, coming back to the page the user is on now. */
export function bufferConnectHref(returnTo: string) {
  return `${BUFFER_CONNECT_URL}?next=${encodeURIComponent(returnTo)}`
}

/** How connecting Buffer ended, on the page it came back to (else null). */
export function useBufferOutcome() {
  return useOnboarding()?.bufferOutcome ?? null
}

const titleOf = (key: OnboardingStepKey) => STEP_CONTENT[key].title

/** The step before `key` that is not finished, for a blocked step. */
function waitingOn(view: OnboardingView, key: OnboardingStepKey) {
  const index = ONBOARDING_STEP_KEYS.indexOf(key)
  return view.progress.steps
    .slice(0, index)
    .reverse()
    .find(s => !['done', 'skipped', 'unavailable'].includes(s.status))
}

/** Where a step stands, in a sentence, with what to do about it. */
function StepStatusNote({
  step,
  view
}: {
  step: OnboardingStepState
  view: OnboardingView
}) {
  const { facts } = view
  if (step.status === 'blocked') {
    const before = waitingOn(view, step.key)
    return (
      <Note tone="muted" icon={<Lock className="h-4 w-4" />}>
        {before
          ? `Finish “${titleOf(before.key)}” first.`
          : 'An earlier step needs finishing first.'}
      </Note>
    )
  }
  if (step.status === 'working') {
    if (step.key === 'ideas') {
      const stage = facts.latestRun
        ? ideationStageOf(facts.latestRun.status)
        : null
      return (
        <Note tone="brand" icon={<Loader2 className="h-4 w-4 animate-spin" />}>
          <span className="font-semibold">
            {stage?.label ?? 'Generating ideas'}…
          </span>{' '}
          This usually takes a few minutes. You can leave this page or close the
          tab: the run carries on, and this guide shows when your ideas are
          ready.
        </Note>
      )
    }
    if (step.key === 'post') {
      return (
        <Note tone="brand" icon={<Loader2 className="h-4 w-4 animate-spin" />}>
          <span className="font-semibold">Writing your post…</span> It takes
          about a minute, and appears on Posts when it is ready.
        </Note>
      )
    }
    if (step.key === 'publish') {
      const publication = facts.publication
      return publication?.status === 'scheduled' ? (
        <Note tone="brand" icon={<Clock className="h-4 w-4" />}>
          <span className="font-semibold">
            Scheduled for{' '}
            {publication.scheduledFor
              ? formatAbsoluteDateTime(publication.scheduledFor)
              : 'later'}
            .
          </span>{' '}
          Nothing more to do: it goes out then, and this step ticks itself off.
        </Note>
      ) : (
        <Note tone="brand" icon={<Loader2 className="h-4 w-4 animate-spin" />}>
          <span className="font-semibold">Publishing…</span> Buffer is sending
          your post out.
        </Note>
      )
    }
  }
  if (step.status === 'attention') {
    const text =
      step.key === 'ideas'
        ? `The last run stopped: ${step.note ?? 'it failed'}. Start another one.`
        : step.key === 'publish'
          ? `Publishing failed: ${step.note ?? 'unknown error'}. Open the post to see why and try again.`
          : step.key === 'buffer'
            ? 'Buffer no longer accepts the connection (it expired or access was removed). Connect it again.'
            : (step.note ?? 'Something went wrong.')
    return (
      <Note tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
        {text}
      </Note>
    )
  }
  if (
    step.key === 'publish' &&
    step.status === 'todo' &&
    !facts.publishingAvailable
  ) {
    return (
      <Note tone="muted" icon={<Lock className="h-4 w-4" />}>
        Publishing through Buffer is not set up on this server. Click Copy post
        on the approved post, publish it on the platform yourself, then open it
        on the Schedule calendar and click Mark as posted.
      </Note>
    )
  }
  if (step.status === 'unavailable' && step.key !== 'channels') {
    return (
      <Note tone="muted" icon={<Lock className="h-4 w-4" />}>
        Publishing through Buffer is not set up on this server. You can still
        copy a post and publish it yourself.
      </Note>
    )
  }
  return null
}

function Note({
  tone,
  icon,
  children
}: {
  tone: 'muted' | 'brand' | 'danger' | 'success'
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed',
        tone === 'muted' && 'border-border bg-surface-hover/60 text-muted',
        tone === 'brand' && 'border-brand/30 bg-brand/10 text-foreground',
        tone === 'danger' &&
          'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300',
        tone === 'success' &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="min-w-0">{children}</p>
    </div>
  )
}

/** Each platform the identity publishes through Buffer, and where it goes. */
function ChannelList({ view }: { view: OnboardingView }) {
  const { channels } = view.facts
  return (
    <ul className="divide-border border-border divide-y rounded-lg border">
      {channels.map(channel => {
        const platform = getPlatform(channel.platform)
        return (
          <li
            key={channel.platform}
            className="flex items-center gap-3 px-3 py-2.5 text-[13px]"
          >
            <PlatformMark
              platform={channel.platform}
              className="h-4 w-4 shrink-0"
            />
            <span className="text-foreground w-20 shrink-0 font-medium">
              {platform.name}
            </span>
            {channel.canPublish ? (
              <span className="text-foreground flex min-w-0 items-center gap-1.5">
                <ArrowRight className="text-muted h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Publishes as {channel.name ?? 'your account'}
                </span>
              </span>
            ) : (
              <span className="text-muted min-w-0">
                {channel.status === 'expired'
                  ? 'Its account needs reconnecting in Buffer.'
                  : 'No account picked yet. Add one in Buffer, then click Sync now.'}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Everything about one step: where it stands, why it matters, what to
 * click, and its buttons (go there, connect Buffer, skip, confirm).
 */
export function StepDetails({
  step,
  showHow = true
}: {
  step: OnboardingStepState
  /** The numbered instructions; left out where space is short. */
  showHow?: boolean
}) {
  const ctx = useOnboarding()
  const pathname = usePathname()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!ctx) return null
  const { view, change } = ctx
  const content = STEP_CONTENT[step.key]
  const finished = step.status === 'done' || step.status === 'skipped'
  const actionable = !['blocked', 'unavailable'].includes(step.status)

  const run = async (label: string, next: Parameters<typeof change>[0]) => {
    setPending(label)
    setError(null)
    const failed = await change(next)
    setPending(null)
    if (failed) setError(failed)
  }

  const canSkip = SKIPPABLE_STEPS.has(step.key) && !finished && actionable
  const canConfirm =
    CONFIRMABLE_STEPS.has(step.key) &&
    step.status === 'todo' &&
    (step.key !== 'channels' || view.facts.channels.some(c => c.canPublish))
  const connectBuffer =
    step.key === 'buffer' &&
    (step.status === 'todo' || step.status === 'attention')

  return (
    <div className="space-y-3.5">
      <StepStatusNote step={step} view={view} />

      {step.key === 'channels' &&
        step.status !== 'blocked' &&
        step.status !== 'unavailable' && <ChannelList view={view} />}

      {/* Not while the app does the work: there is nothing to click. */}
      {showHow &&
        !finished &&
        step.status !== 'unavailable' &&
        step.status !== 'working' && (
          <div className="space-y-2.5">
            <p className="text-muted text-[13px] leading-relaxed">
              <span className="text-foreground font-medium">Why: </span>
              {content.why}
            </p>
            <ol className="text-foreground marker:text-muted list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed">
              {content.how.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <p className="text-muted flex items-center gap-1.5 text-xs">
              <Clock className="h-3.5 w-3.5" />
              {content.time}
            </p>
          </div>
        )}

      {error && (
        <Note tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
          {error}
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {connectBuffer ? (
          // A full navigation: the route redirects to Buffer.
          <a
            href={bufferConnectHref(pathname)}
            className={buttonClassName({
              size: 'sm',
              className: 'font-semibold'
            })}
          >
            {step.status === 'attention' ? 'Reconnect Buffer' : content.cta}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          actionable &&
          !finished && (
            <Link
              href={step.href}
              className={buttonClassName({
                size: 'sm',
                className: 'font-semibold'
              })}
            >
              {step.status === 'working' && step.key === 'ideas'
                ? 'Follow the run'
                : content.cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )
        )}
        {canConfirm && content.confirmLabel && (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void run('confirm', { confirm: step.key })}
            className={buttonClassName({
              size: 'sm',
              variant: 'secondary',
              className: 'font-semibold'
            })}
          >
            {pending === 'confirm' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {content.confirmLabel}
          </button>
        )}
        {canSkip && content.skipLabel && (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void run('skip', { skip: step.key })}
            className={buttonClassName({ size: 'sm', variant: 'secondary' })}
          >
            {pending === 'skip' && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            {content.skipLabel}
          </button>
        )}
        {step.status === 'skipped' && (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void run('unskip', { unskip: step.key })}
            className="text-muted hover:text-foreground inline-flex h-8 items-center gap-1.5 px-1 text-[13px] font-medium"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Do it now instead
          </button>
        )}
      </div>
    </div>
  )
}
