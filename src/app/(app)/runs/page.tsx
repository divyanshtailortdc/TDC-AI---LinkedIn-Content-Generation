import { getRunSpendSummary } from '@/lib/run-spend'
import { RunsClient } from './runs-client'
import { loadRunsList, runsShownFromParam } from './runs-data'
import { getActiveAccount } from '@/lib/active-account'
import { NoActiveAccount } from '@/components/no-active-account'

export const dynamic = 'force-dynamic'

export default async function RunsPage({
  searchParams
}: {
  searchParams: Promise<{ show?: string | string[] }>
}) {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Run Engine & Observability" />
  }

  const shown = runsShownFromParam((await searchParams).show)
  const [{ runs, hasMore }, spend] = await Promise.all([
    loadRunsList(activeAccount.id, shown),
    getRunSpendSummary(activeAccount.id)
  ])

  // Keying on the active account forces a remount on switch, so this client
  // component's local state (which only seeds from initialRuns once) resets
  // and reflects the newly active account's data instead of stale state.
  return (
    <RunsClient
      key={activeAccount.id}
      initialRuns={runs}
      hasMore={hasMore}
      shown={shown}
      activeAccount={activeAccount}
      spend={spend}
    />
  )
}
