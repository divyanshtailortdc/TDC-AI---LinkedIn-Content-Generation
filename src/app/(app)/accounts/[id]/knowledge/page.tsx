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
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <AccountHeader account={account} />
      <div className="flex-1 overflow-y-auto p-6 sm:p-8 bg-surface-hover/30">
        <div className="max-w-7xl mx-auto">
          <KnowledgeClient
            accountId={account.id}
            accountName={account.name}
            initialDocs={docs}
          />
        </div>
      </div>
    </div>
  )
}
