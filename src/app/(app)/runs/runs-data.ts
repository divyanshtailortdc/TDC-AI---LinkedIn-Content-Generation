import 'server-only'

import { db } from '@/db'
import { runsTable } from '@/db/schema'
import { loadPage, PAGE_SIZE } from '@/lib/pagination'
import { count, desc, eq } from 'drizzle-orm'

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
          createdAt: runsTable.createdAt
        })
        .from(runsTable)
        .where(ofAccount)
        .orderBy(desc(runsTable.createdAt), desc(runsTable.id))
        .offset(offset)
        .limit(limit)
  })
}
