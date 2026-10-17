import 'server-only'

import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { PAGE_SIZE } from '@/lib/pagination'
import { desc, eq } from 'drizzle-orm'

/** The most runs a list will show, however far "Show older runs" is pressed. */
const MAX_SHOWN = PAGE_SIZE * 20

/**
 * How many runs to show, from the `?show=` param. The runs list re-renders from
 * server props while a run is moving, so the page size lives in the URL rather
 * than in client state, where each refresh would reset it.
 */
export function runsShownFromParam(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw)
  if (!Number.isFinite(value) || value <= PAGE_SIZE) return PAGE_SIZE
  return Math.min(Math.ceil(value / PAGE_SIZE) * PAGE_SIZE, MAX_SHOWN)
}

/** An account's newest runs, and whether older ones exist. */
export async function loadRunsList(accountId: string, shown: number) {
  const rows = await db
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
      accountName: accountsTable.name
    })
    .from(runsTable)
    .leftJoin(accountsTable, eq(runsTable.accountId, accountsTable.id))
    .where(eq(runsTable.accountId, accountId))
    .orderBy(desc(runsTable.createdAt), desc(runsTable.id))
    .limit(shown + 1)

  return {
    runs: rows.slice(0, shown).map(r => ({
      ...r,
      accountName: r.accountName || 'Unknown Identity'
    })),
    hasMore: rows.length > shown && shown < MAX_SHOWN
  }
}
