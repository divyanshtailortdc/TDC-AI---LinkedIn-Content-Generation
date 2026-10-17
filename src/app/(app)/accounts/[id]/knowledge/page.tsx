import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { accountsTable, knowledgeDocumentsTable } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/ids'
import { KnowledgeClient } from './knowledge-client'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function KnowledgePage({ params }: PageProps) {
  const { id } = await params
  if (!isUuid(id)) notFound()

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
    <SetupShell account={account} hasSavedData={docs.length > 0}>
      <KnowledgeClient
        accountId={account.id}
        accountName={account.name}
        initialDocs={docs}
      />
    </SetupShell>
  )
}
