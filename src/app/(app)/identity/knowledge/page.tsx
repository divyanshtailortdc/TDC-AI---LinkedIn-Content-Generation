import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { knowledgeDocumentsTable } from '@/db/schema'
import { requireIdentity } from '@/lib/identity'
import { desc, eq } from 'drizzle-orm'
import { KnowledgeClient } from './knowledge-client'

export default async function KnowledgePage() {
  const account = await requireIdentity()
  const id = account.id
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
