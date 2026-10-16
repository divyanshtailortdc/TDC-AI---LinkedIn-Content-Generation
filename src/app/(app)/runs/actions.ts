'use server'

import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { enqueueRun, getRunDetails } from '~/jobs/queue'
import { processRunImmediately } from '~/jobs/worker'
import { revalidatePath } from 'next/cache'
import { getActiveAccountId, writeActiveAccountCookie } from '@/lib/active-account'
import { recoverInterruptedRuns } from '@/lib/ai/run-lifecycle'

/**
 * Triggers a run for `explicitAccountId` when given (e.g. the account-scoped
 * `/accounts/[id]/runs` page, which is deliberately about that one identity),
 * otherwise falls back to the globally active account (the `/runs` page).
 * Either way the id is re-validated against real, active accounts here —
 * never trusted blindly from the client.
 */
export async function triggerNewRun(explicitAccountId?: string | null, goalId?: string | null) {
  try {
    const activeAccountId = await getActiveAccountId()
    const accountId = explicitAccountId || activeAccountId

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

    // The run page sends a run of any other identity back to /runs, so a run
    // started from another identity's own Runs tab makes that identity the
    // active one; otherwise the caller is bounced off the run it just started.
    if (accountId !== activeAccountId) {
      await writeActiveAccountCookie(accountId)
      revalidatePath('/', 'layout')
    }

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
    // Settles a run whose process died, so its page stops polling a run that
    // will never move again.
    await recoverInterruptedRuns(runId)
    const details = await getRunDetails(runId)
    return { success: true, ...details }
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to fetch run status' }
  }
}
