import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { RunsClient } from './runs-client'

export const dynamic = 'force-dynamic'

export default async function RunsPage() {
  const [runsRaw, accounts] = await Promise.all([
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
        model: runsTable.model,
        error: runsTable.error,
        createdAt: runsTable.createdAt,
        accountName: accountsTable.name
      })
      .from(runsTable)
      .leftJoin(accountsTable, eq(runsTable.accountId, accountsTable.id))
      .orderBy(desc(runsTable.createdAt)),
    db
      .select({
        id: accountsTable.id,
        name: accountsTable.name
      })
      .from(accountsTable)
  ])

  const formattedRuns = runsRaw.map((r) => ({
    ...r,
    accountName: r.accountName || 'Unknown Identity'
  }))

  return <RunsClient initialRuns={formattedRuns} accounts={accounts} />
}
