import { db } from '@/db'
import { runsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { executeResearchAndIdeate } from '~/lib/ai/pipeline/ideation-run'
import { claimNextQueuedRun } from './queue'

declare global {
   
  var __workerRunning: boolean | undefined
   
  var __workerInterval: NodeJS.Timeout | undefined
   
  var __workerBusy: boolean | undefined
}

const POLL_INTERVAL_MS = 3000

async function markFailed(runId: string, err: unknown) {
  const message =
    err instanceof Error ? err.message : 'Run execution failed unexpectedly'
  await db
    .update(runsTable)
    .set({ status: 'failed', error: message, updatedAt: new Date() })
    .where(eq(runsTable.id, runId))
}

/**
 * Runs a specific run now, for "Generate now".
 *
 * The status guard means this only proceeds if the row is still queued, so it
 * cannot race the polling worker into executing the same run twice.
 */
export async function processRunImmediately(runId: string) {
  const [claimed] = await db
    .update(runsTable)
    .set({ status: 'running', currentStep: 1, updatedAt: new Date() })
    .where(eq(runsTable.id, runId))
    .returning()

  if (!claimed) return null

  try {
    return await executeResearchAndIdeate(runId)
  } catch (err) {
    console.error(`Error processing run ${runId}:`, err)
    await markFailed(runId, err)
    throw err
  }
}

async function workerTick() {
  // A run takes minutes; without this the 3s timer stacks overlapping ticks and
  // each one claims another run.
  if (globalThis.__workerBusy) return
  globalThis.__workerBusy = true

  try {
    const claimed = await claimNextQueuedRun()
    if (!claimed) return
    try {
      await executeResearchAndIdeate(claimed.id)
    } catch (err) {
      console.error(`Worker failed run ${claimed.id}:`, err)
      await markFailed(claimed.id, err)
    }
  } catch (err) {
    console.error('Worker tick error:', err)
  } finally {
    globalThis.__workerBusy = false
  }
}

export function startWorker() {
  if (globalThis.__workerRunning) return
  globalThis.__workerRunning = true
  globalThis.__workerBusy = false

  void workerTick()
  globalThis.__workerInterval = setInterval(() => void workerTick(), POLL_INTERVAL_MS)
}
