'use client'

import type { IdentitySetupAnalysis } from '@/lib/ai/skills/profile-setup/schema'
import {
  EMPTY_SUGGESTIONS,
  getSectionStatus,
  GoalSuggestionsSchema,
  IdentitySetupSuggestionsSchema,
  KnowledgeSuggestionsSchema,
  PreferencesSuggestionsSchema,
  ProfileSuggestionsSchema,
  SETUP_SECTIONS,
  VoiceSuggestionsSchema,
  type IdentitySetupSuggestions,
  type SetupSection
} from '@/lib/ai/skills/profile-setup/schema'
import { useSyncExternalStore } from 'react'

/**
 * Unsaved AI setup suggestions, kept in the browser until the user applies or
 * discards them, so nothing reaches the database before they confirm.
 *
 * Keyed by account id, or NEW_IDENTITY_KEY on the create page. sessionStorage
 * keeps a draft across tab switches and reloads; when it is unavailable the
 * in-memory copy still survives client-side navigation. The create page drops
 * its draft each time it opens (see resetDraft), so it always starts blank.
 */

export const NEW_IDENTITY_KEY = 'new'
const STORAGE_PREFIX = 'identity-setup-draft:'

/** What the user typed into the analysis, so Re-analyze starts from it. */
export type AnalysisInput = {
  description: string
  linkedinUrl: string
  websiteUrl: string
}

export type IdentitySetupDraft = Omit<IdentitySetupAnalysis, 'accountType'> & {
  /** Missing from drafts saved before analyses recorded it. */
  accountType?: IdentitySetupAnalysis['accountType']
  /** New for every analysis; forms prefill once per id. */
  id: string
  createdAt: string
  input?: AnalysisInput
}

function isAnalysisInput(value: unknown): value is AnalysisInput {
  if (!value || typeof value !== 'object') return false
  const input = value as Record<string, unknown>
  return (
    typeof input.description === 'string' &&
    typeof input.linkedinUrl === 'string' &&
    typeof input.websiteUrl === 'string'
  )
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

const FIELD_SCHEMAS = {
  profile: ProfileSuggestionsSchema,
  voice: VoiceSuggestionsSchema,
  goals: GoalSuggestionsSchema,
  preferences: PreferencesSuggestionsSchema
} as const

/**
 * Keeps every stored suggestion that still passes the current rules. When a
 * rule tightens after a draft was saved (links now need http:// or https://,
 * for one), only that field is dropped: rejecting the whole draft lost every
 * suggestion in it, and with it the review window after a reload.
 */
function salvageSuggestions(raw: unknown): IdentitySetupSuggestions | null {
  if (!raw || typeof raw !== 'object') return null
  const stored = raw as Record<string, unknown>
  const kept: Record<string, unknown> = { ...EMPTY_SUGGESTIONS }
  for (const [section, schema] of Object.entries(FIELD_SCHEMAS)) {
    const data = stored[section]
    if (!data || typeof data !== 'object') continue
    const fields: Record<string, unknown> = { missing: [] }
    for (const [field, value] of Object.entries(data)) {
      const parsed = (
        schema.shape as unknown as Record<
          string,
          { safeParse: (v: unknown) => { success: boolean; data?: unknown } }
        >
      )[field]?.safeParse(value)
      if (parsed?.success) fields[field] = parsed.data
    }
    kept[section] = fields
  }
  const knowledge = KnowledgeSuggestionsSchema.safeParse(stored.knowledge)
  if (knowledge.success) kept.knowledge = knowledge.data
  const result = IdentitySetupSuggestionsSchema.safeParse(kept)
  return result.success ? result.data : null
}

function readDraft(key: string): IdentitySetupDraft | null {
  if (memory.has(key)) return memory.get(key) ?? null

  let draft: IdentitySetupDraft | null = null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key)
    if (raw) {
      const parsed = JSON.parse(raw) as IdentitySetupDraft
      // Stored data is re-validated like anything else from the browser.
      const strict = IdentitySetupSuggestionsSchema.safeParse(
        parsed?.suggestions
      )
      const suggestions = strict.success
        ? strict.data
        : salvageSuggestions(parsed?.suggestions)
      if (suggestions && typeof parsed.id === 'string') {
        draft = {
          ...parsed,
          accountType:
            parsed.accountType === 'personal' ||
            parsed.accountType === 'company'
              ? parsed.accountType
              : undefined,
          suggestions,
          input: isAnalysisInput(parsed.input) ? parsed.input : undefined
        }
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

export function saveDraft(
  key: string,
  analysis: IdentitySetupAnalysis,
  input?: AnalysisInput
) {
  writeDraft(key, {
    ...analysis,
    input,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString()
  })
}

export function clearDraft(key: string) {
  writeDraft(key, null)
}

/**
 * Forgets the draft under `key` without notifying subscribers, so it is safe
 * to call while rendering: the create page does this on its first render so a
 * draft left by an earlier visit never reaches the new form.
 */
export function resetDraft(key: string) {
  if (typeof window === 'undefined') return
  memory.set(key, null)
  try {
    window.sessionStorage.removeItem(STORAGE_PREFIX + key)
  } catch {
    // Storage blocked: the in-memory reset is what readDraft checks first.
  }
}

export function updateDraftSuggestions(
  key: string,
  update: (suggestions: IdentitySetupSuggestions) => IdentitySetupSuggestions
) {
  const draft = readDraft(key)
  if (!draft) return
  const suggestions = update(draft.suggestions)
  // Returning the same object means nothing changed; skip the write and the
  // re-render it would cause.
  if (suggestions === draft.suggestions) return
  writeDraft(key, { ...draft, suggestions })
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

/** The setup steps that currently have AI suggestions waiting for review. */
export function useSuggestedSections(key: string): Set<SetupSection> {
  const draft = useIdentitySetupDraft(key)
  const sections = new Set<SetupSection>()
  if (!draft) return sections
  for (const section of SETUP_SECTIONS) {
    if (getSectionStatus(draft.suggestions, section).state !== 'empty') {
      sections.add(section)
    }
  }
  return sections
}
