'use server'

import { db } from '@/db'
import { goalsTable } from '@/db/schema'
import { NotFoundError, requireOwnedAccount } from '@/lib/account-guard'
import { loadGenerationContext } from '@/lib/ai/context'
import { SkillError } from '@/lib/ai/run-skill'
import {
  GoalSuggestionError,
  suggestGoals,
  type GoalSuggestion
} from '@/lib/ai/skills/goal-suggestions'
import { hasGoalTitle } from '@/lib/goal-titles'
import { IDENTITY_PATH } from '@/lib/identity'
import { idSchema } from '@/lib/ids'
import { requireUser } from '@/lib/session'
import {
  AccountIdSchema,
  GoalPayloadSchema,
  parseSetupPayload
} from '@/lib/setup-payloads'
import { and, eq, ne } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

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

/** Two goals with the same title would be indistinguishable in a run. */
async function assertTitleIsNew(
  accountId: string,
  title: string,
  exceptGoalId?: string
) {
  const rows = await db
    .select({ title: goalsTable.title })
    .from(goalsTable)
    .where(
      exceptGoalId
        ? and(
            eq(goalsTable.accountId, accountId),
            ne(goalsTable.id, exceptGoalId)
          )
        : eq(goalsTable.accountId, accountId)
    )
  if (
    hasGoalTitle(
      rows.map(r => r.title),
      title
    )
  ) {
    throw new Error(`A goal named "${title.trim()}" already exists.`)
  }
}

const GoalIdSchema = idSchema('Invalid goal identifier')

function revalidateGoals() {
  revalidatePath('/goals')
  // Run pickers list the active goals; the dashboard checks there is one.
  revalidatePath('/runs')
  revalidatePath(`${IDENTITY_PATH}/runs`)
  revalidatePath('/schedule')
  revalidatePath('/')
}

const CreateGoalOptionsSchema = z
  .object({ active: z.boolean().optional() })
  .optional()

/**
 * Creates an active goal unless `options.active` is false. AI setup adds its
 * goal paused when another goal is active, so it never takes over silently.
 */
export async function createGoal(
  rawAccountId: string,
  rawPayload: GoalPayload,
  rawOptions?: { active?: boolean }
) {
  const user = await requireUser()
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  await requireOwnedAccount(user.id, accountId)
  const payload = parseSetupPayload(GoalPayloadSchema, rawPayload)
  const options = parseSetupPayload(CreateGoalOptionsSchema, rawOptions)
  validate(payload)
  await assertTitleIsNew(accountId, payload.title)

  await db.insert(goalsTable).values({
    accountId,
    ...toGoalColumns(payload),
    isActive: options?.active ?? true
  })

  revalidateGoals()
  return { success: true }
}

export async function updateGoal(
  rawGoalId: string,
  rawAccountId: string,
  rawPayload: GoalPayload
) {
  const user = await requireUser()
  const goalId = parseSetupPayload(GoalIdSchema, rawGoalId)
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  // The goal is then matched on both ids, so only this identity's goal changes.
  await requireOwnedAccount(user.id, accountId)
  const payload = parseSetupPayload(GoalPayloadSchema, rawPayload)
  validate(payload)
  await assertTitleIsNew(accountId, payload.title, goalId)

  await db
    .update(goalsTable)
    .set({ ...toGoalColumns(payload), updatedAt: new Date() })
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidateGoals()
  return { success: true }
}

/** Read-only: nothing is saved until the user submits a suggestion as a goal. */
export async function suggestGoalsAction(
  accountId: string
): Promise<
  | { success: true; suggestions: GoalSuggestion[] }
  | { success: false; error: string }
> {
  const user = await requireUser()
  try {
    await requireOwnedAccount(user.id, accountId)
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
    if (
      error instanceof GoalSuggestionError ||
      error instanceof NotFoundError
    ) {
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
  rawGoalId: string,
  rawAccountId: string,
  isActive: boolean
) {
  const user = await requireUser()
  const goalId = parseSetupPayload(GoalIdSchema, rawGoalId)
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  await requireOwnedAccount(user.id, accountId)
  await db
    .update(goalsTable)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidateGoals()
  return { success: true }
}

export async function deleteGoal(rawGoalId: string, rawAccountId: string) {
  const user = await requireUser()
  const goalId = parseSetupPayload(GoalIdSchema, rawGoalId)
  const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
  await requireOwnedAccount(user.id, accountId)
  await db
    .delete(goalsTable)
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidateGoals()
  return { success: true }
}
