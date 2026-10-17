import { IdeasClient } from './ideas-client'
import { loadIdeasPage } from './ideas-data'
import { getActiveAccount } from '@/lib/active-account'
import { parsePage } from '@/lib/pagination'
import { NoActiveAccount } from '@/components/no-active-account'
import { parseStatusFilter } from './status-filter'

export const dynamic = 'force-dynamic'

export default async function IdeasPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Idea Approval Gate" />
  }

  const params = await searchParams
  const status = parseStatusFilter(params.status)
  const { ideas, pageInfo, statusCounts, proposedIds, approvedIds } =
    await loadIdeasPage(activeAccount.id, {
      status,
      page: parsePage(params.page)
    })

  // Keying on the active account forces a remount on switch, so this client
  // component's local state resets and reflects the newly active account's
  // data instead of stale state.
  return (
    <IdeasClient
      key={activeAccount.id}
      initialIdeas={ideas}
      pageInfo={pageInfo}
      status={status}
      statusCounts={statusCounts}
      proposedIds={proposedIds}
      approvedIds={approvedIds}
      activeAccount={activeAccount}
    />
  )
}
