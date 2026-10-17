import { db } from '@/db'
import { runStepsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { recordReviewMediaSpendIn, refreshRunTotalsIn } from './review-spend'
import type { CallUsage } from './usage'

export { stepUsage } from './review-spend'

/** Recomputes a run's totals from its steps; see refreshRunTotalsIn. */
export function refreshRunTotals(runId: string): Promise<CallUsage> {
  return refreshRunTotalsIn(db, runId)
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

/**
 * Records what an image generated while reviewing a post cost, against the run
 * that wrote the post, so it reaches the run's totals and the spend summaries.
 * Without this the spend sat only in the image's own metadata, or nowhere: the
 * run's cost covered the images written with the draft and none made later.
 *
 * Failed and cancelled attempts count too; they are billed. Never throws:
 * losing a line of accounting must not fail the reviewer's action.
 */
export async function recordReviewMediaSpend(
  draftId: string,
  usage: CallUsage | undefined,
  details: { summary: string; error?: string | null }
) {
  try {
    await recordReviewMediaSpendIn(db, draftId, usage, details)
  } catch (err) {
    console.error(`Could not record media spend for draft ${draftId}:`, err)
  }
}
