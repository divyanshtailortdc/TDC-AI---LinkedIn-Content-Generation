import { parsePage } from '@/lib/pagination'
import { loadRunPicker } from '@/lib/run-picker'
import { getRunSpendSummary } from '@/lib/run-spend'
import { RunsClient } from './runs-client'
import { loadRunsPage } from './runs-data'
import { parseRunFilter } from './run-display'
import { getIdentity } from '@/lib/identity'
import { NoIdentity } from '@/components/no-identity'

export const dynamic = 'force-dynamic'

export default async function RunsPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()

  if (!identity) {
    return <NoIdentity title="Run Details" />
  }

  const params = await searchParams
  const page = parsePage(params.page)
  // ?status= picks which runs the list shows; see RUN_FILTERS.
  const filter = parseRunFilter(params.status)
  const [{ rows, pageInfo, counts, latestRunId }, spend, picker] = await Promise.all([
    loadRunsPage(identity.id, page, filter),
    getRunSpendSummary(identity.id),
    loadRunPicker(identity.id)
  ])

  const formattedRuns = rows.map(r => ({
    ...r,
    // Under the name it ran with; the current name only when none was recorded.
    accountName: r.accountNameAtRun ?? identity.name
  }))

  return (
    <RunsClient
      initialRuns={formattedRuns}
      pageInfo={pageInfo}
      filter={filter}
      counts={counts}
      latestRunId={latestRunId}
      picker={picker}
      spend={spend}
    />
  )
}
