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
 * What a run, and the steps it left open, read once stopped from its page.
 * Not an active status, so the worker never claims or resumes it.
 */
export const STOPPED_RUN_STATUS = 'stopped'

/** How often a run under way checks whether it has been stopped. */
const STOP_POLL_MS = 3_000

/** Thrown inside a stopped run, so it saves nothing more. */
export class RunStoppedError extends Error {
  constructor() {
    super('The run was stopped.')
    this.name = 'RunStoppedError'
  }
}

/**
 * Settles the matching runs and closes the steps they left open, together, so
 * a run never reads as failed while one of its steps still reads as running.
 */
async function settleRunsWhere(
  condition: SQL,
  status: 'failed' | typeof STOPPED_RUN_STATUS,
  message: string | null
) {
  const settledIds = await db.transaction(async tx => {
    const settled = await tx
      .update(runsTable)
      .set({ status, error: message, updatedAt: new Date() })
      .where(condition)
      .returning({ id: runsTable.id })
    const ids = settled.map(run => run.id)
    if (ids.length > 0) {
      await tx
        .update(runStepsTable)
        .set({ status, completedAt: new Date(), error: message })
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
  for (const id of settledIds) await refreshRunTotals(id)
  return settledIds
}

/**
 * Fails a run that has not settled yet. A run that already reached a settled
 * status (say, awaiting approval) keeps it, so an error in late bookkeeping
 * cannot turn a run with saved ideas into a failed one.
 */
export async function failRun(runId: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : 'Run execution failed unexpectedly'
  await settleRunsWhere(
    and(
      eq(runsTable.id, runId),
      inArray(runsTable.status, ACTIVE_RUN_STATUSES)
    )!,
    'failed',
    message
  )
}

/**
 * Stops a queued or in-progress run. A queued run is never claimed after
 * this; one under way notices through watchForStop and saves nothing more.
 * Returns false when the run had already settled.
 */
export async function stopActiveRun(runId: string): Promise<boolean> {
  const stopped = await settleRunsWhere(
    and(
      eq(runsTable.id, runId),
      inArray(runsTable.status, ACTIVE_RUN_STATUSES)
    )!,
    STOPPED_RUN_STATUS,
    null
  )
  return stopped.length > 0
}

/**
 * Closes the steps a stopped run opened after stopActiveRun closed the rest:
 * the run only notices the stop on its next check.
 */
export async function closeStoppedRunSteps(runId: string) {
  await db
    .update(runStepsTable)
    .set({ status: STOPPED_RUN_STATUS, completedAt: new Date() })
    .where(
      and(eq(runStepsTable.runId, runId), eq(runStepsTable.status, 'running'))
    )
}

/**
 * Aborts once the run is stopped. The page that stops it may be served by
 * another process than the one running it (APP_ROLE), so the stop is read
 * from the row rather than passed in memory.
 */
export function watchForStop(runId: string): {
  signal: AbortSignal
  dispose: () => void
} {
  const controller = new AbortController()
  const timer = setInterval(() => {
    db.select({ status: runsTable.status })
      .from(runsTable)
      .where(eq(runsTable.id, runId))
      .limit(1)
      .then(([row]) => {
        if (row?.status !== STOPPED_RUN_STATUS) return
        clearInterval(timer)
        controller.abort(new RunStoppedError())
      })
      .catch(err => console.warn(`Stop check failed for run ${runId}:`, err))
  }, STOP_POLL_MS)
  timer.unref()
  return { signal: controller.signal, dispose: () => clearInterval(timer) }
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
  return settleRunsWhere(
    and(
      runId ? eq(runsTable.id, runId) : undefined,
      inArray(runsTable.status, IN_PROGRESS),
      lt(runsTable.updatedAt, sql`now() - ${STALE_AFTER}`)
    )!,
    'failed',
    INTERRUPTED
  )
}
