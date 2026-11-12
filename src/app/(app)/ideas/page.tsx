import { IdeasClient } from './ideas-client'
import { loadIdeasPage } from './ideas-data'
import { getIdentity, toIdentitySummary } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { NoIdentity } from '@/components/no-identity'
import { parseStatusFilter } from './status-filter'

export const dynamic = 'force-dynamic'

export default async function IdeasPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()

  if (!identity) {
    return <NoIdentity title="Idea Review & Approval" />
  }

  const params = await searchParams
  const status = parseStatusFilter(params.status)
  const { ideas, pageInfo, statusCounts, proposedIds, approvedIds } =
    await loadIdeasPage(identity.id, {
      status,
      page: parsePage(params.page)
    })

  return (
    <IdeasClient
      initialIdeas={ideas}
      pageInfo={pageInfo}
      status={status}
      statusCounts={statusCounts}
      proposedIds={proposedIds}
      approvedIds={approvedIds}
      identity={toIdentitySummary(identity)}
    />
  )
}
