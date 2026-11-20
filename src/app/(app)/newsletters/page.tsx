import { NoIdentity } from '@/components/no-identity'
import { db } from '@/db'
import { newslettersTable } from '@/db/schema'
import { isAICapable } from '@/lib/ai'
import { getIdentity } from '@/lib/identity'
import { isWebSearchConfigured } from '@/lib/research/web-search'
import { and, desc, eq, ne } from 'drizzle-orm'
import { ensureInboundAddress } from '~/lib/mail/addresses'
import { inboxConfig } from '~/lib/mail/settings'
import { NewslettersClient } from './newsletters-client'

export const dynamic = 'force-dynamic'

// Discovery runs as a Server Action from this page and takes a minute or so:
// searches, a dozen-plus publisher pages, and two model calls.
export const maxDuration = 300

export default async function NewslettersPage() {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Newsletters" />

  // The address to sign up with, shown beside the list, so issues land in
  // the Inbox. The Inbox page makes it the same way on first visit; without
  // one (none could be made) the user is sent there to choose it.
  const config = inboxConfig()
  const addressLoad = config
    ? ensureInboundAddress(identity.id, config.domain).catch(error => {
        console.error('Loading the inbox address failed:', error)
        return null
      })
    : null

  const newslettersLoad = db
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
    .where(
      and(
        eq(newslettersTable.accountId, identity.id),
        ne(newslettersTable.status, 'removed')
      )
    )
    .orderBy(
      desc(newslettersTable.relevanceScore),
      desc(newslettersTable.discoveredAt)
    )
  const [newsletters, address] = await Promise.all([
    newslettersLoad,
    addressLoad
  ])

  const missing = [
    isAICapable ? null : 'ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY',
    isWebSearchConfigured ? null : 'SERPER_API_KEY'
  ].filter((key): key is string => key !== null)

  return (
    <NewslettersClient
      initialNewsletters={newsletters}
      missingKeys={missing}
      inbox={config ? { address } : null}
    />
  )
}
