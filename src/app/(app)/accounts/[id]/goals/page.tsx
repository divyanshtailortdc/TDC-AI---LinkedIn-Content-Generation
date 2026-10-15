import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { accountsTable, goalsTable } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { GoalsClient } from './goals-client'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function GoalsPage({ params }: PageProps) {
  const { id } = await params

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) {
    notFound()
  }

  const goals = await db
    .select()
    .from(goalsTable)
    .where(eq(goalsTable.accountId, id))
    .orderBy(desc(goalsTable.createdAt))

  return (
    <SetupShell account={account} hasSavedData={goals.length > 0}>
      <GoalsClient accountId={account.id} initialGoals={goals} />
    </SetupShell>
  )
}
