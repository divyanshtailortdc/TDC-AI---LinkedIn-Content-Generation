'use client'

import type { CaptionMeter, PublishCheck } from '@/lib/formats'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'

/**
 * Whether a post is ready for its platform: its caption's length against the
 * platform's limit (and where the feed folds it), then every check
 * (src/lib/formats/validate.ts), problems first.
 */

const ICONS = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  ok: CheckCircle2
} as const

const TONES = {
  error: 'text-rose-600 dark:text-rose-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-sky-600 dark:text-sky-400',
  ok: 'text-emerald-600 dark:text-emerald-400'
} as const

const ORDER = { error: 0, warning: 1, info: 2, ok: 3 } as const

export function PublishChecks({
  platformName,
  meter,
  checks
}: {
  platformName: string
  meter: CaptionMeter
  checks: PublishCheck[]
}) {
  const errors = checks.filter(c => c.level === 'error').length
  const warnings = checks.filter(c => c.level === 'warning').length
  const sorted = [...checks].sort((a, b) => ORDER[a.level] - ORDER[b.level])
  const share = Math.min(1, meter.count / Math.max(1, meter.max))
  const over = meter.count > meter.max
  const target = meter.target < meter.max ? meter.target / meter.max : null

  return (
    <section
      aria-label={`Ready for ${platformName}`}
      className="border-border bg-surface rounded-2xl border p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-foreground text-sm font-semibold">
          Ready for {platformName}?
        </h2>
        <span
          className={`text-xs font-medium ${errors ? TONES.error : warnings ? TONES.warning : TONES.ok}`}
        >
          {errors
            ? `${errors} to fix before publishing`
            : warnings
              ? `${warnings} to look at`
              : 'Ready to publish'}
        </span>
      </div>

      {/* The caption against the platform's limit, with its fold and target. */}
      <div className="mt-3">
        <div className="text-muted flex items-baseline justify-between text-[11px]">
          <span>{meter.label}</span>
          <span className={`tabular-nums ${over ? TONES.error : ''}`}>
            {meter.count.toLocaleString('en-US')} /{' '}
            {meter.max.toLocaleString('en-US')}
          </span>
        </div>
        <div
          className="bg-surface-hover relative mt-1 h-1.5 w-full overflow-hidden rounded-full"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={meter.max}
          aria-valuenow={meter.count}
          aria-label={`${meter.label} length`}
        >
          <div
            className={`h-full rounded-full ${over ? 'bg-rose-500' : meter.count > meter.target ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${share * 100}%` }}
          />
          {target !== null && (
            <span
              className="bg-foreground/30 absolute top-0 h-full w-px"
              style={{ left: `${target * 100}%` }}
            />
          )}
        </div>
        <p className="text-muted mt-1 text-[11px]">
          Aim for about {meter.target.toLocaleString('en-US')}
          {meter.fold
            ? ` · the first ${meter.fold.toLocaleString('en-US')} show before "more"`
            : ''}
          {meter.parts ? ` · ${meter.parts.length} posts` : ''}
        </p>
      </div>

      <ul className="mt-3 space-y-1.5">
        {sorted.map(check => {
          const Icon = ICONS[check.level]
          return (
            <li key={check.id} className="flex gap-2 text-xs leading-snug">
              <Icon
                className={`mt-px h-3.5 w-3.5 shrink-0 ${TONES[check.level]}`}
              />
              <span className="text-foreground/90">
                <span className="font-semibold">{check.label}: </span>
                {check.message}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
