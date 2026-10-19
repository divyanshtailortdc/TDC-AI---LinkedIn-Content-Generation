import { db } from '@/db'
import { recoverInterruptedRuns } from '@/lib/ai/run-lifecycle'
import { findOwnedAccount, findOwnedRun } from '@/lib/ownership'
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

  // A run interrupted by a restart reads as failed, not as still in progress.
  await recoverInterruptedRuns(owned.id)
  const { run, steps, findings, ideas } = await getRunDetails(owned.id)

  if (!run) {
    notFound()
  }

  const account = await findOwnedAccount(db, user.id, run.accountId)

  if (!account) {
    notFound()
  }

  return (
    <RunDetailClient
      initialRun={run}
      initialSteps={steps}
      initialFindings={findings}
      initialIdeas={ideas}
      account={account}
    />
  )
}
