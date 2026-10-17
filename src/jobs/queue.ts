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
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { RESEARCH_SETTINGS } from '@/lib/ai/context'
import { defaultModel } from '@/lib/models'
import { insertRunUnlessActive } from './run-guard'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'

export interface EnqueueRunOptions {
  accountId: string
  goalId?: string | null
  trigger?: 'manual' | 'schedule'
}

/**
 * Queues a run for the account, or returns the run it already has in progress
 * (`created: false`). Two runs at once for one identity research the same
 * ground and return near-identical ideas, so a second Launch (another tab, a
 * double click, a scheduled tick) joins the first instead.
 */
export async function enqueueRun(opts: EnqueueRunOptions) {
  const [account, preference, defaultGoal] = await Promise.all([
    db.query.accountsTable.findFirst({ where: eq(accountsTable.id, opts.accountId) }),
    db.query.preferencesTable.findFirst({ where: eq(preferencesTable.accountId, opts.accountId) }),
    opts.goalId
      ? db.query.goalsTable.findFirst({ where: eq(goalsTable.id, opts.goalId) })
      : // Newest active goal, so a paused goal never steers a run.
        db.query.goalsTable.findFirst({
          where: and(
            eq(goalsTable.accountId, opts.accountId),
            eq(goalsTable.isActive, true)
          ),
          orderBy: desc(goalsTable.createdAt)
        })
  ])

  if (!account) {
    throw new Error(`Account ${opts.accountId} not found`)
  }
  if (!account.isActive) {
    throw new Error(`Account ${opts.accountId} is deactivated`)
  }

  // Freeze the research settings that produced this run so "why did it write
  // that?" stays answerable if they change later.
  const researchConfig = { ...RESEARCH_SETTINGS }

  // Refused while this identity has a run queued or in progress.
  const newRun = await insertRunUnlessActive(db, {
    accountId: opts.accountId,
    goalId: defaultGoal?.id || null,
    preferenceSetId: preference?.id || null,
    workflow: 'standard',
    // Recorded up front: the database default is a leftover placeholder.
    model: defaultModel,
    trigger: opts.trigger || 'manual',
    status: 'queued',
    currentStep: 0,
    totalSteps: 3,
    researchConfig,
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
  return db.transaction(async tx => {
    // Serialises enqueues for this account until commit, so concurrent calls
    // cannot all pass the check below. The partial unique index on runs is
    // the backstop.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${opts.accountId}::text))`)

    const activeRun = await tx.query.runsTable.findFirst({
      where: and(
        eq(runsTable.accountId, opts.accountId),
        inArray(runsTable.status, ACTIVE_RUN_STATUSES)
      ),
      orderBy: [asc(runsTable.createdAt)]
    })
    if (activeRun) return { run: activeRun, created: false }

    const [newRun] = await tx
      .insert(runsTable)
      .values({
        accountId: opts.accountId,
        goalId: defaultGoal?.id || null,
        preferenceSetId: preference?.id || null,
        workflow: 'standard',
        // Recorded up front: the database default is a leftover placeholder.
        model: defaultModel,
        trigger: opts.trigger || 'manual',
        status: 'queued',
        currentStep: 0,
        totalSteps: 3,
        researchConfig,
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

    return { run: newRun, created: true }
  })
}

/**
 * Claims the oldest queued run, or returns null if there is none.
 *
 * Two details matter here. The queue is FIFO (`asc`) — ordering by `desc` meant
 * a busy queue starved its oldest runs. And the UPDATE re-checks `status`, so
 * if another worker claimed the row between the SELECT and the UPDATE this
 * returns nothing instead of running the same job twice.
 */
export async function claimNextQueuedRun() {
  const nextQueued = await db.query.runsTable.findFirst({
    where: eq(runsTable.status, 'queued'),
    orderBy: [asc(runsTable.createdAt)]
  })

  if (!nextQueued) return null

  return claimRunById(nextQueued.id)
}

/**
 * Moves one specific run from queued to running, or returns null if it is no
 * longer queued. The status check is what makes this safe to call from both
 * the polling worker and "Generate now": whichever UPDATE lands second finds
 * the run already running (or finished) and gets nothing back.
 */
export async function claimRunById(runId: string) {
  const [claimed] = await db
    .update(runsTable)
    .set({
      status: 'running',
      currentStep: 1,
      updatedAt: new Date()
    })
    .where(and(eq(runsTable.id, runId), eq(runsTable.status, 'queued')))
    .returning()

  return claimed ?? null
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
