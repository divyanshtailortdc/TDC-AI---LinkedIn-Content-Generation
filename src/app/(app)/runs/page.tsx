import { parsePage } from '@/lib/pagination'
import { getRunSpendSummary } from '@/lib/run-spend'
import { RunsClient } from './runs-client'
import { loadRunsPage } from './runs-data'
import { getActiveAccount } from '@/lib/active-account'
import { NoActiveAccount } from '@/components/no-active-account'

export const dynamic = 'force-dynamic'

export default async function RunsPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Run History  " />
  }

  const page = parsePage((await searchParams).page)
  const [{ rows, pageInfo }, spend] = await Promise.all([
    loadRunsPage(activeAccount.id, page),
    getRunSpendSummary(activeAccount.id)
  ])

  const formattedRuns = rows.map(r => ({
    ...r,
    accountName: activeAccount.name
  }))

  // Keying on the active account forces a remount on switch, so this client
  // component's local state (which only seeds from initialRuns once) resets
  // and reflects the newly active account's data instead of stale state.
  return (
    <RunsClient
      key={activeAccount.id}
      initialRuns={formattedRuns}
      pageInfo={pageInfo}
      activeAccount={activeAccount}
      spend={spend}
    />
  )
}
