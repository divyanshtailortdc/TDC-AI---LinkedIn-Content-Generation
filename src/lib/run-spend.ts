import 'server-only'

import { db } from '@/db'
import { runsTable } from '@/db/schema'
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
