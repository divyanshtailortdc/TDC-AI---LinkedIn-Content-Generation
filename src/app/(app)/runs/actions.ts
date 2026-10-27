'use server'

import { db } from '@/db'
import {
  accountsTable,
  researchFindingsTable,
  runStepsTable,
  runsTable
} from '@/db/schema'
import { recoverInterruptedRuns } from '@/lib/ai/run-lifecycle'
import { requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { findOwnedRun, ownedByUser } from '@/lib/ownership'
import { PAGE_SIZE } from '@/lib/pagination'
import { requireUser } from '@/lib/session'
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm'
import { after } from 'next/server'
import { enqueueRun, getRunDetails } from '~/jobs/queue'
import { runsJobsHere } from '~/jobs/role'
import { processRunImmediately } from '~/jobs/worker'

/**
 * Starts a run for the signed-in user's identity (resolved here rather than
 * taken from the client) serving the goals picked for it. Refused while the
 * identity already has a run in progress.
 */
export async function triggerNewRun(goalIds: string[]) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    // A server action's arguments come from the browser, whatever the types say.
    if (!Array.isArray(goalIds) || !goalIds.every(isUuid)) {
      throw new Error('Goal not found.')
    }

    const { run } = await enqueueRun({
      accountId,
      goalIds,
      trigger: 'manual'
    })

    if (!run) {
      throw new Error('Failed to create run record')
    }
    // Processed after the response is sent. Only a still-queued run is
    // claimed, so an existing run already underway is left alone. The web
    // service leaves it to the worker service, which polls every few seconds.
    // `after` rather than a promise left running: on a serverless host
    // (Vercel) it keeps the function alive until the run is done, where a
    // loose promise was frozen with the function once it had answered.
    if (runsJobsHere()) {
      after(() =>
        processRunImmediately(run.id).catch(err => {
          console.error(`Background execution error for run ${run.id}:`, err)
        })
      )
    }

    // No revalidatePath: it re-rendered the page the dialog was opened on,
    // which the dialog then leaves for the run's page. The Runs list notices
    // the new run by polling (pollRuns).
    return { success: true, runId: run.id }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to trigger run',
      runId: undefined
    }
  }
}

/**
 * What the Runs list polls instead of re-rendering the page: the progress of
 * the listed runs it names (the ones still moving), and the newest run's id,
 * so a run started elsewhere (a schedule, another tab) can be noticed.
 */
export async function pollRuns(runIds: string[]) {
  await requireUser()
  try {
    const accountId = await requireIdentityId()
    // A server action's arguments come from the browser, whatever the types say.
    const ids = Array.isArray(runIds)
      ? runIds.filter(isUuid).slice(0, PAGE_SIZE)
      : []
    const [runs, [latest]] = await Promise.all([
      ids.length > 0
        ? db
            .select({
              id: runsTable.id,
              status: runsTable.status,
              currentStep: runsTable.currentStep,
              totalSteps: runsTable.totalSteps,
              costUsd: runsTable.costUsd,
              tokenCounts: runsTable.tokenCounts,
              error: runsTable.error
            })
            .from(runsTable)
            .where(
              and(eq(runsTable.accountId, accountId), inArray(runsTable.id, ids))
            )
        : Promise.resolve([]),
      db
        .select({ id: runsTable.id })
        .from(runsTable)
        .where(eq(runsTable.accountId, accountId))
        .orderBy(desc(runsTable.createdAt), desc(runsTable.id))
        .limit(1)
    ])
    return { success: true as const, runs, latestRunId: latest?.id ?? null }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Failed to fetch runs'
    }
  }
}

/**
 * What a run's page polls while the run is moving: the run row and its steps.
 * Research findings are saved in one batch, so they are sent only while the
 * page has none (`needFindings`); ideas come from fetchRunStatus once the run
 * stops. Interrupted runs are settled by the worker's recovery timer, not
 * here, so a poll never writes.
 */
export async function pollRunProgress(runId: string, needFindings: boolean) {
  const user = await requireUser()
  try {
    if (!isUuid(runId)) return { success: false as const, error: 'Run not found' }
    // Ownership is checked in the same query as the row it returns.
    const [[owned], steps, findings] = await Promise.all([
      db
        .select({ run: getTableColumns(runsTable) })
        .from(runsTable)
        .innerJoin(accountsTable, eq(accountsTable.id, runsTable.accountId))
        .where(and(eq(runsTable.id, runId), ownedByUser(user.id)))
        .limit(1),
      db
        .select({ step: getTableColumns(runStepsTable) })
        .from(runStepsTable)
        .innerJoin(runsTable, eq(runsTable.id, runStepsTable.runId))
        .innerJoin(accountsTable, eq(accountsTable.id, runsTable.accountId))
        .where(and(eq(runStepsTable.runId, runId), ownedByUser(user.id)))
        .orderBy(desc(runStepsTable.createdAt))
        .then(rows => rows.map(row => row.step)),
      needFindings === true
        ? db
            .select({ finding: getTableColumns(researchFindingsTable) })
            .from(researchFindingsTable)
            .innerJoin(runsTable, eq(runsTable.id, researchFindingsTable.runId))
            .innerJoin(accountsTable, eq(accountsTable.id, runsTable.accountId))
            .where(
              and(eq(researchFindingsTable.runId, runId), ownedByUser(user.id))
            )
            .then(rows => rows.map(row => row.finding))
        : Promise.resolve(null)
    ])
    if (!owned) return { success: false as const, error: 'Run not found' }
    return { success: true as const, run: owned.run, steps, findings }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Failed to fetch run status'
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
    const details = await getRunDetails(run.id, run.accountId)
    return { success: true, ...details }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch run status'
    }
  }
}
