import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
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
  // A run interrupted by a restart reads as failed, not as still in progress.
  await recoverInterruptedRuns(id)
  const { run, steps, findings, ideas } = await getRunDetails(id)

  if (!run) {
    notFound()
  }

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, run.accountId)
  })

  if (!account) {
    notFound()
  }

  // A run belongs to whichever account created it. If the sidebar's active
  // account was switched while this page was open, this run no longer
  // belongs to "the workspace you're now in" — send back to the Runs list,
  // which re-renders scoped to the newly active account.
  const activeAccountId = await getActiveAccountId()
  if (activeAccountId && activeAccountId !== run.accountId) {
    redirect('/runs')
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
