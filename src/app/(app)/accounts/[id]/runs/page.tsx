import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { getRunSpendSummary } from '@/lib/run-spend'
import { desc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/ids'
import { RunsClient } from '../../../runs/runs-client'

export const dynamic = 'force-dynamic'

interface AccountRunsPageProps {
  params: Promise<{ id: string }>
}

export default async function AccountRunsPage({
  params
}: AccountRunsPageProps) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) {
    notFound()
  }

  const accountRuns = await db
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
    .where(eq(runsTable.accountId, id))
    .orderBy(desc(runsTable.createdAt))

  const spend = await getRunSpendSummary(id)

  const formattedRuns = accountRuns.map(r => ({
    ...r,
    accountName: account.name
  }))

  return (
    <SetupShell account={account}>
      <RunsClient
        initialRuns={formattedRuns}
        activeAccount={{ id: account.id, name: account.name }}
        hideHeader={true}
        spend={spend}
      />
    </SetupShell>
  )
}
