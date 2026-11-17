import 'server-only'

import { db } from '@/db'
import { ideasTable, postDraftsTable, runsTable } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { env } from '~/env'
import {
  accountOwnerIn,
  accountUsageIn,
  spentInWindowIn
} from '@/lib/ai/spend-ledger'
import { SPEND_LIMIT_WINDOW_DAYS, type AiSpendSource } from '@/lib/ai/spend-sources'

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
  /** Billed model calls, embedding requests and images. */
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number
}

export interface AccountUsageSummary {
  totals: AccountUsageTotals
  /** What the spend was for, sources with no calls left out. */
  bySource: Array<{ source: AiSpendSource; totalTokens: number; costUsd: number }>
  runs: number
  ideas: number
  posts: number
  /**
   * The spending limit of the identity's owner: what they spent over the
   * window on every identity they own, against AI_SPEND_LIMIT_USD.
   */
  limit: { spentUsd: number; limitUsd: number; windowDays: number }
}

/**
 * All-time token and cost totals for one identity, from the usage ledger
 * (ai_usage): every paid call made for it, in runs or not (newsletters,
 * setup, post editing). Spend from before the ledger was copied in from the
 * runs' steps (migration 0053).
 */
export async function getAccountUsageSummary(
  accountId: string
): Promise<AccountUsageSummary> {
  const [usage, owner, [ideaRow], [postRow], [runRow]] = await Promise.all([
    accountUsageIn(db, accountId),
    accountOwnerIn(db, accountId),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(ideasTable)
      .where(eq(ideasTable.accountId, accountId)),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(postDraftsTable)
      .where(eq(postDraftsTable.accountId, accountId)),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(runsTable)
      .where(eq(runsTable.accountId, accountId))
  ])
  const spentUsd = (await spentInWindowIn(db, { userId: owner, accountId })) ?? 0

  return {
    totals: usage.totals,
    bySource: usage.bySource,
    runs: runRow?.n ?? 0,
    ideas: ideaRow?.n ?? 0,
    posts: postRow?.n ?? 0,
    limit: {
      spentUsd,
      limitUsd: env.AI_SPEND_LIMIT_USD,
      windowDays: SPEND_LIMIT_WINDOW_DAYS
    }
  }
}
