import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { knowledgeDocumentsTable } from '@/db/schema'
import { accountIdOr404, getAccountOr404 } from '@/lib/account-route'
import { desc, eq } from 'drizzle-orm'
import { KnowledgeClient } from './knowledge-client'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function KnowledgePage({ params }: PageProps) {
  const id = accountIdOr404((await params).id, '/knowledge')

  const [account, docs] = await Promise.all([
    getAccountOr404(id),
    db
      .select()
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.accountId, id))
      .orderBy(desc(knowledgeDocumentsTable.createdAt))
  ])

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
