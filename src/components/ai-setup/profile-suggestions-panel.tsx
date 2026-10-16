'use client'

import {
  fieldLabel,
  getSectionStatus,
  SECTION_LABELS,
  SETUP_SECTIONS
} from '@/lib/ai/skills/profile-setup/schema'
import { Check, CheckCircle2, Loader2, Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type {
  PendingSuggestion,
  PrefillChange,
  SectionPrefill
} from './use-section-prefill'

const primaryButton =
  'bg-accent hover:bg-accent-hover text-background flex h-8 w-full items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60'
const outlineButton =
  'border-border bg-surface text-foreground hover:bg-surface-hover flex h-8 w-full items-center justify-center rounded-lg border px-3.5 text-[13px] font-medium transition-colors'

const CHANGE_TAGS: Record<
  PrefillChange,
  { label: string; title: string; className: string }
> = {
  new: {
    label: 'New',
    title: 'Fills an empty field.',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  },
  update: {
    label: 'Updated',
    title: 'Replaces the earlier AI suggestion in this field.',
    className: 'bg-accent/10 text-accent'
  },
  replace: {
    label: 'Replaces yours',
    title: 'Overwrites text you entered. Unchecked unless you choose it.',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
  }
}

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/**
 * The create page's assistant once an analysis is back. Profile suggestions
 * are listed for the user to pick from; the form only changes when they apply
 * them, and the identity is only created when they save.
 */
export function ProfileSuggestionsPanel({
  prefill,
  saving,
  onApplied,
  onSave,
  onReviewFields
}: {
  prefill: SectionPrefill
  saving: boolean
  /** After the form has been filled, so the page can bring it into view. */
  onApplied: () => void
  onSave: () => void
  onReviewFields: () => void
}) {
  const { draft, pending } = prefill
  const others = draft
    ? SETUP_SECTIONS.filter(
        section =>
          section !== 'profile' &&
          getSectionStatus(draft.suggestions, section).state !== 'empty'
      ).map(section => SECTION_LABELS[section])
    : []

  return (
    <>
      <FlowSteps current={pending ? 'apply' : 'save'} />

      {pending ? (
        <PendingList
          // A new analysis starts its own selection.
          key={draft?.id}
          pending={pending}
          onApply={fields => {
            prefill.applyPending(fields)
            onApplied()
          }}
        />
      ) : prefill.active ? (
        <Applied
          count={prefill.filled.length}
          saving={saving}
          onSave={onSave}
          onReviewFields={onReviewFields}
          onUndo={prefill.undo}
        />
      ) : (
        <>
          <p className="bg-surface-hover/50 text-muted mt-4 rounded-lg p-3 text-[11px] leading-snug">
            Nothing new to add to your profile fields. Your form already has
            what the AI found.
          </p>
          <div className="mt-3">
            <SaveButton saving={saving} onSave={onSave} />
          </div>
        </>
      )}

      {others.length > 0 && (
        <p className="text-muted mt-3 text-[11px] leading-snug">
          Also suggested: {joinLabels(others)}. You&apos;ll review{' '}
          {others.length === 1 ? 'it' : 'them'} after you save.
        </p>
      )}

      <p className="sr-only" role="status">
        {prefill.active && !pending
          ? `${prefill.filled.length} field${prefill.filled.length === 1 ? '' : 's'} applied to the profile form.`
          : ''}
      </p>
    </>
  )
}

/** Where the user is: suggestions are in, then apply, then save. */
function FlowSteps({ current }: { current: 'apply' | 'save' }) {
  const steps = [
    { key: 'analyze', label: 'Analyzed' },
    { key: 'apply', label: 'Apply to form' },
    { key: 'save', label: 'Save' }
  ] as const
  const at = steps.findIndex(step => step.key === current)

  return (
    <ol
      aria-label="AI setup progress"
      className="mt-3 flex items-center gap-1.5 text-[11px]"
    >
      {steps.map((step, index) => {
        const done = index < at
        const active = index === at
        return (
          <li
            key={step.key}
            aria-current={active ? 'step' : undefined}
            className="flex min-w-0 items-center gap-1.5"
          >
            {index > 0 && <span aria-hidden className="bg-border h-px w-3" />}
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                done
                  ? 'bg-emerald-500 text-white'
                  : active
                    ? 'bg-accent text-background'
                    : 'bg-surface-hover text-muted'
              }`}
            >
              {done ? <Check className="h-2.5 w-2.5" /> : index + 1}
            </span>
            <span
              className={`truncate ${
                active ? 'text-foreground font-semibold' : 'text-muted'
              }`}
            >
              {step.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function PendingList({
  pending,
  onApply
}: {
  pending: PendingSuggestion[]
  onApply: (fields: string[]) => void
}) {
  // Choices the user made; the rest follow the default, which never
  // overwrites their own text.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const isPicked = (p: PendingSuggestion) =>
    picked[p.field] ?? p.change !== 'replace'
  const selected = pending.filter(isPicked).map(p => p.field)
  const allPicked = selected.length === pending.length

  return (
    <>
      <p className="text-muted mt-3 text-xs leading-relaxed">
        Choose what to add to your profile. The form won&apos;t change until you
        apply.
      </p>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-foreground text-xs font-semibold">
          {pending.length} suggestion{pending.length === 1 ? '' : 's'}
        </p>
        <button
          type="button"
          onClick={() =>
            setPicked(
              Object.fromEntries(pending.map(p => [p.field, !allPicked]))
            )
          }
          className="text-accent text-[11px] font-medium hover:underline"
        >
          {allPicked ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <ul className="border-border divide-border mt-2 divide-y rounded-lg border">
        {pending.map(p => {
          const tag = CHANGE_TAGS[p.change]
          const checked = isPicked(p)
          return (
            <li key={p.field}>
              <label
                className={`hover:bg-surface-hover/60 flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors ${
                  checked ? '' : 'opacity-70'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e =>
                    setPicked(prev => ({
                      ...prev,
                      [p.field]: e.target.checked
                    }))
                  }
                  className="accent-accent mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-foreground truncate text-xs font-medium">
                      {fieldLabel('profile', p.field)}
                    </span>
                    <span
                      title={tag.title}
                      className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold ${tag.className}`}
                    >
                      {tag.label}
                    </span>
                  </span>
                  <span className="text-foreground/80 mt-0.5 line-clamp-2 text-[11px] leading-snug wrap-break-word">
                    {String(p.value)}
                  </span>
                  {p.change !== 'new' && (
                    <span
                      className="text-muted mt-0.5 block truncate text-[11px]"
                      title={String(p.current)}
                    >
                      Now: {String(p.current)}
                    </span>
                  )}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        disabled={selected.length === 0}
        onClick={() => onApply(selected)}
        className={`${primaryButton} mt-3`}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {selected.length === 0
          ? 'Select fields to apply'
          : `Apply ${selected.length} field${selected.length === 1 ? '' : 's'} to form`}
      </button>
      <p className="text-muted mt-1.5 text-center text-[11px] leading-snug">
        You can edit everything after. Nothing is saved yet.
      </p>
    </>
  )
}

function Applied({
  count,
  saving,
  onSave,
  onReviewFields,
  onUndo
}: {
  count: number
  saving: boolean
  onSave: () => void
  onReviewFields: () => void
  onUndo: () => void
}) {
  const heading = useRef<HTMLParagraphElement>(null)
  // The Apply button is gone, so focus lands here instead of on the page.
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])

  return (
    <>
      <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
        <div className="flex items-start justify-between gap-2">
          <p
            ref={heading}
            tabIndex={-1}
            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 outline-none dark:text-emerald-400"
          >
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Applied to your profile
          </p>
          <button
            type="button"
            onClick={onUndo}
            disabled={saving}
            className="text-muted hover:text-foreground inline-flex shrink-0 items-center gap-1 text-[11px] font-medium disabled:opacity-60"
          >
            <Undo2 className="h-3 w-3" />
            Undo
          </button>
        </div>
        <p className="text-muted mt-1 text-[11px] leading-snug">
          {count} field{count === 1 ? ' was' : 's were'} filled and marked{' '}
          <span className="bg-accent/10 text-accent inline-flex items-center gap-0.5 rounded-full px-1.5 align-middle text-[10px] font-semibold">
            <Sparkles aria-hidden className="h-2.5 w-2.5" />
            AI
          </span>{' '}
          in the form. Check them, then save to create your identity.
        </p>
      </div>
      <div className="mt-3 space-y-2">
        <SaveButton saving={saving} onSave={onSave} />
        <button
          type="button"
          onClick={onReviewFields}
          className={outlineButton}
        >
          Review filled fields
        </button>
      </div>
    </>
  )
}

function SaveButton({
  saving,
  onSave
}: {
  saving: boolean
  onSave: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saving}
      className={primaryButton}
    >
      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {saving ? 'Creating…' : 'Save identity'}
    </button>
  )
}
