import { notFound } from 'next/navigation'
import { db } from '@/db'
import { accountsTable, knowledgeDocumentsTable } from '@/db/schema'
import { eq, desc } from 'drizzle-orm'
import { KnowledgeClient } from './knowledge-client'
import { AccountHeader } from '@/components/account-header'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function KnowledgePage({ params }: PageProps) {
  const { id } = await params

  const account = await db.query.accountsTable.findFirst({
    where: eq(accountsTable.id, id)
  })

  if (!account) {
    notFound()
  }

  const docs = await db
    .select()
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.accountId, id))
    .orderBy(desc(knowledgeDocumentsTable.createdAt))

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <AccountHeader account={account} />
      <KnowledgeClient
        accountId={account.id}
        accountName={account.name}
        initialDocs={docs}
      />
    </div>
  )
}
