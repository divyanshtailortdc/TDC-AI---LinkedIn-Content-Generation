import { SetupShell } from '@/components/account-setup/setup-shell'
import { requireIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { loadRunPicker } from '@/lib/run-picker'
import { getRunSpendSummary } from '@/lib/run-spend'
import { RunsClient } from '../../runs/runs-client'
import { loadRunsPage } from '../../runs/runs-data'
import { parseRunFilter } from '../../runs/run-display'

export const dynamic = 'force-dynamic'

interface AccountRunsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function AccountRunsPage({
  searchParams
}: AccountRunsPageProps) {
  const params = await searchParams
  const page = parsePage(params.page)
  const filter = parseRunFilter(params.status)
  const account = await requireIdentity()
  const id = account.id
  const [{ rows, pageInfo, counts, latestRunId }, spend, picker] = await Promise.all([
    loadRunsPage(id, page, filter),
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
        filter={filter}
        counts={counts}
        latestRunId={latestRunId}
        picker={picker}
        hideHeader={true}
        spend={spend}
      />
    </SetupShell>
  )
}
