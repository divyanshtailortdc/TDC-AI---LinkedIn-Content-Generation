import { parsePage } from '@/lib/pagination'
import { loadRunPicker } from '@/lib/run-picker'
import { getRunSpendSummary } from '@/lib/run-spend'
import { RunsClient } from './runs-client'
import { loadRunsPage } from './runs-data'
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
    return <NoIdentity title="Run History  " />
  }

  const page = parsePage((await searchParams).page)
  const [{ rows, pageInfo }, spend, picker] = await Promise.all([
    loadRunsPage(identity.id, page),
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
      picker={picker}
      spend={spend}
    />
  )
}
