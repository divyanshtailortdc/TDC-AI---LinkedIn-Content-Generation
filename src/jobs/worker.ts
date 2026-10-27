import { executeResearchAndIdeate } from '~/lib/ai/pipeline/ideation-run'
import { recoverInterruptedRuns } from '~/lib/ai/run-lifecycle'
import { recoverAbandonedDrafting } from './drafting-queue'
import { claimNextQueuedRun, claimRunById } from './queue'

declare global {
   
  var __workerRunning: boolean | undefined
   
  var __workerInterval: NodeJS.Timeout | undefined
   
  var __activeRuns: number | undefined

  var __recoveryInterval: NodeJS.Timeout | undefined
}

const POLL_INTERVAL_MS = 3000

/**
 * Runs executed at once, whether "Generate now" or the poll started them: each
 * holds model calls and research for minutes on one vCPU. A run over the limit
 * stays queued, and the poll starts it once a slot frees.
 */
const MAX_CONCURRENT_RUNS = 2

/** Its own timer: the poll tick does nothing while every run slot is taken. */
const RECOVERY_INTERVAL_MS = 60_000

/**
 * Takes a run slot, or returns false when all are taken. Callers take it
 * before awaiting their claim, so two of them cannot both get the last one.
 */
function takeRunSlot() {
  const active = globalThis.__activeRuns ?? 0
  if (active >= MAX_CONCURRENT_RUNS) return false
  globalThis.__activeRuns = active + 1
  return true
}

function releaseRunSlot() {
  globalThis.__activeRuns = Math.max(0, (globalThis.__activeRuns ?? 0) - 1)
}

/**
 * Runs a specific run now, for "Generate now", if a run slot is free;
 * otherwise it stays queued for the poll.
 *
 * The status guard means this only proceeds if the row is still queued, so it
 * cannot race the polling worker into executing the same run twice. A failure
 * is already recorded on the run by the time it is thrown here.
 */
export async function processRunImmediately(runId: string) {
  if (!takeRunSlot()) return null
  try {
    const claimed = await claimRunById(runId)
    if (!claimed) return null
    return await executeResearchAndIdeate(runId)
  } finally {
    releaseRunSlot()
  }
}

/**
 * Starts queued runs, oldest first, until the slots are full or the queue is
 * empty, and resolves once the runs it started have finished: for a caller
 * that must stay alive until then (/api/cron/jobs on Vercel).
 */
export async function processQueuedRuns() {
  const started: Promise<unknown>[] = []
  while (takeRunSlot()) {
    let claimed
    try {
      claimed = await claimNextQueuedRun()
    } catch (err) {
      releaseRunSlot()
      throw err
    }
    if (!claimed) {
      releaseRunSlot()
      break
    }
    const runId = claimed.id
    started.push(
      executeResearchAndIdeate(runId)
        .catch(err => console.error(`Worker failed run ${runId}:`, err))
        .finally(releaseRunSlot)
    )
  }
  await Promise.all(started)
}

/**
 * The poll. It does not wait for the runs it starts, so a free slot is filled
 * on the next tick however long the other runs take.
 */
function workerTick() {
  void processQueuedRuns().catch(err => console.error('Worker tick error:', err))
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
  // Not awaited: it resolves when the resumed ideas are drafted.
  recoverAbandonedDrafting().catch(err =>
    console.error('Drafting recovery error:', err)
  )
}

export function startWorker() {
  if (globalThis.__workerRunning) return
  globalThis.__workerRunning = true

  void workerTick()
  globalThis.__workerInterval = setInterval(() => void workerTick(), POLL_INTERVAL_MS)

  void recoveryTick()
  globalThis.__recoveryInterval = setInterval(() => void recoveryTick(), RECOVERY_INTERVAL_MS)
}
