'use server'

import { db } from '@/db'
import { runsTable } from '@/db/schema'
import { enqueueRun, getRunDetails } from '~/jobs/queue'
import { processRunImmediately } from '~/jobs/worker'
import { revalidatePath } from 'next/cache'

export async function triggerNewRun(accountId: string, goalId?: string | null) {
  try {
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
