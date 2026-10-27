'use server'

import { db } from '@/db'
import {
  accountsTable,
  researchFindingsTable,
  runStepsTable,
  runsTable
} from '@/db/schema'
import { goalIdsOfRun } from '@/lib/ai/pipeline/ideation-run'
import { recoverInterruptedRuns, stopActiveRun } from '@/lib/ai/run-lifecycle'
import { IDENTITY_PATH, requireIdentityId } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { findOwnedRun, ownedByUser } from '@/lib/ownership'
import { PAGE_SIZE } from '@/lib/pagination'
import { requireUser } from '@/lib/session'
import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
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
    startInBackground(run.id)

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

/**
 * Trigger processing asynchronously in background. Only a still-queued run is
 * claimed, so an existing run already underway is left alone. The web service
 * leaves it to the worker service, which polls every few seconds.
 */
function startInBackground(runId: string) {
  if (!runsJobsHere()) return
  processRunImmediately(runId).catch(err => {
    console.error(`Background execution error for run ${runId}:`, err)
  })
}

/**
 * Stops a run's analysis while it is queued or in progress. What it found so
 * far stays on the run; it saves no ideas.
 */
export async function stopRun(runId: string) {
  const user = await requireUser()
  try {
    const run = await findOwnedRun(db, user.id, runId)
    if (!run) return { success: false as const, error: 'Run not found' }
    if (!(await stopActiveRun(run.id))) {
      return {
        success: false as const,
        error: 'This analysis has already finished.'
      }
    }
    revalidatePath('/runs')
    revalidatePath(`${IDENTITY_PATH}/runs`)
    return { success: true as const }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Failed to stop the run'
    }
  }
}

/**
 * Runs the analysis again for a run's goals, as a new run from gathering
 * context onwards. The run itself, its ideas and any posts drafted from them
 * stay as they are; those ideas count as earlier work, so the new run looks
 * for fresh angles. Works by the run's own identity, whichever is active.
 */
export async function reanalyzeRun(runId: string) {
  const user = await requireUser()
  try {
    const owned = await findOwnedRun(db, user.id, runId)
    const source = owned
      ? await db.query.runsTable.findFirst({
          where: eq(runsTable.id, owned.id),
          columns: { goalIds: true, goalId: true }
        })
      : undefined
    if (!owned || !source) throw new Error('Run not found')

    const { run } = await enqueueRun({
      accountId: owned.accountId,
      goalIds: goalIdsOfRun(source),
      trigger: 'manual'
    })
    if (!run) {
      throw new Error('Failed to create run record')
    }
    startInBackground(run.id)

    revalidatePath('/runs')
    revalidatePath(`${IDENTITY_PATH}/runs`)
    return { success: true as const, runId: run.id }
  } catch (err: any) {
    return {
      success: false as const,
      error: err.message || 'Failed to re-analyze the run',
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
    const details = await getRunDetails(run.id)
    return { success: true, ...details }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Failed to fetch run status'
    }
  }
}
