import { executeResearchAndIdeate } from '~/lib/ai/pipeline/ideation-run'
import { recoverInterruptedRuns } from '~/lib/ai/run-lifecycle'
import { claimNextQueuedRun, claimRunById } from './queue'

declare global {
   
  var __workerRunning: boolean | undefined
   
  var __workerInterval: NodeJS.Timeout | undefined
   
  var __workerBusy: boolean | undefined

  var __recoveryInterval: NodeJS.Timeout | undefined
}

const POLL_INTERVAL_MS = 3000

/** Its own timer: the poll tick is skipped for the minutes a run takes. */
const RECOVERY_INTERVAL_MS = 60_000

/**
 * Runs a specific run now, for "Generate now".
 *
 * The status guard means this only proceeds if the row is still queued, so it
 * cannot race the polling worker into executing the same run twice. A failure
 * is already recorded on the run by the time it is thrown here.
 */
export async function processRunImmediately(runId: string) {
  const claimed = await claimRunById(runId)

  if (!claimed) return null

  return executeResearchAndIdeate(runId)
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
    }
  } catch (err) {
    console.error('Worker tick error:', err)
  } finally {
    globalThis.__workerBusy = false
  }
}

/** Fails runs whose process died mid-run; see run-lifecycle. */
async function recoveryTick() {
  try {
    const recovered = await recoverInterruptedRuns()
    if (recovered.length > 0) {
      console.warn(`Marked interrupted runs as failed: ${recovered.join(', ')}`)
    }
  } catch (err) {
    console.error('Run recovery error:', err)
  }
}

export function startWorker() {
  if (globalThis.__workerRunning) return
  globalThis.__workerRunning = true
  globalThis.__workerBusy = false

  void workerTick()
  globalThis.__workerInterval = setInterval(() => void workerTick(), POLL_INTERVAL_MS)

  void recoveryTick()
  globalThis.__recoveryInterval = setInterval(() => void recoveryTick(), RECOVERY_INTERVAL_MS)
}
