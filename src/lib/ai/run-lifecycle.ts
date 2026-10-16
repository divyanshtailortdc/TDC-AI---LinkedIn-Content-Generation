import { db } from '@/db'
import { runStepsTable, runsTable } from '@/db/schema'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import { and, eq, inArray, lt, sql, type SQL } from 'drizzle-orm'
import { refreshRunTotals } from './run-accounting'

/**
 * How a run that stops part-way gets settled.
 *
 * A throw inside the pipeline is handled by `failRun`. A process that dies
 * (restart, deploy, crash) runs no handler at all, so a live run touches its
 * row on a heartbeat and the worker fails any in-progress run that has gone
 * quiet. Without that, the run stayed "ideating" with a step "running" forever
 * and its page polled it forever.
 */

const HEARTBEAT_MS = 30_000

/**
 * Generous next to the heartbeat, so a slow database or a process still
 * running code from before the heartbeat is not mistaken for a dead one.
 */
const STALE_AFTER = sql`interval '10 minutes'`

/** Statuses a run only holds while a process is working on it; queued runs are waiting, not stuck. */
const IN_PROGRESS = ACTIVE_RUN_STATUSES.filter(status => status !== 'queued')

const INTERRUPTED =
  'The server stopped while this run was in progress. Start a new run.'

/**
 * Fails the matching runs and closes the steps they left open, together, so a
 * run never reads as failed while one of its steps still reads as running.
 */
async function failRunsWhere(condition: SQL, message: string) {
  const failedIds = await db.transaction(async tx => {
    const failed = await tx
      .update(runsTable)
      .set({ status: 'failed', error: message, updatedAt: new Date() })
      .where(condition)
      .returning({ id: runsTable.id })
    const ids = failed.map(run => run.id)
    if (ids.length > 0) {
      await tx
        .update(runStepsTable)
        .set({ status: 'failed', completedAt: new Date(), error: message })
        .where(
          and(
            inArray(runStepsTable.runId, ids),
            eq(runStepsTable.status, 'running')
          )
        )
    }
    return ids
  })

  // Spend is saved as it is billed, but a run from before that still needs it.
  for (const id of failedIds) await refreshRunTotals(id)
  return failedIds
}

/**
 * Fails a run that has not settled yet. A run that already reached a settled
 * status (say, awaiting approval) keeps it, so an error in late bookkeeping
 * cannot turn a run with saved ideas into a failed one.
 */
export async function failRun(runId: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : 'Run execution failed unexpectedly'
  await failRunsWhere(
    and(
      eq(runsTable.id, runId),
      inArray(runsTable.status, ACTIVE_RUN_STATUSES)
    )!,
    message
  )
}

/** Touches the run's row until the returned function is called. */
export function keepRunAlive(runId: string): () => void {
  const timer = setInterval(() => {
    // The database clock, like the sweep below: the database is shared, and
    // two machines' clocks may disagree.
    db.update(runsTable)
      .set({ updatedAt: sql`now()` })
      .where(eq(runsTable.id, runId))
      .catch(err => console.warn(`Heartbeat failed for run ${runId}:`, err))
  }, HEARTBEAT_MS)
  timer.unref()
  return () => clearInterval(timer)
}

/**
 * Fails in-progress runs whose heartbeat stopped, or only `runId` when given,
 * so a run's page can settle it without waiting for the worker's sweep.
 * Returns their ids.
 */
export function recoverInterruptedRuns(runId?: string): Promise<string[]> {
  return failRunsWhere(
    and(
      runId ? eq(runsTable.id, runId) : undefined,
      inArray(runsTable.status, IN_PROGRESS),
      lt(runsTable.updatedAt, sql`now() - ${STALE_AFTER}`)
    )!,
    INTERRUPTED
  )
}
