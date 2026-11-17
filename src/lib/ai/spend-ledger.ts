import {
  accountsTable,
  aiUsageTable,
  authUsersTable,
  runsTable
} from '@/db/schema'
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  AI_SPEND_SOURCES,
  SPEND_LIMIT_WINDOW_DAYS,
  type AiSpendSource
} from './spend-sources'
import type { CallUsage } from './usage'

/**
 * The usage ledger (ai_usage), written against a database passed in so tests
 * can run it on their own connection. spend.ts binds it to the app's and
 * decides who each call is charged to.
 */
type LedgerDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

/** Who a call is charged to, and what it was for. */
export interface SpendCharge {
  source: AiSpendSource
  /** The user who owns the work; the spending limit is theirs. */
  userId: string | null
  /** The identity the work was for, when there is one. */
  accountId: string | null
  runId: string | null
}

/** The user who owns an identity: null for one made before sign-in existed, or one deleted. */
export async function accountOwnerIn(
  database: LedgerDb,
  accountId: string
): Promise<string | null> {
  const [row] = await database
    .select({ userId: accountsTable.userId })
    .from(accountsTable)
    .where(eq(accountsTable.id, accountId))
    .limit(1)
  return row?.userId ?? null
}

const count = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0

/**
 * The id when its row still exists, else null, read by the insert itself: a
 * run or identity deleted while its call was under way would otherwise make
 * the foreign key refuse the row, and the spend would go unrecorded.
 */
function ifStillThere(
  table: typeof authUsersTable | typeof accountsTable | typeof runsTable,
  id: string | null
): SQL | null {
  return id
    ? sql`(select ${table.id} from ${table} where ${table.id} = ${id})`
    : null
}

/**
 * One billed call into the ledger. False when there was nothing to record.
 * A run, identity or user deleted while the call was under way is left out
 * of the row; the rest of it is kept.
 */
export async function recordUsageIn(
  database: LedgerDb,
  charge: SpendCharge,
  call: { stage: string; modelId: string; usage: CallUsage }
): Promise<boolean> {
  const { usage } = call
  if (usage.calls === 0) return false
  await database.insert(aiUsageTable).values({
    userId: ifStillThere(authUsersTable, charge.userId),
    accountId: ifStillThere(accountsTable, charge.accountId),
    runId: ifStillThere(runsTable, charge.runId),
    source: charge.source,
    stage: call.stage.slice(0, 30),
    model: call.modelId.slice(0, 100),
    calls: count(usage.calls),
    inputTokens: count(usage.inputTokens),
    outputTokens: count(usage.outputTokens),
    cacheReadTokens: count(usage.cacheReadTokens),
    cacheWriteTokens: count(usage.cacheWriteTokens),
    reasoningTokens: count(usage.reasoningTokens),
    totalTokens: count(usage.totalTokens),
    costUsd: (Number.isFinite(usage.costUsd)
      ? Math.max(0, usage.costUsd)
      : 0
    ).toFixed(8),
    costEstimated: usage.estimatedCalls > 0
  })
  return true
}

const inWindow = sql`${aiUsageTable.createdAt} >= now() - make_interval(days => ${SPEND_LIMIT_WINDOW_DAYS})`

/** The rows a charge's limit counts: the user's, or an unowned identity's. */
function limitedBy(
  charge: Pick<SpendCharge, 'userId' | 'accountId'>
): SQL | null {
  if (charge.userId) return eq(aiUsageTable.userId, charge.userId)
  if (charge.accountId) {
    return and(
      eq(aiUsageTable.accountId, charge.accountId),
      isNull(aiUsageTable.userId)
    )!
  }
  return null
}

/**
 * What the limit has counted so far: the user's spend over the window, on
 * every identity they own; for an identity no user owns, its own. Null for a
 * charge with neither, which no limit covers. Measured on the database clock,
 * like the spend windows on the runs page.
 */
export async function spentInWindowIn(
  database: LedgerDb,
  charge: Pick<SpendCharge, 'userId' | 'accountId'>
): Promise<number | null> {
  const whose = limitedBy(charge)
  if (!whose) return null
  const [row] = await database
    .select({
      spent: sql<number>`coalesce(sum(${aiUsageTable.costUsd}), 0)`.mapWith(
        Number
      )
    })
    .from(aiUsageTable)
    .where(and(whose, inWindow))
  return row?.spent ?? 0
}

export interface LedgerTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  totalTokens: number
  costUsd: number
}

/**
 * All-time totals for one identity, overall and by what the spend was for
 * (sources with no calls are left out, the rest in AI_SPEND_SOURCES order).
 */
export async function accountUsageIn(
  database: LedgerDb,
  accountId: string
): Promise<{
  totals: LedgerTotals
  bySource: Array<{
    source: AiSpendSource
    totalTokens: number
    costUsd: number
  }>
}> {
  const sum = (column: AnyPgColumn) =>
    sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number)
  const rows = await database
    .select({
      source: aiUsageTable.source,
      calls: sum(aiUsageTable.calls),
      inputTokens: sum(aiUsageTable.inputTokens),
      outputTokens: sum(aiUsageTable.outputTokens),
      cacheReadTokens: sum(aiUsageTable.cacheReadTokens),
      totalTokens: sum(aiUsageTable.totalTokens),
      costUsd: sum(aiUsageTable.costUsd)
    })
    .from(aiUsageTable)
    .where(eq(aiUsageTable.accountId, accountId))
    .groupBy(aiUsageTable.source)

  const totals: LedgerTotals = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costUsd: 0
  }
  for (const row of rows) {
    for (const key of Object.keys(totals) as Array<keyof LedgerTotals>) {
      totals[key] += row[key]
    }
  }
  const bySource = AI_SPEND_SOURCES.flatMap(source => {
    const row = rows.find(r => r.source === source)
    return row && row.calls > 0
      ? [{ source, totalTokens: row.totalTokens, costUsd: row.costUsd }]
      : []
  })
  return { totals, bySource }
}
