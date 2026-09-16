import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { RunsClient } from './runs-client'
import { getActiveAccount } from '@/lib/active-account'
import { NoActiveAccount } from '@/components/no-active-account'

export const dynamic = 'force-dynamic'

export default async function RunsPage() {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Run Engine & Observability" />
  }

  const runsRaw = await db
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
    .where(eq(runsTable.accountId, activeAccount.id))
    .orderBy(desc(runsTable.createdAt))

  const formattedRuns = runsRaw.map(r => ({
    ...r,
    accountName: r.accountName || 'Unknown Identity'
  }))

  // Keying on the active account forces a remount on switch, so this client
  // component's local state (which only seeds from initialRuns once) resets
  // and reflects the newly active account's data instead of stale state.
  return (
    <RunsClient key={activeAccount.id} initialRuns={formattedRuns} activeAccount={activeAccount} />
  )
}
