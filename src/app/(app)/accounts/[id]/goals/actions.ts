'use server'

import { db } from '@/db'
import { goalsTable } from '@/db/schema'
import { loadGenerationContext } from '@/lib/ai/context'
import { SkillError } from '@/lib/ai/run-skill'
import {
  GoalSuggestionError,
  suggestGoals,
  type GoalSuggestion
} from '@/lib/ai/skills/goal-suggestions'
import {
  AccountIdSchema,
  GoalPayloadSchema,
  parseSetupPayload
} from '@/lib/setup-payloads'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

/** Only what a user needs to steer a run: what to achieve and what to land. */
export type GoalPayload = {
  title: string
  objectiveType:
    | 'awareness'
    | 'engagement'
    | 'authority'
    | 'lead_gen'
    | 'recruiting'
    | 'community'
  keyMessage: string // The one key message to land
  desiredAction?: string
  targetUrl?: string
  /** Where targetUrl goes; only meaningful when there is a link. */
  linkStrategy: 'body' | 'first_comment'
}

/** Maps the form payload onto the goals table's columns. */
function toGoalColumns(payload: GoalPayload) {
  return {
    title: payload.title.trim(),
    objective: payload.objectiveType,
    keyMessage: payload.keyMessage.trim(),
    desiredAction: payload.desiredAction?.trim() || null,
    targetUrl: payload.targetUrl?.trim() || null,
    linkStrategy: (payload.linkStrategy === 'body'
      ? 'body'
      : 'first_comment') as GoalPayload['linkStrategy']
  }
}

function validate(payload: GoalPayload) {
  if (!payload.title.trim()) {
    throw new Error('Goal title is required')
  }
  if (!payload.keyMessage.trim()) {
    throw new Error(
      'The key message to land is required. The agent must know what to prove.'
    )
  }
}

function revalidateGoals(accountId: string) {
  revalidatePath(`/accounts/${accountId}/goals`)
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/accounts')
  revalidatePath('/')
}

export async function createGoal(rawAccountId: string, rawPayload: GoalPayload) {
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  const payload = parseSetupPayload(GoalPayloadSchema, rawPayload)
  validate(payload)

  await db.insert(goalsTable).values({
    accountId,
    ...toGoalColumns(payload),
    isActive: true
  })

  revalidateGoals(accountId)
  return { success: true }
}

export async function updateGoal(
  rawGoalId: string,
  rawAccountId: string,
  rawPayload: GoalPayload
) {
  const goalId = parseSetupPayload(AccountIdSchema, rawGoalId)
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  const payload = parseSetupPayload(GoalPayloadSchema, rawPayload)
  validate(payload)

  await db
    .update(goalsTable)
    .set({ ...toGoalColumns(payload), updatedAt: new Date() })
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidateGoals(accountId)
  return { success: true }
}

/** Read-only: nothing is saved until the user submits a suggestion as a goal. */
export async function suggestGoalsAction(
  accountId: string
): Promise<
  | { success: true; suggestions: GoalSuggestion[] }
  | { success: false; error: string }
> {
  try {
    const suggestions = await suggestGoals(
      await loadGenerationContext(accountId)
    )
    if (suggestions.length === 0) {
      return {
        success: false,
        error:
          'No new goals could be suggested. Try again, or add more to your profile.'
      }
    }
    return { success: true, suggestions }
  } catch (error) {
    if (error instanceof GoalSuggestionError) {
      return { success: false, error: error.message }
    }
    if (error instanceof SkillError && error.reason === 'not_configured') {
      return {
        success: false,
        error:
          'AI is not configured. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY to suggest goals.'
      }
    }
    console.error('Goal suggestions failed:', error)
    return {
      success: false,
      error:
        error instanceof SkillError && error.reason === 'timeout'
          ? 'Suggesting goals took too long. Please try again.'
          : 'Goals could not be suggested. Please try again.'
    }
  }
}

export async function toggleGoalActive(
  goalId: string,
  accountId: string,
  isActive: boolean
) {
  await db
    .update(goalsTable)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidateGoals(accountId)
  return { success: true }
}

export async function deleteGoal(goalId: string, accountId: string) {
  await db
    .delete(goalsTable)
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidateGoals(accountId)
  return { success: true }
}
