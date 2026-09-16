import 'server-only'

import { db } from '@/db'
import { ideasTable, postDraftsTable, runStepsTable, runsTable } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'

export interface SpendWindow {
  runs: number
  costUsd: number
  outputTokens: number
}

export interface RunSpendSummary {
  week: SpendWindow
  month: SpendWindow
  averageRunCostUsd: number
  pricedRuns: number
}

/**
 * Spend windows for one account, computed in Postgres.
 *
 * The windows are relative to the database clock rather than `Date.now()` in a
 * component, which would be impure during render and could disagree between
 * the server and client about which runs fall inside "last 7 days".
 */
export async function getRunSpendSummary(
  accountId: string
): Promise<RunSpendSummary> {
  const cost = sql`coalesce(${runsTable.costUsd}, 0)`
  const output = sql`coalesce((${runsTable.tokenCounts}->>'outputTokens')::numeric, 0)`
  const inDays = (days: number) =>
    sql`${runsTable.createdAt} >= now() - make_interval(days => ${days})`

  const [row] = await db
    .select({
      weekRuns: sql<number>`count(*) filter (where ${inDays(7)})`.mapWith(Number),
      weekCost: sql<number>`coalesce(sum(${cost}) filter (where ${inDays(7)}), 0)`.mapWith(Number),
      weekOutput: sql<number>`coalesce(sum(${output}) filter (where ${inDays(7)}), 0)`.mapWith(Number),
      monthRuns: sql<number>`count(*) filter (where ${inDays(30)})`.mapWith(Number),
      monthCost: sql<number>`coalesce(sum(${cost}) filter (where ${inDays(30)}), 0)`.mapWith(Number),
      monthOutput: sql<number>`coalesce(sum(${output}) filter (where ${inDays(30)}), 0)`.mapWith(Number),
      pricedRuns: sql<number>`count(*) filter (where ${cost} > 0)`.mapWith(Number),
      pricedCost: sql<number>`coalesce(sum(${cost}) filter (where ${cost} > 0), 0)`.mapWith(Number)
    })
    .from(runsTable)
    .where(eq(runsTable.accountId, accountId))

  const r = row ?? {
    weekRuns: 0, weekCost: 0, weekOutput: 0,
    monthRuns: 0, monthCost: 0, monthOutput: 0,
    pricedRuns: 0, pricedCost: 0
  }

  return {
    week: { runs: r.weekRuns, costUsd: r.weekCost, outputTokens: r.weekOutput },
    month: { runs: r.monthRuns, costUsd: r.monthCost, outputTokens: r.monthOutput },
    averageRunCostUsd: r.pricedRuns > 0 ? r.pricedCost / r.pricedRuns : 0,
    pricedRuns: r.pricedRuns
  }
}

export interface AccountUsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number
}

export interface AccountUsageSummary {
  totals: AccountUsageTotals
  /** Stages that actually recorded token usage, by stage name. */
  byStage: Array<{ stage: string; totalTokens: number; costUsd: number }>
  runs: number
  ideas: number
  posts: number
}

/** Stage keys that consume tokens, in pipeline order. */
const BILLED_STAGES = ['generating_ideas', 'drafting']

/**
 * All-time token and cost totals for one account.
 *
 * `runs.tokenCounts` is the authoritative record: it carries the full
 * input/output/cache breakdown accumulated across every model call in the
 * run, including calls whose per-step row recorded no tokens of its own
 * (the linting revision pass writes its usage to the run, not the step).
 * The per-stage figures come from `run_steps` purely to show where the
 * spend went; they are not used for the totals.
 */
export async function getAccountUsageSummary(
  accountId: string
): Promise<AccountUsageSummary> {
  const tokenCount = (field: string) =>
    sql`coalesce((${runsTable.tokenCounts}->>${field})::numeric, 0)`

  const [[totals], stageRows, [ideaRow], [postRow]] = await Promise.all([
    db
      .select({
        runs: sql<number>`count(*)`.mapWith(Number),
        inputTokens: sql<number>`coalesce(sum(${tokenCount('inputTokens')}), 0)`.mapWith(Number),
        outputTokens: sql<number>`coalesce(sum(${tokenCount('outputTokens')}), 0)`.mapWith(Number),
        cacheReadTokens: sql<number>`coalesce(sum(${tokenCount('cacheReadTokens')}), 0)`.mapWith(
          Number
        ),
        totalTokens: sql<number>`coalesce(sum(${tokenCount('totalTokens')}), 0)`.mapWith(Number),
        costUsd: sql<number>`coalesce(sum(coalesce(${runsTable.costUsd}, 0)), 0)`.mapWith(Number)
      })
      .from(runsTable)
      .where(eq(runsTable.accountId, accountId)),
    db
      .select({
        stage: runStepsTable.stage,
        totalTokens: sql<number>`coalesce(sum(coalesce(${runStepsTable.tokens}, 0)), 0)`.mapWith(
          Number
        ),
        costUsd: sql<number>`coalesce(sum(coalesce(${runStepsTable.costUsd}, 0)), 0)`.mapWith(
          Number
        )
      })
      .from(runStepsTable)
      .innerJoin(runsTable, eq(runStepsTable.runId, runsTable.id))
      .where(eq(runsTable.accountId, accountId))
      .groupBy(runStepsTable.stage),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(ideasTable)
      .where(eq(ideasTable.accountId, accountId)),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(postDraftsTable)
      .where(eq(postDraftsTable.accountId, accountId))
  ])

  const byStage = BILLED_STAGES.map((stage) => {
    const row = stageRows.find((r) => r.stage === stage)
    return {
      stage,
      totalTokens: row?.totalTokens ?? 0,
      costUsd: row?.costUsd ?? 0
    }
  }).filter((s) => s.totalTokens > 0 || s.costUsd > 0)

  return {
    totals: {
      inputTokens: totals?.inputTokens ?? 0,
      outputTokens: totals?.outputTokens ?? 0,
      cacheReadTokens: totals?.cacheReadTokens ?? 0,
      totalTokens: totals?.totalTokens ?? 0,
      costUsd: totals?.costUsd ?? 0
    },
    byStage,
    runs: totals?.runs ?? 0,
    ideas: ideaRow?.n ?? 0,
    posts: postRow?.n ?? 0
  }
}
