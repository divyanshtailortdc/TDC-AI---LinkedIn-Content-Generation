import { db } from '@/db'
import {
  accountsTable,
  goalsTable,
  ideasTable,
  preferencesTable,
  researchFindingsTable,
  runsTable,
  runStepsTable
} from '@/db/schema'
import { ideaGoalTitles, RESEARCH_SETTINGS } from '@/lib/ai/context'
import { defaultModel } from '@/lib/models'
import { and, asc, desc, eq } from 'drizzle-orm'
import { checkRunGoals } from './run-goals'
import { insertRunUnlessActive } from './run-guard'

export interface EnqueueRunOptions {
  accountId: string
  /**
   * The goals the run serves, in the order picked. Every one must be this
   * identity's and active. Scheduled runs pass the active goals.
   */
  goalIds: string[]
  trigger?: 'manual' | 'schedule'
}

/**
 * Queues a run for the account serving the given goals. Refused with
 * RunInProgressError while the identity has a run queued or in progress: two
 * runs at once research the same ground and return near-identical ideas.
 */
export async function enqueueRun(opts: EnqueueRunOptions) {
  const [account, preference, goals] = await Promise.all([
    db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, opts.accountId)
    }),
    db.query.preferencesTable.findFirst({
      where: eq(preferencesTable.accountId, opts.accountId)
    }),
    // Only this identity's goals: a goal id from elsewhere must not steer its run.
    db
      .select({
        id: goalsTable.id,
        title: goalsTable.title,
        isActive: goalsTable.isActive
      })
      .from(goalsTable)
      .where(eq(goalsTable.accountId, opts.accountId))
  ])

  if (!account) {
    throw new Error(`Account ${opts.accountId} not found`)
  }
  const goalIds = checkRunGoals(opts.goalIds, goals)

  // Freeze the research settings that produced this run so "why did it write
  // that?" stays answerable if they change later.
  const researchConfig = { ...RESEARCH_SETTINGS }

  const run = await insertRunUnlessActive(db, {
    accountId: opts.accountId,
    goalId: goalIds[0]!,
    goalIds,
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
  return { run }
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

  // Goals as titled now; a deleted one by the title its ideas kept.
  const goals = run
    ? await db
        .select({ id: goalsTable.id, title: goalsTable.title })
        .from(goalsTable)
        .where(eq(goalsTable.accountId, run.accountId))
    : []
  const titleOf = (id: string | null | undefined) =>
    goals.find(g => g.id === id)?.title
  const runGoalIds =
    run?.goalIds && run.goalIds.length > 0
      ? run.goalIds
      : run?.goalId
        ? [run.goalId]
        : []

  return {
    run: run
      ? {
          ...run,
          goalTitles: runGoalIds
            .map(titleOf)
            .filter((t): t is string => Boolean(t))
        }
      : run,
    steps,
    findings,
    ideas: ideas.map(idea => ({
      ...idea,
      goalTitles: ideaGoalTitles(idea, goals)
    }))
  }
}
