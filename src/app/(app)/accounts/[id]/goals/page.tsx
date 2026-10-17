import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { goalsTable } from '@/db/schema'
import { accountIdOr404, getAccountOr404 } from '@/lib/account-route'
import { desc, eq } from 'drizzle-orm'
import { GoalsClient } from './goals-client'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function GoalsPage({ params }: PageProps) {
  const id = accountIdOr404((await params).id, '/goals')

  const [account, goals] = await Promise.all([
    getAccountOr404(id),
    db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.accountId, id))
      .orderBy(desc(goalsTable.createdAt))
  ])

  return (
    <SetupShell account={account} hasSavedData={goals.length > 0}>
      <GoalsClient accountId={account.id} initialGoals={goals} />
    </SetupShell>
  )
}
