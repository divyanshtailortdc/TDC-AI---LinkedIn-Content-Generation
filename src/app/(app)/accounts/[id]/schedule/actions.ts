'use server'

import { db } from '@/db'
import { schedulesTable } from '@/db/schema'
import { assertAccountActive } from '@/lib/account-guard'
import { AccountIdSchema, parseSetupPayload } from '@/lib/setup-payloads'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

/** How many ideas a run produces lives in Preferences; this is only when. */
export async function saveSchedule(
  rawAccountId: string,
  payload: {
    daysOfWeek: number[]
    timeOfDay: string
    enabled: boolean
  }
) {
  try {
    const accountId = parseSetupPayload(AccountIdSchema, rawAccountId)
    await assertAccountActive(accountId)
    if (payload.daysOfWeek.length === 0) {
      throw new Error('Pick at least one day.')
    }

    const existing = await db.query.schedulesTable.findFirst({
      where: eq(schedulesTable.accountId, accountId)
    })

    const columns = {
      daysOfWeek: payload.daysOfWeek,
      timeOfDay: payload.timeOfDay,
      enabled: payload.enabled
    }

    if (existing) {
      await db
        .update(schedulesTable)
        .set({ ...columns, updatedAt: new Date() })
        .where(eq(schedulesTable.id, existing.id))
    } else {
      await db.insert(schedulesTable).values({ accountId, ...columns })
    }

    revalidatePath(`/accounts/${accountId}/preferences`)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to save schedule' }
  }
}
