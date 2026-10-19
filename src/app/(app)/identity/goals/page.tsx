import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { goalsTable } from '@/db/schema'
import { requireIdentity } from '@/lib/identity'
import { desc, eq } from 'drizzle-orm'
import { GoalsClient } from './goals-client'

export default async function GoalsPage() {
  const account = await requireIdentity()
  const id = account.id
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
