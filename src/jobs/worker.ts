import { claimNextQueuedRun } from './queue'
import { executeResearchAndIdeate } from '~/lib/ai/research-ideate'
import { db } from '@/db'
import { runsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'

declare global {
  // eslint-disable-next-line no-var
  var __workerRunning: boolean | undefined
  // eslint-disable-next-line no-var
  var __workerInterval: NodeJS.Timeout | undefined
}

export async function processRunImmediately(runId: string) {
  try {
    await db
      .update(runsTable)
      .set({ status: 'running', currentStep: 1, updatedAt: new Date() })
      .where(eq(runsTable.id, runId))

    return await executeResearchAndIdeate(runId)
  } catch (err: any) {
    console.error(`Error processing run ${runId}:`, err)
    await db
      .update(runsTable)
      .set({ status: 'failed', error: err.message || 'Run execution failed' })
      .where(eq(runsTable.id, runId))
    throw err
  }
}

async function workerTick() {
  try {
    const claimed = await claimNextQueuedRun()
    if (claimed) {
      await executeResearchAndIdeate(claimed.id)
    }
  } catch (err) {
    console.error('Worker tick error:', err)
  }
}

export function startWorker() {
  if (globalThis.__workerRunning) {
    return
  }

  globalThis.__workerRunning = true

  // Run initial tick
  workerTick()

  // Poll every 3 seconds for queued jobs
  globalThis.__workerInterval = setInterval(workerTick, 3000)
}
