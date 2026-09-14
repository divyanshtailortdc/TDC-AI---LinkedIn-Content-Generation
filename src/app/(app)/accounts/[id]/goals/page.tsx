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
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <AccountHeader account={account} />
      <GoalsClient
        accountId={account.id}
        accountName={account.name}
        initialGoals={goals}
        audiences={audiences.map((a) => ({ id: a.id, name: a.name }))}
        proofAssets={knowledgeDocs}
      />
    </div>
  )
}
