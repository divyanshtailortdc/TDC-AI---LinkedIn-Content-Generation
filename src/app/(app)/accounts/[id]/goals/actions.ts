'use server'

import { db } from '@/db'
import { goalsTable } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export type GoalPayload = {
  title: string
  description?: string
  objectiveType: 'awareness' | 'engagement' | 'authority' | 'lead_gen' | 'recruiting' | 'community'
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

export async function createGoal(accountId: string, payload: GoalPayload) {
  if (!payload.title.trim()) {
    throw new Error('Goal title is required')
  }
  if (!payload.keyMessage.trim()) {
    throw new Error('The key message to land is required. The agent must know what to prove.')
  }

  // Pack all Part 2 fields into JSON title representation
  const packedData = JSON.stringify({
    title: payload.title.trim(),
    description: payload.description?.trim() || '',
    objectiveType: payload.objectiveType,
    audienceId: payload.audienceId || null,
    keyMessage: payload.keyMessage.trim(),
    proofAssetIds: payload.proofAssetIds || [],
    desiredAction: payload.desiredAction.trim(),
    targetUrl: payload.targetUrl?.trim() || null,
    linkStrategy: payload.linkStrategy,
    successMetric: payload.successMetric?.trim() || '',
    weight: payload.weight || 5,
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    dos: payload.dos || [],
    donts: payload.donts || [],
  })

  await db.insert(goalsTable).values({
    accountId,
    title: packedData,
    objective: payload.objectiveType.slice(0, 30),
    targetCount: payload.targetCount || 5,
    isActive: payload.active !== false,
  })

  revalidatePath(`/accounts/${accountId}/goals`)
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/')
  return { success: true }
}

export async function toggleGoalActive(
  goalId: string,
  accountId: string,
  isActive: boolean
) {
  await db
    .update(goalsTable)
    .set({
      isActive,
      updatedAt: new Date(),
    })
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidatePath(`/accounts/${accountId}/goals`)
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/')
  return { success: true }
}

export async function deleteGoal(goalId: string, accountId: string) {
  await db
    .delete(goalsTable)
    .where(and(eq(goalsTable.id, goalId), eq(goalsTable.accountId, accountId)))

  revalidatePath(`/accounts/${accountId}/goals`)
  revalidatePath(`/accounts/${accountId}`)
  revalidatePath('/')
  return { success: true }
}
