import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/ids'
import { getRunDetails } from '~/jobs/queue'
import { getActiveAccountId } from '@/lib/active-account'
import { recoverInterruptedRuns } from '@/lib/ai/run-lifecycle'
import { RunDetailClient } from './run-detail-client'

export const dynamic = 'force-dynamic'

interface RunPageProps {
  params: Promise<{ id: string }>
}

export default async function SingleRunPage({ params }: RunPageProps) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  // A run interrupted by a restart reads as failed, not as still in progress.
  await recoverInterruptedRuns(id)
  const { run, steps, findings, ideas } = await getRunDetails(id)

  if (!run) {
    notFound()
  }

  const [account, activeAccountId] = await Promise.all([
    db.query.accountsTable.findFirst({
      where: eq(accountsTable.id, run.accountId)
    }),
    getActiveAccountId()
  ])

  if (!account) {
    notFound()
  }

  // Any identity's run can be opened, including a deactivated one's (which
  // can't be made active, so it is shown as it is).
  return (
    <RunDetailClient
      initialRun={run}
      initialSteps={steps}
      initialFindings={findings}
      initialIdeas={ideas}
      account={account}
      activateAccount={account.isActive && account.id !== activeAccountId}
    />
  )
}
