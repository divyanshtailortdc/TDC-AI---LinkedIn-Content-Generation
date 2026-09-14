import { db } from '@/db'
import { accountsTable } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { getRunDetails } from '~/jobs/queue'
import { RunDetailClient } from './run-detail-client'

export const dynamic = 'force-dynamic'

interface RunPageProps {
  params: Promise<{ id: string }>
}

export default async function SingleRunPage({ params }: RunPageProps) {
  const { id } = await params
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
