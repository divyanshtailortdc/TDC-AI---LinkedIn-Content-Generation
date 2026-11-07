import { NoIdentity } from '@/components/no-identity'
import { getIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import type { Metadata } from 'next'
import {
  ensureInboundAddress,
  replacedInboundAddresses
} from '~/lib/mail/addresses'
import { readMailSyncStatus } from '~/lib/mail/mailbox'
import { inboxConfig } from '~/lib/mail/settings'
import { InboxClient } from './inbox-client'
import { loadInboxPage, parseInboxQuery } from './inbox-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Inbox · TDC Content Engine'
}

export default async function InboxPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Inbox" />

  const config = inboxConfig()
  if (!config) return <InboxClient inbox={null} />

  const params = await searchParams
  const query = parseInboxQuery(params.q)
  const [address, earlierAddresses, status, { rows, pageInfo }] =
    await Promise.all([
      ensureInboundAddress(identity.id, config.domain),
      replacedInboundAddresses(identity.id, config.domain),
      readMailSyncStatus(config.statusMailbox),
      loadInboxPage(identity.id, { page: parsePage(params.page), query })
    ])

  return (
    <InboxClient
      inbox={{
        address,
        earlierAddresses,
        domain: config.domain,
        status,
        messages: rows,
        pageInfo,
        query
      }}
    />
  )
}
