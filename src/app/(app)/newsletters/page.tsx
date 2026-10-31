import { NoIdentity } from '@/components/no-identity'
import { db } from '@/db'
import { newslettersTable } from '@/db/schema'
import { isAICapable } from '@/lib/ai'
import { getIdentity } from '@/lib/identity'
import { isWebSearchConfigured } from '@/lib/research/web-search'
import { desc, eq } from 'drizzle-orm'
import { NewslettersClient } from './newsletters-client'

export const dynamic = 'force-dynamic'

// Discovery runs as a Server Action from this page and takes a minute or so:
// searches, a dozen-plus publisher pages, and two model calls.
export const maxDuration = 300

export default async function NewslettersPage() {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Newsletters" />

  const newsletters = await db
    .select({
      id: newslettersTable.id,
      name: newslettersTable.name,
      publisher: newslettersTable.publisher,
      description: newslettersTable.description,
      category: newslettersTable.category,
      topics: newslettersTable.topics,
      relevanceScore: newslettersTable.relevanceScore,
      relevanceReason: newslettersTable.relevanceReason,
      websiteUrl: newslettersTable.websiteUrl,
      signupUrl: newslettersTable.signupUrl,
      feedUrl: newslettersTable.feedUrl,
      status: newslettersTable.status,
      discoveredAt: newslettersTable.discoveredAt
    })
    .from(newslettersTable)
    .where(eq(newslettersTable.accountId, identity.id))
    .orderBy(
      desc(newslettersTable.relevanceScore),
      desc(newslettersTable.discoveredAt)
    )

  const missing = [
    isAICapable ? null : 'ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY',
    isWebSearchConfigured ? null : 'SERPER_API_KEY'
  ].filter((key): key is string => key !== null)

  return (
    <NewslettersClient initialNewsletters={newsletters} missingKeys={missing} />
  )
}
