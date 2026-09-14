import { db } from '@/db'
import {
  runsTable,
  runStepsTable,
  researchFindingsTable,
  ideasTable,
  goalsTable,
  preferencesTable,
  accountsTable
} from '@/db/schema'
import { eq, desc } from 'drizzle-orm'

export interface EnqueueRunOptions {
  accountId: string
  goalId?: string | null
  trigger?: 'manual' | 'schedule'
}

export async function enqueueRun(opts: EnqueueRunOptions) {
  const [account, preference, defaultGoal] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, opts.accountId) }),
    db.query.preferencesTable.findFirst({ where: eq(preferencesTable.accountId, opts.accountId) }),
    opts.goalId
      ? db.query.goalsTable.findFirst({ where: eq(goalsTable.id, opts.goalId) })
      : db.query.goalsTable.findFirst({ where: eq(goalsTable.accountId, opts.accountId) })
  ])

  if (!account) {
    throw new Error(`Account ${opts.accountId} not found`)
  }

  const prefConfig = (preference?.pillars as any) || {}

  const [newRun] = await db
    .insert(runsTable)
    .values({
      accountId: opts.accountId,
      goalId: defaultGoal?.id || null,
      preferenceSetId: preference?.id || null,
      workflow: 'standard',
      trigger: opts.trigger || 'manual',
      status: 'queued',
      currentStep: 0,
      totalSteps: 3,
      researchConfig: prefConfig.research_policy || {},
      mediaConfig: prefConfig.media_policy || {},
      timings: {},
      tokenCounts: {},
      costUsd: '0',
      logs: [
        {
          step: 'queued',
          status: 'pending',
          timestamp: new Date().toISOString(),
          message: 'Run placed in execution queue'
        }
      ]
    })
    .returning()

  return newRun
}

export async function claimNextQueuedRun() {
  const nextQueued = await db.query.runsTable.findFirst({
    where: eq(runsTable.status, 'queued'),
    orderBy: [desc(runsTable.createdAt)]
  })

  if (!nextQueued) return null

  // Atomically claim
  const [claimed] = await db
    .update(runsTable)
    .set({
      status: 'running',
      currentStep: 1,
      updatedAt: new Date()
    })
    .where(eq(runsTable.id, nextQueued.id))
    .returning()

  return claimed
}

export async function getRunDetails(runId: string) {
  const [run, steps, findings, ideas] = await Promise.all([
    db.query.runsTable.findFirst({ where: eq(runsTable.id, runId) }),
    db.query.runStepsTable.findMany({
      where: eq(runStepsTable.runId, runId),
      orderBy: [desc(runStepsTable.createdAt)]
    }),
    db.query.researchFindingsTable.findMany({
      where: eq(researchFindingsTable.runId, runId)
    }),
    db.query.ideasTable.findMany({
      where: eq(ideasTable.runId, runId)
    })
  ])

  return { run, steps, findings, ideas }
}
