import { db } from '@/db'
import { recoverInterruptedRuns } from '@/lib/ai/run-lifecycle'
import { findOwnedAccount, findOwnedRun } from '@/lib/ownership'
import { ACTIVE_RUN_STATUSES } from '@/lib/run-status'
import { requireUser } from '@/lib/session'
import { notFound } from 'next/navigation'
import { getRunDetails } from '~/jobs/queue'
import { RunDetailClient } from './run-detail-client'

export const dynamic = 'force-dynamic'

interface RunPageProps {
  params: Promise<{ id: string }>
}

export default async function SingleRunPage({ params }: RunPageProps) {
  const { id } = await params
  const user = await requireUser()
  // Someone else's run is a 404, the same as a run that does not exist.
  const owned = await findOwnedRun(db, user.id, id)
  if (!owned) notFound()

  // Everything else at once: the ownership check gave the account.
  let [details, account] = await Promise.all([
    getRunDetails(owned.id, owned.accountId),
    findOwnedAccount(db, user.id, owned.accountId)
  ])

  // A run interrupted by a restart reads as failed, not as still in
  // progress. Only a run that still reads as in progress can be one, and the
  // check is a write, so a finished run skips it.
  if (details.run && ACTIVE_RUN_STATUSES.includes(details.run.status)) {
    const recovered = await recoverInterruptedRuns(owned.id)
    if (recovered.length > 0) {
      details = await getRunDetails(owned.id, owned.accountId)
    }
  }
  const { run, steps, findings, ideas } = details

  if (!run) {
    notFound()
  }

  if (!account) {
    notFound()
  }

  return (
    // Keyed by run, so Re-analyze opening the new run starts from its own state.
    <RunDetailClient
      key={run.id}
      initialRun={run}
      initialSteps={steps}
      initialFindings={findings}
      initialIdeas={ideas}
      account={account}
    />
  )
}
