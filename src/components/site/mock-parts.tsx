import { PlatformMark } from '@/components/platform-mark'
import type { PlatformId } from '@/lib/platforms'
import type { ReactNode } from 'react'

/*
 * Small pictures of the app for the website. The person, company and post
 * are made up; they show the kind of work the engine does, not a customer.
 */

export const SAMPLE_AUTHOR = {
  initials: 'AM',
  name: 'Alex Morgan',
  role: 'Founder, Northwind Studio'
}

export const SAMPLE_IDEA = {
  title: 'Why our onboarding emails started getting replies',
  goal: 'Build authority with SaaS founders'
}

export const SAMPLE_POST = `We rewrote our onboarding emails last quarter. Open rates barely moved. Replies tripled.

The change wasn't the subject line. It was asking one real question in the first email, instead of listing five features.

What we changed:
→ One ask per email
→ Written and signed by a person
→ Sent when people log in, not when they sign up

What's the best onboarding email you've ever received?`

export const SAMPLE_SCORES: { label: string; value: number }[] = [
  { label: 'Goal fit', value: 92 },
  { label: 'Engagement potential', value: 84 },
  { label: 'Originality', value: 88 },
  { label: 'Trend relevance', value: 71 },
  { label: 'Brand fit', value: 90 },
  { label: 'Source quality', value: 86 }
]

/** A framed panel, like a window of the app. */
export function MockWindow({
  title,
  aside,
  children,
  className = ''
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`border-border bg-surface overflow-hidden rounded-2xl border shadow-[0_24px_60px_-28px_rgb(8_60_75/0.35)] ${className}`}
    >
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className="flex gap-1.5">
            <span className="bg-border h-2.5 w-2.5 rounded-full" />
            <span className="bg-border h-2.5 w-2.5 rounded-full" />
            <span className="bg-border h-2.5 w-2.5 rounded-full" />
          </span>
          <span className="text-foreground truncate text-sm font-medium">
            {title}
          </span>
        </div>
        {aside}
      </div>
      {children}
    </div>
  )
}

export function MockAuthor({ platform = 'linkedin' }: { platform?: PlatformId }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="bg-brand/15 text-brand-strong flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
          {SAMPLE_AUTHOR.initials}
        </span>
        <div className="min-w-0">
          <p className="text-foreground truncate text-sm font-semibold">
            {SAMPLE_AUTHOR.name}
          </p>
          <p className="text-muted truncate text-xs">{SAMPLE_AUTHOR.role}</p>
        </div>
      </div>
      <PlatformMark platform={platform} className="h-5 w-5 shrink-0" />
    </div>
  )
}

/** One line of an idea's scorecard: the score out of 100, as a bar. */
export function ScoreBar({
  label,
  value,
  shown = true
}: {
  label: string
  value: number
  shown?: boolean
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
      <span className="text-muted truncate text-xs">{label}</span>
      <span className="text-foreground text-xs font-semibold tabular-nums">
        {value}
      </span>
      <span className="bg-surface-hover col-span-2 h-1.5 overflow-hidden rounded-full">
        <span
          className="bg-brand block h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: shown ? `${value}%` : '0%' }}
        />
      </span>
    </div>
  )
}

/** A small rounded label. */
export function Chip({
  children,
  tone = 'plain'
}: {
  children: ReactNode
  tone?: 'plain' | 'brand' | 'amber' | 'green'
}) {
  const tones = {
    plain: 'border-border text-muted',
    brand: 'border-brand/30 bg-brand/10 text-brand-strong',
    amber:
      'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    green:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/** YouTube's play button, which the app's platform marks don't draw yet. */
export function YouTubeMark({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className}>
      <rect x="0.5" y="4" width="23" height="16" rx="4.5" fill="#FF0000" />
      <path d="M9.75 8.5v7l6-3.5z" fill="#fff" />
    </svg>
  )
}
