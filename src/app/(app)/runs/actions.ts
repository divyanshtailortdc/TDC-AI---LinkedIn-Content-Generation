'use server'

import { db } from '@/db'
import { recoverInterruptedRuns } from '@/lib/ai/run-lifecycle'
import { IDENTITY_PATH, requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { findOwnedRun } from '@/lib/ownership'
import { requireUser } from '@/lib/session'
import { revalidatePath } from 'next/cache'
import { enqueueRun, getRunDetails } from '~/jobs/queue'
import { processRunImmediately } from '~/jobs/worker'

/**
 * Triggers a run for the signed-in user's identity, resolved here rather than
 * taken from the client.
 */
export async function triggerNewRun(goalId?: string | null) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    if (goalId && !isUuid(goalId)) throw new Error('Goal not found')

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
    processRunImmediately(run.id).catch(err => {
      console.error(`Background execution error for run ${run.id}:`, err)
    })

    revalidatePath('/runs')
    revalidatePath(`${IDENTITY_PATH}/runs`)
    return { success: true, runId: run.id }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to trigger run',
      runId: undefined
    }
  }
}

export type RunStatusResponse =
  | { success: true; run: any; steps: any[]; findings: any[]; ideas: any[] }
  | {
      success: false
      error: string
      run?: undefined
      steps?: undefined
      findings?: undefined
      ideas?: undefined
    }

export async function fetchRunStatus(
  runId: string
): Promise<RunStatusResponse> {
  const user = await requireUser()
  try {
    // Someone else's run reads exactly like one that does not exist.
    const run = await findOwnedRun(db, user.id, runId)
    if (!run) return { success: false, error: 'Run not found' }
    // Settles a run whose process died, so its page stops polling a run that
    // will never move again.
    await recoverInterruptedRuns(run.id)
    const details = await getRunDetails(run.id)
    return { success: true, ...details }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch run status'
    }
  }
}
