import {
  ideasTable,
  postDraftsTable,
  runStepsTable,
  runsTable
} from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { addUsage, type CallUsage } from './usage'

/**
 * Run spend, written against a database passed in so it can run on any
 * connection. run-accounting.ts binds these to the app's own.
 */
type SpendDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/** The usage block every paid step stores under `responseJson.usage`. */
export function stepUsage(responseJson: unknown): CallUsage | null {
  const usage = (responseJson as { usage?: CallUsage } | null | undefined)?.usage
  return usage && typeof usage === 'object' ? usage : null
}

/**
 * Recomputes a run's totals from its steps. Summing the step rows makes the
 * steps the single source of truth, and sums unrounded per-call costs rather
 * than the 4-decimal column values. Only each step's usage block is read: the
 * rest of its JSON (ideas, drafts, findings) stays in the database.
 */
export async function refreshRunTotalsIn(
  database: SpendDb,
  runId: string
): Promise<CallUsage> {
  const steps = await database
    .select({ usage: sql<unknown>`${runStepsTable.responseJson} -> 'usage'` })
    .from(runStepsTable)
    .where(eq(runStepsTable.runId, runId))

  const total = addUsage(...steps.map(s => stepUsage({ usage: s.usage })))

  await database
    .update(runsTable)
    .set({
      tokenCounts: total,
      costUsd: total.costUsd.toFixed(4),
      updatedAt: new Date()
    })
    .where(eq(runsTable.id, runId))

  return total
}

/**
 * Charges an image made while reviewing a post to the run that wrote the post:
 * a media step with the spend, then the run's totals brought up to date.
 * Returns false when there was nothing to record or no run to charge.
 */
export async function recordReviewMediaSpendIn(
  database: SpendDb,
  draftId: string,
  usage: CallUsage | undefined,
  details: { summary: string; error?: string | null }
): Promise<boolean> {
  if (!usage || usage.calls === 0) return false

  const [owner] = await database
    .select({ runId: ideasTable.runId })
    .from(postDraftsTable)
    .innerJoin(ideasTable, eq(ideasTable.id, postDraftsTable.ideaId))
    .where(eq(postDraftsTable.id, draftId))
    .limit(1)
  // A post whose run is gone has no run to charge.
  if (!owner?.runId) return false

  const now = new Date()
  await database.insert(runStepsTable).values({
    runId: owner.runId,
    stage: 'media',
    status: details.error ? 'failed' : 'completed',
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    requestSummary: details.summary,
    error: details.error ?? null,
    tokens: usage.totalTokens,
    costUsd: usage.costUsd.toFixed(4),
    responseJson: { phase: 'review', draftId, usage }
  })
  await refreshRunTotalsIn(database, owner.runId)
  return true
}
