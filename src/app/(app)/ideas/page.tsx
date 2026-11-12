import { IdeasClient } from './ideas-client'
import { loadIdeasPage } from './ideas-data'
import { loadChannels } from '@/lib/channels'
import { isPlatformId, PLATFORM_IDS } from '@/lib/formats'
import { getIdentity, toIdentitySummary } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { loadRunPicker } from '@/lib/run-picker'
import { NoIdentity } from '@/components/no-identity'
import { parseStatusFilter } from './status-filter'

export const dynamic = 'force-dynamic'

export default async function IdeasPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()

  if (!identity) {
    return <NoIdentity title="Idea Review & Approval" />
  }

  const params = await searchParams
  const status = parseStatusFilter(params.status)
  // One platform's ideas (?platform=instagram); every platform's when absent.
  const platformParam = Array.isArray(params.platform)
    ? params.platform[0]
    : params.platform
  const platform = isPlatformId(platformParam) ? platformParam : null
  const [
    {
      ideas,
      pageInfo,
      statusCounts,
      proposedIds,
      approvedIds,
      platformCounts,
      platformsWithIdeas
    },
    channels,
    picker
  ] = await Promise.all([
    loadIdeasPage(identity.id, {
      status,
      page: parsePage(params.page),
      platform
    }),
    loadChannels(identity.id),
    // For Generate ideas, which starts on the platform being shown.
    loadRunPicker(identity.id)
  ])
  // A tab for every platform the identity posts on, or that has ideas.
  const platformOptions = PLATFORM_IDS.filter(
    p =>
      channels.platforms.includes(p) ||
      platformsWithIdeas.includes(p) ||
      p === platform
  )

  return (
    <IdeasClient
      initialIdeas={ideas}
      pageInfo={pageInfo}
      status={status}
      statusCounts={statusCounts}
      proposedIds={proposedIds}
      approvedIds={approvedIds}
      identity={toIdentitySummary(identity)}
      platform={platform}
      platformOptions={platformOptions}
      platformCounts={platformCounts}
      picker={picker}
    />
  )
}
