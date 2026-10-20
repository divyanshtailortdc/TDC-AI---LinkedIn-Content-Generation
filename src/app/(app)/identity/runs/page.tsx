import { SetupShell } from '@/components/account-setup/setup-shell'
import { requireIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { getRunSpendSummary } from '@/lib/run-spend'
import { RunsClient } from '../../runs/runs-client'
import { loadRunsPage } from '../../runs/runs-data'

export const dynamic = 'force-dynamic'

interface AccountRunsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AccountRunsPage({
  searchParams
}: AccountRunsPageProps) {
  const page = parsePage((await searchParams).page)
  const account = await requireIdentity()
  const id = account.id
  const [{ rows, pageInfo }, spend] = await Promise.all([
    loadRunsPage(id, page),
    getRunSpendSummary(id)
  ])

  const formattedRuns = rows.map(r => ({
    ...r,
    // Under the name it ran with; the current name only when none was recorded.
    accountName: r.accountNameAtRun ?? account.name
  }))

  return (
    <SetupShell account={account}>
      <RunsClient
        initialRuns={formattedRuns}
        pageInfo={pageInfo}
        identity={account}
        hideHeader={true}
        spend={spend}
      />
    </SetupShell>
  )
}
