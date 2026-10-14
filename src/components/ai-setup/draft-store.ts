'use client'

import { useSyncExternalStore } from 'react'
import type { IdentitySetupAnalysis } from '@/lib/ai/identity-setup/analyze'
import {
  IdentitySetupSuggestionsSchema,
  type IdentitySetupSuggestions
} from '@/lib/ai/identity-setup/schema'

/**
 * Unsaved AI setup suggestions, kept in the browser until the user applies or
 * discards them, so nothing reaches the database before they confirm.
 *
 * Keyed by account id, or NEW_IDENTITY_KEY on the create page. sessionStorage
 * keeps a draft across tab switches and reloads; when it is unavailable the
 * in-memory copy still survives client-side navigation.
 */

export const NEW_IDENTITY_KEY = 'new'
const STORAGE_PREFIX = 'identity-setup-draft:'

export type IdentitySetupDraft = IdentitySetupAnalysis & {
  /** New for every analysis; forms prefill once per id. */
  id: string
  createdAt: string
}

const memory = new Map<string, IdentitySetupDraft | null>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readDraft(key: string): IdentitySetupDraft | null {
  if (memory.has(key)) return memory.get(key) ?? null

  let draft: IdentitySetupDraft | null = null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key)
    if (raw) {
      const parsed = JSON.parse(raw) as IdentitySetupDraft
      // Stored data is re-validated like anything else from the browser.
      const suggestions = IdentitySetupSuggestionsSchema.safeParse(
        parsed?.suggestions
      )
      if (suggestions.success && typeof parsed.id === 'string') {
        draft = { ...parsed, suggestions: suggestions.data }
      }
    }
  } catch {
    draft = null
  }
  memory.set(key, draft)
  return draft
}

function writeDraft(key: string, draft: IdentitySetupDraft | null) {
  memory.set(key, draft)
  try {
    if (draft) {
      window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(draft))
    } else {
      window.sessionStorage.removeItem(STORAGE_PREFIX + key)
    }
  } catch {
    // Storage full or blocked: the in-memory copy is enough for this session.
  }
  emit()
}

export function saveDraft(key: string, analysis: IdentitySetupAnalysis) {
  writeDraft(key, {
    ...analysis,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString()
  })
}

export function clearDraft(key: string) {
  writeDraft(key, null)
}

export function updateDraftSuggestions(
  key: string,
  update: (suggestions: IdentitySetupSuggestions) => IdentitySetupSuggestions
) {
  const draft = readDraft(key)
  if (!draft) return
  writeDraft(key, { ...draft, suggestions: update(draft.suggestions) })
}

/** Hands a draft made on the create page to the account it created. */
export function moveDraft(fromKey: string, toKey: string) {
  const draft = readDraft(fromKey)
  if (!draft) return
  writeDraft(toKey, draft)
  writeDraft(fromKey, null)
}

export function useIdentitySetupDraft(key: string): IdentitySetupDraft | null {
  return useSyncExternalStore(
    subscribe,
    () => readDraft(key),
    () => null
  )
}
