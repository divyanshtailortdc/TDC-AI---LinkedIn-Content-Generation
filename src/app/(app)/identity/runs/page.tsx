import { SetupShell } from '@/components/account-setup/setup-shell'
import { requireIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { loadRunPicker } from '@/lib/run-picker'
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
  const [{ rows, pageInfo }, spend, picker] = await Promise.all([
    loadRunsPage(id, page),
    getRunSpendSummary(id),
    loadRunPicker(id)
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
        picker={picker}
        hideHeader={true}
        spend={spend}
      />
    </SetupShell>
  )
}
