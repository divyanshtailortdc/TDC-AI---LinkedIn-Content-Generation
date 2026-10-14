'use client'

import { Sparkles, Undo2 } from 'lucide-react'
import type {
  CONFIDENCE,
  PROVENANCE,
  SetupSection
} from '@/lib/ai/skills/profile-setup/schema'
import { fieldLabel } from '@/lib/ai/skills/profile-setup/schema'
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
  const label = edited ? 'Edited' : kind === 'fact' ? 'From your info' : 'AI suggestion'
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
        <span className="text-muted max-w-56 truncate text-[10px]" title={sourceLabel}>
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

  return (
    <div className="border-accent/30 bg-accent/5 flex flex-col gap-3 rounded-xl border p-4 text-xs sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <Sparkles className="text-accent mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="text-foreground font-semibold">
            {filled.length > 0
              ? `AI suggestions filled ${filled.length} field${filled.length === 1 ? '' : 's'}: ${filled.join(', ')}.`
              : 'AI suggestions did not change any fields.'}
          </p>
          {kept.length > 0 && prefill.mode === 'fill-empty' && (
            <p className="text-muted">
              Your saved {kept.join(', ')} {kept.length === 1 ? 'was' : 'were'} kept.
            </p>
          )}
          {note && <p className="text-muted">{note}</p>}
          <p className="text-muted">
            Review and edit below. Nothing is saved until you click Save.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {kept.length > 0 && prefill.mode === 'fill-empty' && (
          <button
            type="button"
            onClick={prefill.replaceAll}
            className="border-border hover:bg-surface-hover text-foreground rounded-lg border px-3 py-1.5 font-medium transition-colors"
          >
            Use AI values for all
          </button>
        )}
        <button
          type="button"
          onClick={prefill.undo}
          className="text-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo
        </button>
      </div>
    </div>
  )
}
