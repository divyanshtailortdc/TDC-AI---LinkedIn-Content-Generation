import { SetupShell } from '@/components/account-setup/setup-shell'
import { accountIdOr404, getAccountOr404 } from '@/lib/account-route'
import { parsePage } from '@/lib/pagination'
import { getRunSpendSummary } from '@/lib/run-spend'
import { RunsClient } from '../../../runs/runs-client'
import { loadRunsPage } from '../../../runs/runs-data'

export const dynamic = 'force-dynamic'

interface AccountRunsPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AccountRunsPage({
  params,
  searchParams
}: AccountRunsPageProps) {
  const id = accountIdOr404((await params).id, '/runs')
  const page = parsePage((await searchParams).page)

  const [account, { rows, pageInfo }, spend] = await Promise.all([
    getAccountOr404(id),
    loadRunsPage(id, page),
    getRunSpendSummary(id)
  ])

  const formattedRuns = rows.map(r => ({
    ...r,
    accountName: account.name
  }))

  return (
    <SetupShell account={account}>
      <RunsClient
        initialRuns={formattedRuns}
        pageInfo={pageInfo}
        activeAccount={{ id: account.id, name: account.name, isActive: account.isActive }}
        hideHeader={true}
        spend={spend}
      />
    </SetupShell>
  )
}
