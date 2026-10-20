import type { GoalPayload } from '@/app/(app)/identity/goals/actions'
import type { PreferencesPayload } from '@/app/(app)/identity/preferences/actions'
import type { SaveVoiceInput } from '@/app/(app)/identity/voice/actions'
import type { ContentPillar, Guardrails, PostConstraints } from '@/db/schema'
import type {
  GoalSuggestions,
  PreferencesSuggestions,
  ProfileSuggestions,
  VoiceSuggestions
} from '@/lib/ai/skills/profile-setup/schema'
import { hasGoalTitle } from '@/lib/goal-titles'
import type { IdentityProfileField } from '@/lib/identity-profile'

/**
 * Merging AI suggestions into what an account already has.
 *
 * "fill-empty" (the default everywhere) only writes fields that are blank, so
 * saved data is never overwritten silently. "replace" is used only when the
 * user explicitly chooses it.
 */

export type MergeMode = 'fill-empty' | 'replace'

export type MergeResult<T> = {
  values: T
  /** Fields that took the suggested value. */
  filled: string[]
  /** Fields where a saved value differs from the suggestion and was kept. */
  kept: string[]
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function mergeValues<T extends Record<string, unknown>>(
  current: T,
  suggested: Partial<T>,
  mode: MergeMode
): MergeResult<T> {
  const values = { ...current }
  const filled: string[] = []
  const kept: string[] = []

  for (const key of Object.keys(suggested) as Array<keyof T & string>) {
    const next = suggested[key]
    if (isEmptyValue(next)) continue
    if (mode === 'replace' || isEmptyValue(current[key])) {
      if (!sameValue(current[key], next)) {
        values[key] = next as T[typeof key]
        filled.push(key)
      }
    } else if (!sameValue(current[key], next)) {
      kept.push(key)
    }
  }

  return { values, filled, kept }
}

/**
 * What undoing a prefill writes back. A field the prefill changed returns to
 * its value from before, unless the user has edited it since; a field the
 * prefill left alone is not touched, so nothing typed after it is lost.
 *
 * `after` is the form as it read once the prefill landed, not the raw
 * suggestions: a form that reshapes a value (a list shown as comma-separated
 * text) would otherwise make an untouched field look edited.
 */
export function undoValues<T extends Record<string, unknown>>(
  before: T,
  after: T,
  current: T
): Partial<T> {
  const restore: Partial<T> = {}
  for (const key of Object.keys(before) as Array<keyof T>) {
    if (sameValue(after[key], before[key])) continue
    if (!sameValue(current[key], after[key])) continue
    restore[key] = before[key]
  }
  return restore
}

/** Picks `.value` from every suggested field of a section. */
function valuesOf<T extends Record<string, unknown>>(
  section: T
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(section)) {
    if (key === 'missing' || !field || typeof field !== 'object') continue
    if ('value' in field) out[key] = (field as { value: unknown }).value
  }
  return out
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type ProfileValues = Record<IdentityProfileField, string>

export function profileSuggestionValues(
  profile: ProfileSuggestions
): Partial<ProfileValues> {
  return valuesOf(profile) as Partial<ProfileValues>
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/** The settings the Voice page edits. */
export type VoiceValues = {
  tone: string
  derivedStyleRubric: string
  formality: number | null
  directness: number | null
  perspective: string
  emojiPolicy: string
  hashtagPolicy: string
  bannedWords: string[]
}

export function voiceValuesFromConfig(
  config:
    | {
        tone?: string | null
        derivedStyleRubric?: string | null
        formality?: number | null
        directness?: number | null
        perspective?: string | null
        emojiPolicy?: string | null
        hashtagPolicy?: string | null
        bannedWords?: string[] | null
      }
    | null
    | undefined
): VoiceValues {
  return {
    tone: config?.tone || '',
    derivedStyleRubric: config?.derivedStyleRubric || '',
    formality: config?.formality ?? null,
    directness: config?.directness ?? null,
    perspective: config?.perspective || '',
    emojiPolicy: config?.emojiPolicy || '',
    hashtagPolicy: config?.hashtagPolicy || '',
    bannedWords: config?.bannedWords || []
  }
}

export function voiceSuggestionValues(
  voice: VoiceSuggestions
): Partial<VoiceValues> {
  return valuesOf(voice) as Partial<VoiceValues>
}

/**
 * The payload for saveVoiceConfigAction. Blank values are left out, which the
 * action treats as "keep what is saved"; sample posts are never sent, so the
 * account's real posts are untouched.
 */
export function buildVoiceSaveInput(
  accountId: string,
  values: VoiceValues
): SaveVoiceInput {
  return {
    accountId,
    tone: values.tone || undefined,
    derivedStyleRubric: values.derivedStyleRubric || undefined,
    formality: values.formality ?? undefined,
    directness: values.directness ?? undefined,
    perspective: values.perspective || undefined,
    emojiPolicy: values.emojiPolicy || undefined,
    hashtagPolicy: values.hashtagPolicy || undefined,
    bannedWords: values.bannedWords.length > 0 ? values.bannedWords : undefined
  }
}

// ---------------------------------------------------------------------------
// Goals: suggestions always become a new goal, so nothing existing changes.
// ---------------------------------------------------------------------------

export type GoalValues = {
  title: string
  objectiveType: GoalPayload['objectiveType']
  keyMessage: string
  desiredAction: string
  targetUrl: string
  linkStrategy: GoalPayload['linkStrategy']
}

export const EMPTY_GOAL_VALUES: GoalValues = {
  title: '',
  objectiveType: 'authority',
  keyMessage: '',
  desiredAction: '',
  targetUrl: '',
  linkStrategy: 'first_comment'
}

export function goalSuggestionValues(
  goals: GoalSuggestions
): Partial<GoalValues> {
  return valuesOf(goals) as Partial<GoalValues>
}

export type GoalPlan = {
  /** An existing goal with the same title, which the new one would repeat. */
  duplicate: string | null
  /** Whether the new goal should be active. */
  activate: boolean
  /** The goal new runs use today: the newest active one. */
  activeGoalTitle: string | null
}

/**
 * How an AI goal joins the account's goals. Runs use the newest active goal,
 * so adding the AI's goal as active quietly took over from the goal the user
 * had chosen, while the review said their goals were unchanged. With a goal
 * already active, the new one is added paused; the user can switch in Goals.
 */
export function planNewGoal(
  existing: Array<{ title: string; isActive: boolean; createdAt: Date }>,
  title: string
): GoalPlan {
  const active = existing
    .filter(goal => goal.isActive)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
  return {
    duplicate:
      existing.find(goal => hasGoalTitle([goal.title], title))?.title ?? null,
    activate: !active,
    activeGoalTitle: active?.title ?? null
  }
}

export function buildGoalPayload(
  goals: GoalSuggestions
): { payload: GoalPayload } | { missing: string[] } {
  const values = { ...EMPTY_GOAL_VALUES, ...goalSuggestionValues(goals) }
  const missing = (['title', 'keyMessage'] as const).filter(field =>
    isEmptyValue(values[field])
  )
  if (missing.length > 0) return { missing: [...missing] }

  return {
    payload: {
      title: values.title,
      objectiveType: values.objectiveType,
      keyMessage: values.keyMessage,
      desiredAction: values.desiredAction || undefined,
      targetUrl: values.targetUrl || undefined,
      linkStrategy: values.linkStrategy
    }
  }
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * The preference settings AI setup suggests; ideas per run and CTA are left
 * alone, and link placement is suggested with the goal it belongs to.
 */
export type PreferencesValues = {
  pillars: ContentPillar[]
  bannedTopics: string[]
  complianceNotes: string
}

/** No saved row means every field is empty; defaults are not the user's choice. */
export function preferencesValuesFromRow(
  row:
    | {
        pillars?: ContentPillar[] | null
        postConstraints?: Partial<PostConstraints> | null
        guardrails?: Partial<Guardrails> | null
      }
    | null
    | undefined
): PreferencesValues {
  return {
    pillars: Array.isArray(row?.pillars) ? row.pillars : [],
    bannedTopics: row?.guardrails?.banned_topics || [],
    complianceNotes: row?.guardrails?.compliance_notes || ''
  }
}

export function preferencesSuggestionValues(
  preferences: PreferencesSuggestions
): Partial<PreferencesValues> {
  return valuesOf(preferences) as Partial<PreferencesValues>
}

/**
 * A full payload for savePreferences: `current` is what the account resolves
 * to today (saved values or the pipeline defaults), with the merged values
 * laid over it.
 */
export function buildPreferencesPayload(
  current: PreferencesPayload,
  values: PreferencesValues
): PreferencesPayload {
  return {
    pillars: values.pillars,
    ideasPerRun: current.ideasPerRun,
    post_constraints: current.post_constraints,
    guardrails: {
      banned_topics: values.bannedTopics,
      compliance_notes: values.complianceNotes
    }
  }
}
