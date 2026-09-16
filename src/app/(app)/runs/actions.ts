'use server'

import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { enqueueRun, getRunDetails } from '~/jobs/queue'
import { processRunImmediately } from '~/jobs/worker'
import { revalidatePath } from 'next/cache'
import { getActiveAccountId } from '@/lib/active-account'

/**
 * Triggers a run for `explicitAccountId` when given (e.g. the account-scoped
 * `/accounts/[id]/runs` page, which is deliberately about that one identity),
 * otherwise falls back to the globally active account (the `/runs` page).
 * Either way the id is re-validated against real, active accounts here —
 * never trusted blindly from the client.
 */
export async function triggerNewRun(explicitAccountId?: string | null, goalId?: string | null) {
  try {
    const accountId = explicitAccountId || (await getActiveAccountId())

    if (!accountId) {
      throw new Error('No active identity selected. Add or activate an identity first.')
    }

    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, accountId)
    })
    if (!account || !account.isActive) {
      throw new Error('Identity not found or inactive')
    }

    const run = await enqueueRun({
      accountId,
      goalId: goalId || null,
      trigger: 'manual'
    })

    if (!run) {
      throw new Error('Failed to create run record')
    }

    // Trigger processing asynchronously in background
    processRunImmediately(run.id).catch((err) => {
      console.error(`Background execution error for run ${run.id}:`, err)
    })

    revalidatePath('/runs')
    revalidatePath(`/accounts/${accountId}/runs`)
    return { success: true, runId: run.id }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to trigger run', runId: undefined }
  }
}

export type RunStatusResponse =
  | { success: true; run: any; steps: any[]; findings: any[]; ideas: any[] }
  | { success: false; error: string; run?: undefined; steps?: undefined; findings?: undefined; ideas?: undefined }

export async function fetchRunStatus(runId: string): Promise<RunStatusResponse> {
  try {
    const details = await getRunDetails(runId)
    return { success: true, ...details }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to fetch run status' }
  }
}
