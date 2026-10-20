import 'server-only'

import { db } from '@/db'
import { runsTable } from '@/db/schema'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { count, desc, eq, sql } from 'drizzle-orm'

/**
 * The name the identity had when the run started. The identity can be renamed
 * afterwards, and old runs must keep the name they ran under. Needs `runs` in
 * the query's FROM clause.
 */
export const accountNameAtRunSql = sql<string | null>`(
  select s.response_json->>'account'
  from run_steps s
  where s.run_id = runs.id and s.stage = 'gathering_context'
  order by s.started_at
  limit 1
)`

/** One page of an account's runs, newest first, for the Runs lists. */
export function loadRunsPage(accountId: string, page: number) {
  const ofAccount = eq(runsTable.accountId, accountId)
  return loadPage({
    page,
    pageSize: PAGE_SIZE,
    count: async () => {
      const [row] = await db.select({ n: count() }).from(runsTable).where(ofAccount)
      return row?.n ?? 0
    },
    rows: (offset, limit) =>
      db
        .select({
          id: runsTable.id,
          accountId: runsTable.accountId,
          workflow: runsTable.workflow,
          trigger: runsTable.trigger,
          status: runsTable.status,
          currentStep: runsTable.currentStep,
          totalSteps: runsTable.totalSteps,
          costUsd: runsTable.costUsd,
          tokenCounts: runsTable.tokenCounts,
          error: runsTable.error,
          createdAt: runsTable.createdAt,
          accountNameAtRun: accountNameAtRunSql
        })
        .from(runsTable)
        .where(ofAccount)
        .orderBy(desc(runsTable.createdAt), desc(runsTable.id))
        .offset(offset)
        .limit(limit)
  })
}
