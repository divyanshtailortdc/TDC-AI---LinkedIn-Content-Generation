'use client'

import type {
  CONFIDENCE,
  PROVENANCE,
  SetupSection
} from '@/lib/ai/skills/profile-setup/schema'
import { fieldLabel } from '@/lib/ai/skills/profile-setup/schema'
import { Sparkles, Undo2 } from 'lucide-react'
import type { SectionPrefill } from './use-section-prefill'

/** Shows whether a value came from the user's own material or is a suggestion. */
export function ProvenanceBadge({
  kind,
  source,
  confidence
}: {
  kind: (typeof PROVENANCE)[number]
  source?: string
  confidence?: (typeof CONFIDENCE)[number]
}) {
  const edited = source === 'edited'
  const label = edited
    ? 'Edited'
    : kind === 'fact'
      ? 'From your info'
      : 'AI suggestion'
  const sourceLabel =
    !source || edited
      ? null
      : source === 'description'
        ? 'your description'
        : source === 'provided'
          ? 'you provided this'
          : source

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          kind === 'fact'
            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'bg-accent/10 text-accent'
        }`}
      >
        {label}
      </span>
      {sourceLabel && (
        <span
          className="text-muted max-w-56 truncate text-[10px]"
          title={sourceLabel}
        >
          {sourceLabel}
        </span>
      )}
      {confidence && kind === 'recommendation' && !edited && (
        <span className="text-muted text-[10px]">{confidence} confidence</span>
      )}
    </span>
  )
}

/** Tells the user a form was prefilled and that nothing has been saved yet. */
export function PrefillBanner({
  section,
  prefill,
  note
}: {
  section: SetupSection
  prefill: SectionPrefill
  note?: string
}) {
  if (!prefill.active) return null
  const filled = prefill.filled.map(f => fieldLabel(section, f))
  const kept = prefill.kept.map(f => fieldLabel(section, f))

  const summary =
    filled.length > 0
      ? `AI filled ${filled.length} field${filled.length === 1 ? '' : 's'}: ${filled.join(', ')}.`
      : 'AI suggestions did not change any fields.'
  const details = [
    kept.length > 0 && prefill.mode === 'fill-empty'
      ? `Your saved ${kept.join(', ')} ${kept.length === 1 ? 'was' : 'were'} kept.`
      : '',
    note ?? 'Nothing is saved until you save.'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="border-accent/30 bg-accent/5 flex flex-col gap-2 rounded-lg border px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <Sparkles className="text-accent mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p className="min-w-0">
          <span className="text-foreground font-semibold">{summary}</span>{' '}
          <span className="text-muted">{details}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {kept.length > 0 && prefill.mode === 'fill-empty' && (
          <button
            type="button"
            onClick={prefill.replaceAll}
            className="border-border hover:bg-surface-hover text-foreground rounded-md border px-2.5 py-1 font-medium transition-colors"
          >
            Use AI values for all
          </button>
        )}
        <button
          type="button"
          onClick={prefill.undo}
          className="text-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo
        </button>
      </div>
    </div>
  )
}
