import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { getRunSpendSummary } from '@/lib/run-spend'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/ids'
import { RunsClient } from '../../../runs/runs-client'
import { loadRunsList, runsShownFromParam } from '../../../runs/runs-data'

export const dynamic = 'force-dynamic'

interface AccountRunsPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ show?: string | string[] }>
}

export default async function AccountRunsPage({
  params,
  searchParams
}: AccountRunsPageProps) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) {
    notFound()
  }

  const shown = runsShownFromParam((await searchParams).show)
  const [{ runs, hasMore }, spend] = await Promise.all([
    loadRunsList(id, shown),
    getRunSpendSummary(id)
  ])

  const formattedRuns = runs.map(r => ({
    ...r,
    accountName: account.name
  }))

  return (
    <SetupShell account={account}>
      <RunsClient
        initialRuns={formattedRuns}
        hasMore={hasMore}
        shown={shown}
        activeAccount={{ id: account.id, name: account.name }}
        hideHeader={true}
        spend={spend}
      />
    </SetupShell>
  )
}
