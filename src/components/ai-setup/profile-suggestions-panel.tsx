'use client'

import {
  fieldLabel,
  getSectionStatus,
  SECTION_LABELS,
  SETUP_SECTIONS
} from '@/lib/ai/skills/profile-setup/schema'
import {
  Check,
  CheckCircle2,
  ListChecks,
  Loader2,
  Sparkles,
  Undo2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FormReviewDialog } from './form-review-dialog'
import type { PendingSuggestion, SectionPrefill } from './use-section-prefill'

const primaryButton =
  'bg-accent hover:bg-accent-hover text-background flex h-8 w-full items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60'
const outlineButton =
  'border-border bg-surface text-foreground hover:bg-surface-hover flex h-8 w-full items-center justify-center rounded-lg border px-3.5 text-[13px] font-medium transition-colors'

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/**
 * The create page's assistant once an analysis is back. View AI suggestions
 * opens the review window; the form only changes when the user applies from
 * there, and the identity is only created when they save.
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
  const [reviewOpen, setReviewOpen] = useState(false)
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
        <Ready pending={pending} onView={() => setReviewOpen(true)} />
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

      {reviewOpen && pending && (
        <FormReviewDialog
          // Each analysis opens with its own selection and edits.
          key={draft?.id}
          prefill={prefill}
          onClose={() => setReviewOpen(false)}
          onApplied={onApplied}
        />
      )}
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

/** Suggestions are in: what they cover, and the way into the review window. */
function Ready({
  pending,
  onView
}: {
  pending: PendingSuggestion[]
  onView: () => void
}) {
  const labels = pending.map(p => fieldLabel('profile', p.field))
  const shown = labels.slice(0, 3).join(', ')
  const more = labels.length - 3

  return (
    <>
      <div className="border-brand/30 bg-brand/5 mt-4 rounded-lg border p-3">
        <p className="text-foreground flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="text-brand-strong h-3.5 w-3.5 shrink-0" />
          {pending.length} suggestion{pending.length === 1 ? '' : 's'} ready for
          your profile
        </p>
        <p className="text-muted mt-1 text-[11px] leading-snug">
          {shown}
          {more > 0 && ` and ${more} more`}
        </p>
      </div>
      <button
        type="button"
        onClick={onView}
        className={`${primaryButton} mt-3`}
      >
        <ListChecks className="h-3.5 w-3.5" />
        View AI suggestions
      </button>
      <p className="text-muted mt-1.5 text-center text-[11px] leading-snug">
        Nothing changes in the form until you apply.
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
