'use client'

import {
  getSectionStatus,
  SECTION_LABELS,
  SETUP_SECTIONS
} from '@/lib/ai/skills/profile-setup/schema'
import { useState } from 'react'
import {
  itemOf,
  ReviewActions,
  ReviewShell,
  SectionCard,
  SuggestionRow,
  validateField,
  type Item
} from './review-dialog'
import type { PrefillChange, SectionPrefill } from './use-section-prefill'

const TAGS: Record<
  PrefillChange,
  { label: string; tone: 'new' | 'update' | 'replace' }
> = {
  new: { label: 'New', tone: 'new' },
  update: { label: 'Updated', tone: 'update' },
  replace: { label: 'Replaces yours', tone: 'replace' }
}

function joinLabels(labels: string[]): string {
  if (labels.length < 2) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`
}

/**
 * The review window on the create page. It compares each profile suggestion
 * with what the form holds now, and Apply Selected Changes writes only the
 * checked ones into the form. Nothing is saved: the identity is created when
 * the user saves the form.
 */
export function FormReviewDialog({
  prefill,
  onClose,
  onApplied
}: {
  prefill: SectionPrefill
  onClose: () => void
  /** After the form has been filled. */
  onApplied: () => void
}) {
  const { draft } = prefill
  const pending = prefill.pending ?? []
  // Edits stay here until Apply; Cancel drops them.
  const [edited, setEdited] = useState<Record<string, Item>>({})
  // The user's own ticks; anything else follows the default, which never
  // overwrites what they typed.
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState(false)

  if (!draft) return null

  const isPicked = (field: string, change: PrefillChange) =>
    picked[field] ?? change !== 'replace'
  const selected = pending
    .filter(p => isPicked(p.field, p.change))
    .map(p => p.field)
  const itemFor = (field: string) =>
    edited[field] ?? itemOf(draft.suggestions, 'profile', field)
  const blockingInvalid = [...invalid].some(field => selected.includes(field))

  const others = SETUP_SECTIONS.filter(
    section =>
      section !== 'profile' &&
      getSectionStatus(draft.suggestions, section).state !== 'empty'
  ).map(section => SECTION_LABELS[section])

  const commit = (field: string, value: unknown): string | null => {
    const problem = validateField('profile', field, value)
    setInvalid(prev => {
      const next = new Set(prev)
      if (problem) next.add(field)
      else next.delete(field)
      return next
    })
    if (problem) return problem
    setEdited(prev => ({
      ...prev,
      [field]: { value, kind: 'fact', source: 'edited' }
    }))
    // Editing a suggestion means wanting it.
    setPicked(prev => ({ ...prev, [field]: true }))
    return null
  }

  const apply = () => {
    prefill.applyPending(
      selected,
      Object.fromEntries(selected.map(field => [field, itemFor(field).value]))
    )
    onClose()
    onApplied()
  }

  return (
    <ReviewShell
      title="Review AI suggestions"
      description="Choose what to add to your profile. The form only changes when you apply."
      onClose={onClose}
      footer={
        <ReviewActions
          status={
            blockingInvalid
              ? 'Fix the highlighted values first.'
              : `${selected.length} of ${pending.length} change${pending.length === 1 ? '' : 's'} selected`
          }
          editing={editing}
          editDisabled={pending.length === 0}
          onToggleEdit={() => setEditing(!editing)}
          onCancel={onClose}
          onApply={apply}
          applyDisabled={selected.length === 0 || blockingInvalid}
        />
      }
    >
      {pending.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Your form already has these values. There is nothing to change.
        </p>
      ) : (
        <SectionCard
          title={SECTION_LABELS.profile}
          selectAll={{
            checked: selected.length,
            total: pending.length,
            onChange: checked =>
              setPicked(
                Object.fromEntries(pending.map(p => [p.field, checked]))
              )
          }}
        >
          {pending.map(p => (
            <SuggestionRow
              // A new analysis gets fresh editors.
              key={`${draft.id}-${p.field}`}
              section="profile"
              field={p.field}
              accountType={draft.accountType}
              item={itemFor(p.field)}
              current={p.change === 'new' ? undefined : p.current}
              checked={selected.includes(p.field)}
              selectable
              editing={editing}
              disabled={false}
              tag={TAGS[p.change]}
              onToggle={checked =>
                setPicked(prev => ({ ...prev, [p.field]: checked }))
              }
              onCommit={value => commit(p.field, value)}
            />
          ))}
        </SectionCard>
      )}

      {others.length > 0 && (
        <p className="text-muted text-xs">
          {joinLabels(others)} suggestions are reviewed after you save the
          identity.
        </p>
      )}
    </ReviewShell>
  )
}
