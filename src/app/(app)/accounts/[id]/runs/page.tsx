import { db } from '@/db'
import { accountsTable, runsTable } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { AccountHeader } from '@/components/account-header'
import { RunsClient } from '../../../runs/runs-client'

export const dynamic = 'force-dynamic'

interface AccountRunsPageProps {
  params: Promise<{ id: string }>
}

export default async function AccountRunsPage({ params }: AccountRunsPageProps) {
  const { id } = await params

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
      model: runsTable.model,
      error: runsTable.error,
      createdAt: runsTable.createdAt,
      accountName: accountsTable.name
    })
    .from(runsTable)
    .leftJoin(accountsTable, eq(runsTable.accountId, accountsTable.id))
    .where(eq(runsTable.accountId, id))
    .orderBy(desc(runsTable.createdAt))

  const formattedRuns = accountRuns.map((r) => ({
    ...r,
    accountName: account.name
  }))

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto space-y-6">
          <RunsClient initialRuns={formattedRuns} accounts={[{ id: account.id, name: account.name }]} hideHeader={true} />
        </div>
      </div>
    </div>
  )
}
