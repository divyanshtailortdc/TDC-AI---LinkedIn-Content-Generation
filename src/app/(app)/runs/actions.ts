'use server'

import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { enqueueRun, getRunDetails } from '~/jobs/queue'
import { processRunImmediately } from '~/jobs/worker'
import { revalidatePath } from 'next/cache'
import { getActiveAccountId, writeActiveAccountCookie } from '@/lib/active-account'
import { isUuid } from '@/lib/ids'
import { INACTIVE_ACCOUNT_MESSAGE } from '@/lib/inactive-account'
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
    if (!isUuid(accountId)) throw new Error('Identity not found')
    if (goalId && !isUuid(goalId)) throw new Error('Goal not found')

    const account = await db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, accountId)
    })
    if (!account) throw new Error('Identity not found')
    if (!account.isActive) throw new Error(INACTIVE_ACCOUNT_MESSAGE)

    // A run already in progress for this identity is returned instead of a
    // new one, so a second tab or a repeated click opens that run.
    const { run } = await enqueueRun({
      accountId,
      goalId: goalId || null,
      trigger: 'manual'
    })

    if (!run) {
      throw new Error('Failed to create run record')
    }
    // Trigger processing asynchronously in background. Only a still-queued run
    // is claimed, so an existing run already underway is left alone.
    processRunImmediately(run.id).catch((err) => {
      console.error(`Background execution error for run ${run.id}:`, err)
    })

    // A run started from another identity's own Runs tab makes that identity
    // the active one. The run page would switch to it anyway; doing it here
    // saves the sidebar flipping identity just after the run page opens.
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
  if (!isUuid(runId)) return { success: false, error: 'Run not found' }
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
