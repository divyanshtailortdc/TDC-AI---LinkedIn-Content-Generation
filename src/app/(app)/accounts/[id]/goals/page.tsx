import { notFound } from 'next/navigation'
import { db } from '@/db'
import { accountsTable, goalsTable, audiencesTable, knowledgeDocumentsTable } from '@/db/schema'
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

  const [goals, audiences, knowledgeDocs] = await Promise.all([
    db
      .select()
      .from(goalsTable)
      .where(eq(goalsTable.accountId, id))
      .orderBy(desc(goalsTable.createdAt)),
    db
      .select()
      .from(audiencesTable)
      .where(eq(audiencesTable.accountId, id)),
    db
      .select({
        id: knowledgeDocumentsTable.id,
        title: knowledgeDocumentsTable.title,
        sourceType: knowledgeDocumentsTable.sourceType,
      })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.accountId, id)),
  ])

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto">
          <GoalsClient
            accountId={account.id}
            accountName={account.name}
            initialGoals={goals}
            audiences={audiences.map((a) => ({ id: a.id, name: a.name }))}
            proofAssets={knowledgeDocs}
          />
        </div>
      </div>
    </div>
  )
}
