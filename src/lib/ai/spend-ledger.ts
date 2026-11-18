import {
  accountsTable,
  aiUsageTable,
  authUsersTable,
  runsTable
} from '@/db/schema'
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  AI_SPEND_SOURCES,
  DAILY_LIMIT_WINDOW_HOURS,
  INBOX_SHARE_OF_USER_LIMITS,
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
const inDay = sql`${aiUsageTable.createdAt} >= now() - make_interval(hours => ${DAILY_LIMIT_WINDOW_HOURS})`

/** The rows a charge's user limits count: the user's, or an unowned identity's. */
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

/** What the spending limits have counted so far, in US dollars. */
export interface SpendCounters {
  /**
   * The user's spend over the last 30 days, on every identity they own; for
   * an identity no user owns, its own.
   */
  windowUsd: number
  /** The same over the last 24 hours. */
  dayUsd: number
  /**
   * What the identity's inbox (source 'inbox') spent over the last 24 hours;
   * null for work with no identity.
   */
  inboxDayUsd: number | null
}

/**
 * The counters a charge's limits read, in one query. Null for a charge with
 * neither a user nor an identity, which no limit covers. Measured on the
 * database clock, like the spend windows on the runs page.
 */
export async function spendCountersIn(
  database: LedgerDb,
  charge: Pick<SpendCharge, 'userId' | 'accountId'>
): Promise<SpendCounters | null> {
  const whose = limitedBy(charge)
  if (!whose) return null
  const inbox = charge.accountId
    ? and(
        eq(aiUsageTable.accountId, charge.accountId),
        eq(aiUsageTable.source, 'inbox')
      )!
    : null
  const sumWhere = (filter: SQL) =>
    sql<number>`coalesce(sum(${aiUsageTable.costUsd}) filter (where ${filter}), 0)`.mapWith(
      Number
    )
  const [row] = await database
    .select({
      windowUsd: sumWhere(whose),
      dayUsd: sumWhere(and(whose, inDay)!),
      inboxDayUsd: sumWhere(inbox ? and(inbox, inDay)! : sql`false`)
    })
    .from(aiUsageTable)
    .where(and(inbox ? or(whose, inbox) : whose, inWindow))
  return {
    windowUsd: row?.windowUsd ?? 0,
    dayUsd: row?.dayUsd ?? 0,
    inboxDayUsd: inbox ? (row?.inboxDayUsd ?? 0) : null
  }
}

/** The spending limits, in US dollars (AI_*_USD in src/env.ts). */
export interface SpendLimits {
  /** Per user, over any 30 days. */
  windowUsd: number
  /** Per user, over any 24 hours. */
  dayUsd: number
  /** Per identity, for its inbox only, over any 24 hours. */
  inboxDayUsd: number
}

export type SpendLimitKind = 'window' | 'day' | 'inbox_day'

/** A limit that refuses the next call. */
export interface ReachedSpendLimit {
  kind: SpendLimitKind
  spentUsd: number
  /** The limit as configured. */
  limitUsd: number
  /**
   * What this work may spend up to: the limit, or for inbox work the share
   * of the user's limits it may use (INBOX_SHARE_OF_USER_LIMITS).
   */
  capUsd: number
}

/**
 * The first limit that refuses a call of this source, longest-lasting first,
 * or null when none does. Inbox work stops at a share of the user's limits
 * and also at its identity's own daily limit; everything else at the full
 * user limits.
 */
export function reachedSpendLimit(
  source: AiSpendSource,
  counters: SpendCounters,
  limits: SpendLimits
): ReachedSpendLimit | null {
  const share = source === 'inbox' ? INBOX_SHARE_OF_USER_LIMITS : 1
  const checks: ReachedSpendLimit[] = [
    {
      kind: 'window',
      spentUsd: counters.windowUsd,
      limitUsd: limits.windowUsd,
      capUsd: limits.windowUsd * share
    },
    {
      kind: 'day',
      spentUsd: counters.dayUsd,
      limitUsd: limits.dayUsd,
      capUsd: limits.dayUsd * share
    }
  ]
  if (source === 'inbox' && counters.inboxDayUsd !== null) {
    checks.push({
      kind: 'inbox_day',
      spentUsd: counters.inboxDayUsd,
      limitUsd: limits.inboxDayUsd,
      capUsd: limits.inboxDayUsd
    })
  }
  return checks.find(check => check.spentUsd >= check.capUsd) ?? null
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
