'use client'

import type { IdentitySetupSuggestions } from '@/lib/ai/skills/profile-setup/schema'
import { isEmptyValue, mergeValues, type MergeMode } from '@/lib/settings-merge'
import { useEffect, useRef, useState } from 'react'
import { useIdentitySetupDraft, type IdentitySetupDraft } from './draft-store'

type Values = Record<string, unknown>

/**
 * Drafts whose suggestions were saved from a form, as "key:section:draftId".
 * Saving refreshes the page and remounts the form, which would load the same
 * draft again and show a banner about suggestions that are already saved.
 */
const savedDrafts = new Set<string>()

export type SectionPrefill = {
  draft: IdentitySetupDraft | null
  /** Set once suggestions have been loaded into the form. */
  active: boolean
  filled: string[]
  kept: string[]
  mode: MergeMode
  /** Overwrite the kept fields too. */
  replaceAll: () => void
  /** Put the form back the way it was before the suggestions. */
  undo: () => void
  /**
   * Call after the form is saved: the filled values are now the saved ones, so
   * they stop counting as unsaved changes and there is nothing to undo.
   */
  markSaved: () => void
}

/**
 * Loads a draft's suggestions into a form once per analysis, filling only
 * blank fields. Nothing is saved: the form's own Save button does that.
 *
 * `isBlank` lets a form treat placeholder defaults (for example the example
 * pillars shown before preferences are saved) as empty.
 */
export function useSectionPrefill<T extends Values>({
  draftKey,
  section,
  getCurrent,
  setValues,
  suggestionValues,
  isBlank
}: {
  draftKey: string
  /** Names the form, so saving it stops its own banner from coming back. */
  section?: string
  getCurrent: () => T
  setValues: (values: Partial<T>) => void
  suggestionValues: (suggestions: IdentitySetupSuggestions) => Partial<T>
  isBlank?: (key: keyof T, value: unknown) => boolean
}): SectionPrefill {
  const draft = useIdentitySetupDraft(draftKey)
  const appliedDraftId = useRef<string | null>(null)
  const snapshot = useRef<T | null>(null)
  const [state, setState] = useState<{
    filled: string[]
    kept: string[]
    mode: MergeMode
  } | null>(null)

  // Latest callbacks without re-running the effect when they change identity.
  const callbacks = useRef({ getCurrent, setValues, suggestionValues, isBlank })
  useEffect(() => {
    callbacks.current = { getCurrent, setValues, suggestionValues, isBlank }
  })

  const apply = (
    mode: MergeMode,
    base: T,
    suggestions: IdentitySetupSuggestions
  ) => {
    const { setValues, suggestionValues, isBlank } = callbacks.current
    const comparable = { ...base }
    if (isBlank) {
      for (const key of Object.keys(base) as Array<keyof T>) {
        if (isBlank(key, base[key])) {
          comparable[key] = (Array.isArray(base[key]) ? [] : '') as T[keyof T]
        }
      }
    }
    const merged = mergeValues(comparable, suggestionValues(suggestions), mode)
    const changes: Partial<T> = {}
    for (const key of merged.filled) {
      changes[key as keyof T] = merged.values[key as keyof T]
    }
    if (merged.filled.length > 0) setValues(changes)
    setState({ filled: merged.filled, kept: merged.kept, mode })
  }

  useEffect(() => {
    if (!draft || appliedDraftId.current === draft.id) return
    appliedDraftId.current = draft.id
    if (section && savedDrafts.has(`${draftKey}:${section}:${draft.id}`)) return
    const base = callbacks.current.getCurrent()
    const hasSuggestions = Object.values(
      callbacks.current.suggestionValues(draft.suggestions)
    ).some(value => !isEmptyValue(value))
    if (!hasSuggestions) return
    snapshot.current = base
    apply('fill-empty', base, draft.suggestions)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply reads refs
  }, [draft])

  return {
    draft,
    active: state !== null,
    filled: state?.filled ?? [],
    kept: state?.kept ?? [],
    mode: state?.mode ?? 'fill-empty',
    replaceAll: () => {
      if (!draft || !snapshot.current) return
      apply('replace', snapshot.current, draft.suggestions)
    },
    undo: () => {
      if (!snapshot.current) return
      callbacks.current.setValues(snapshot.current)
      setState(null)
    },
    markSaved: () => {
      if (section && draft) {
        savedDrafts.add(`${draftKey}:${section}:${draft.id}`)
      }
      snapshot.current = null
      setState(null)
    }
  }
}
