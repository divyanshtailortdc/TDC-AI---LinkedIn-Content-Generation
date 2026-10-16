'use client'

import type { IdentitySetupSuggestions } from '@/lib/ai/skills/profile-setup/schema'
import { isEmptyValue, mergeValues, type MergeMode } from '@/lib/settings-merge'
import { useEffect, useRef, useState } from 'react'
import { useIdentitySetupDraft, type IdentitySetupDraft } from './draft-store'

type Values = Record<string, unknown>

/**
 * What applying one suggestion would do to its field: fill a blank one, swap
 * out an earlier AI value the user never changed, or overwrite the user's own
 * text.
 */
export type PrefillChange = 'new' | 'update' | 'replace'

export type PendingSuggestion = {
  field: string
  value: unknown
  /** What the form holds now. */
  current: unknown
  change: PrefillChange
}

export type SectionPrefill = {
  draft: IdentitySetupDraft | null
  /** Set once suggestions have been loaded into the form. */
  active: boolean
  filled: string[]
  kept: string[]
  mode: MergeMode
  /** Fields that still hold exactly what the AI put there. */
  aiFilled: string[]
  /**
   * With `autoApply: false`: the latest analysis's suggestions that differ from
   * the form, waiting for the user to apply them. Null when there is nothing
   * waiting (none suggested, or already applied).
   */
  pending: PendingSuggestion[] | null
  /** Writes the chosen pending suggestions into the form. */
  applyPending: (fields: string[]) => void
  /** Overwrite the kept fields too. */
  replaceAll: () => void
  /** Put the form back the way it was before the suggestions. */
  undo: () => void
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Loads a draft's suggestions into a form. Nothing is saved: the form's own
 * Save button does that.
 *
 * By default each new analysis fills the blank fields as soon as it arrives.
 * With `autoApply: false` nothing changes until the user picks suggestions
 * from `pending` and calls `applyPending`.
 *
 * A value the AI wrote and the user left alone is treated as blank, so a later
 * analysis can update it; anything the user typed is kept unless they choose
 * otherwise.
 *
 * `isBlank` lets a form treat placeholder defaults (for example the example
 * pillars shown before preferences are saved) as empty.
 */
export function useSectionPrefill<T extends Values>({
  draftKey,
  autoApply = true,
  getCurrent,
  setValues,
  suggestionValues,
  isBlank
}: {
  draftKey: string
  autoApply?: boolean
  getCurrent: () => T
  setValues: (values: Partial<T>) => void
  suggestionValues: (suggestions: IdentitySetupSuggestions) => Partial<T>
  isBlank?: (key: keyof T, value: unknown) => boolean
}): SectionPrefill {
  const draft = useIdentitySetupDraft(draftKey)
  const autoAppliedId = useRef<string | null>(null)
  // The form and the AI values as they were before the latest apply.
  const snapshot = useRef<{ values: T; aiValues: Partial<T> } | null>(null)
  const [state, setState] = useState<{
    draftId: string
    filled: string[]
    kept: string[]
    mode: MergeMode
  } | null>(null)
  // What the AI last wrote into each field.
  const [aiValues, setAiValues] = useState<Partial<T>>({})

  // Latest callbacks without re-running the effect when they change identity.
  const callbacks = useRef({ getCurrent, setValues, suggestionValues, isBlank })
  useEffect(() => {
    callbacks.current = { getCurrent, setValues, suggestionValues, isBlank }
  })

  // Free for a suggestion to fill: blank, or still the AI's earlier value.
  const isOpen = (key: keyof T, value: unknown, written: Partial<T>) =>
    isEmptyValue(value) ||
    Boolean(callbacks.current.isBlank?.(key, value)) ||
    (key in written && sameValue(value, written[key]))

  const apply = (
    draftId: string,
    mode: MergeMode,
    base: T,
    written: Partial<T>,
    suggestions: IdentitySetupSuggestions
  ) => {
    const { setValues, suggestionValues } = callbacks.current
    const comparable = { ...base }
    for (const key of Object.keys(base) as Array<keyof T>) {
      if (isOpen(key, base[key], written)) {
        comparable[key] = (Array.isArray(base[key]) ? [] : '') as T[keyof T]
      }
    }
    const merged = mergeValues(comparable, suggestionValues(suggestions), mode)
    const changes: Partial<T> = {}
    for (const key of merged.filled) {
      changes[key as keyof T] = merged.values[key as keyof T]
    }
    if (merged.filled.length > 0) setValues(changes)
    setAiValues({ ...written, ...changes })
    setState({ draftId, filled: merged.filled, kept: merged.kept, mode })
  }

  useEffect(() => {
    if (!autoApply) return
    if (!draft || autoAppliedId.current === draft.id) return
    autoAppliedId.current = draft.id
    const base = callbacks.current.getCurrent()
    const hasSuggestions = Object.values(
      callbacks.current.suggestionValues(draft.suggestions)
    ).some(value => !isEmptyValue(value))
    if (!hasSuggestions) return
    snapshot.current = { values: base, aiValues }
    apply(draft.id, 'fill-empty', base, aiValues, draft.suggestions)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per draft
  }, [draft, autoApply])

  const current = getCurrent()

  let pending: PendingSuggestion[] | null = null
  if (!autoApply && draft && state?.draftId !== draft.id) {
    const suggested = Object.entries(
      suggestionValues(draft.suggestions)
    ) as Array<[keyof T & string, unknown]>
    const list: PendingSuggestion[] = []
    for (const [field, value] of suggested) {
      if (isEmptyValue(value) || sameValue(current[field], value)) continue
      const change: PrefillChange =
        isEmptyValue(current[field]) || isBlank?.(field, current[field])
          ? 'new'
          : field in aiValues && sameValue(current[field], aiValues[field])
            ? 'update'
            : 'replace'
      list.push({ field, value, current: current[field], change })
    }
    if (list.length > 0) pending = list
  }

  const aiFilled = (Object.keys(aiValues) as Array<keyof T & string>).filter(
    key =>
      !isEmptyValue(aiValues[key]) && sameValue(current[key], aiValues[key])
  )

  return {
    draft,
    active: state !== null,
    filled: state?.filled ?? [],
    kept: state?.kept ?? [],
    mode: state?.mode ?? 'fill-empty',
    aiFilled,
    pending,
    applyPending: fields => {
      if (!draft || !pending) return
      const chosen = pending.filter(p => fields.includes(p.field))
      snapshot.current = { values: current, aiValues }
      const changes = Object.fromEntries(
        chosen.map(p => [p.field, p.value])
      ) as Partial<T>
      if (chosen.length > 0) callbacks.current.setValues(changes)
      setAiValues({ ...aiValues, ...changes })
      setState({
        draftId: draft.id,
        filled: chosen.map(p => p.field),
        // Only the user's own text counts as kept; a blank left blank does not.
        kept: pending
          .filter(p => p.change === 'replace' && !fields.includes(p.field))
          .map(p => p.field),
        mode: 'replace'
      })
    },
    replaceAll: () => {
      if (!draft || !snapshot.current) return
      const { values, aiValues: written } = snapshot.current
      apply(draft.id, 'replace', values, written, draft.suggestions)
    },
    undo: () => {
      if (!snapshot.current) return
      callbacks.current.setValues(snapshot.current.values)
      setAiValues(snapshot.current.aiValues)
      snapshot.current = null
      // With autoApply off this puts the suggestions back up for review.
      setState(null)
    }
  }
}
