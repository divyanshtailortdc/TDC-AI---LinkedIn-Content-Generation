import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { knowledgeDocumentsTable } from '@/db/schema'
import { requireIdentity } from '@/lib/identity'
import { desc, eq } from 'drizzle-orm'
import { KnowledgeClient } from './knowledge-client'

export default async function KnowledgePage() {
  const account = await requireIdentity()
  const id = account.id
  // Not `content`: the full text of every document would ship to the browser,
  // and the list shows only the summary and claims.
  const docs = await db
    .select({
      id: knowledgeDocumentsTable.id,
      title: knowledgeDocumentsTable.title,
      sourceType: knowledgeDocumentsTable.sourceType,
      sourceUrl: knowledgeDocumentsTable.sourceUrl,
      summary: knowledgeDocumentsTable.summary,
      keyClaims: knowledgeDocumentsTable.keyClaims,
      wordCount: knowledgeDocumentsTable.wordCount,
      createdAt: knowledgeDocumentsTable.createdAt
    })
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
