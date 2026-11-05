import { SetupShell } from '@/components/account-setup/setup-shell'
import { db } from '@/db'
import { intelMentionsTable, knowledgeDocumentsTable } from '@/db/schema'
import { requireIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { count, desc, eq } from 'drizzle-orm'
import { isOldNews } from '~/lib/intel/settings'
import { KnowledgeClient } from './knowledge-client'
import { KnowledgeViews, parseKnowledgeView } from './knowledge-views'
import { loadNewsletterStories, parseNewsletterQuery } from './newsletter-data'
import { NewsletterKnowledge } from './newsletter-knowledge'

export default async function KnowledgePage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const account = await requireIdentity()
  const id = account.id
  const params = await searchParams
  const view = parseKnowledgeView(params.view)

  const [[documents], [stories]] = await Promise.all([
    db
      .select({ n: count() })
      .from(knowledgeDocumentsTable)
      .where(eq(knowledgeDocumentsTable.accountId, id)),
    db
      .select({ n: count() })
      .from(intelMentionsTable)
      .where(eq(intelMentionsTable.accountId, id))
  ])
  const views = (
    <KnowledgeViews
      view={view}
      documents={documents?.n ?? 0}
      stories={stories?.n ?? 0}
    />
  )

  if (view === 'newsletters') {
    const query = parseNewsletterQuery(params.q)
    const page = await loadNewsletterStories(id, {
      page: parsePage(params.page),
      query
    })
    // Nothing here is edited as a form, so the step has no Edit or Save.
    // Keyed by view: the frame decides on Edit when it first renders, and
    // switching tabs would otherwise keep the documents view's decision.
    return (
      <SetupShell key="newsletters" account={account}>
        {views}
        <NewsletterKnowledge
          stories={page.stories}
          pageInfo={page.pageInfo}
          query={query}
        />
      </SetupShell>
    )
  }

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
      publishedAt: knowledgeDocumentsTable.publishedAt,
      createdAt: knowledgeDocumentsTable.createdAt
    })
    .from(knowledgeDocumentsTable)
    .where(eq(knowledgeDocumentsTable.accountId, id))
    .orderBy(desc(knowledgeDocumentsTable.createdAt))

  return (
    <SetupShell
      key="documents"
      account={account}
      hasSavedData={docs.length > 0}
    >
      {views}
      <KnowledgeClient
        accountId={account.id}
        accountName={account.name}
        initialDocs={docs.map(doc => ({ ...doc, oldNews: isOldNews(doc) }))}
      />
    </SetupShell>
  )
}
