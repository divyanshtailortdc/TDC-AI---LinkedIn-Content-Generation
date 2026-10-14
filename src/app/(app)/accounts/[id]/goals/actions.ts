'use server'

import { db } from '@/db'
import { goalsTable } from '@/db/schema'
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

export async function createGoal(accountId: string, payload: GoalPayload) {
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
  goalId: string,
  accountId: string,
  payload: GoalPayload
) {
  validate(payload)

  await db
    .update(goalsTable)
    .set({ ...toGoalColumns(payload), updatedAt: new Date() })
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidateGoals(accountId)
  return { success: true }
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
