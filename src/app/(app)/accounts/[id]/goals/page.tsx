import { notFound } from 'next/navigation'
import { db } from '@/db'
import { accountsTable, goalsTable } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { GoalsClient } from './goals-client'
import { AccountHeader } from '@/components/account-header'

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
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto">
          <GoalsClient
            accountId={account.id}
            initialGoals={goals}
          />
        </div>
      </div>
    </div>
  )
}
