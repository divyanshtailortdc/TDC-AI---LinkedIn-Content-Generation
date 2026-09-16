'use server'

import { db } from '@/db'
import { goalsTable } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export type GoalPayload = {
  title: string
  description?: string
  objectiveType:
    | 'awareness'
    | 'engagement'
    | 'authority'
    | 'lead_gen'
    | 'recruiting'
    | 'community'
  audienceId?: string
  keyMessage: string // The one key message to land
  proofAssetIds: string[]
  desiredAction: string
  targetUrl?: string
  linkStrategy: 'body' | 'first_comment'
  successMetric?: string
  weight: number
  startDate?: string
  endDate?: string
  active: boolean
  dos: string[]
  donts: string[]
  targetCount: number
}

function toDate(value?: string) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Maps the form payload onto the goals table's real columns. */
function toGoalColumns(payload: GoalPayload) {
  return {
    title: payload.title.trim(),
    description: payload.description?.trim() || null,
    objective: payload.objectiveType,
    audienceId: payload.audienceId || null,
    keyMessage: payload.keyMessage.trim(),
    proofAssetIds: payload.proofAssetIds || [],
    desiredAction: payload.desiredAction?.trim() || null,
    targetUrl: payload.targetUrl?.trim() || null,
    linkStrategy: payload.linkStrategy,
    successMetric: payload.successMetric?.trim() || null,
    weight: Number(payload.weight) || 5,
    startDate: toDate(payload.startDate),
    endDate: toDate(payload.endDate),
    dos: payload.dos || [],
    donts: payload.donts || [],
    targetCount: payload.targetCount || 5,
    isActive: payload.active !== false
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
  if (payload.startDate && payload.endDate) {
    const start = toDate(payload.startDate)
    const end = toDate(payload.endDate)
    if (start && end && end < start) {
      throw new Error('The end date cannot be before the start date.')
    }
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
    ...toGoalColumns(payload)
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
