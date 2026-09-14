'use server'

import { db } from '@/db'
import { schedulesTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

export async function saveSchedule(
  accountId: string,
  payload: {
    frequency: string
    daysOfWeek: number[]
    timeOfDay: string
    postsPerRun: number
    ideasPerRun: number
    enabled: boolean
  }
) {
  try {
    const existing = await db.query.schedulesTable.findFirst({
      where: eq(schedulesTable.accountId, accountId)
    })

    if (existing) {
      await db
        .update(schedulesTable)
        .set({
          frequency: payload.frequency,
          daysOfWeek: payload.daysOfWeek,
          timeOfDay: payload.timeOfDay,
          postsPerRun: payload.postsPerRun,
          ideasPerRun: payload.ideasPerRun,
          enabled: payload.enabled,
          updatedAt: new Date()
        })
        .where(eq(schedulesTable.id, existing.id))
    } else {
      await db.insert(schedulesTable).values({
        accountId,
        frequency: payload.frequency,
        daysOfWeek: payload.daysOfWeek,
        timeOfDay: payload.timeOfDay,
        postsPerRun: payload.postsPerRun,
        ideasPerRun: payload.ideasPerRun,
        enabled: payload.enabled
      })
    }

    revalidatePath(`/accounts/${accountId}/schedule`)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to save schedule' }
  }
}
