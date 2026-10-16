import { db } from '@/db'
import { runStepsTable, runsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { addUsage, type CallUsage } from './usage'

/** The usage block every paid step stores under `responseJson.usage`. */
export function stepUsage(responseJson: unknown): CallUsage | null {
  const usage = (responseJson as { usage?: CallUsage } | null | undefined)?.usage
  return usage && typeof usage === 'object' ? usage : null
}

/**
 * Recomputes a run's totals from its steps.
 *
 * Stages used to add their own numbers onto `runs.tokenCounts` with a
 * read-modify-write, so two draft actions finishing together could each read
 * the old total and one of them would be lost. Summing the step rows makes the
 * steps the single source of truth, and sums unrounded per-call costs rather
 * than the 4-decimal column values.
 */
export async function refreshRunTotals(runId: string): Promise<CallUsage> {
  const steps = await db
    .select({ responseJson: runStepsTable.responseJson })
    .from(runStepsTable)
    .where(eq(runStepsTable.runId, runId))

  const total = addUsage(...steps.map(s => stepUsage(s.responseJson)))

  await db
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
 * Saves an open step's spend the moment it is billed, along with the run's
 * totals. Waiting for the step to close lost the spend whenever the stage
 * failed, or the process died, between the model call and the close.
 */
export async function recordStepUsage(
  runId: string,
  stepId: string,
  usage: CallUsage
) {
  if (usage.calls === 0) return
  await db
    .update(runStepsTable)
    .set({
      tokens: usage.totalTokens,
      costUsd: usage.costUsd.toFixed(4),
      responseJson: { usage }
    })
    .where(eq(runStepsTable.id, stepId))
  await refreshRunTotals(runId)
}
