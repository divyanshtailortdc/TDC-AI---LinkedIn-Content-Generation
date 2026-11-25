import { NoIdentity } from '@/components/no-identity'
import { db } from '@/db'
import { getIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { parsePublishedFilters } from '@/lib/published-content'
import { isPublishingConfigured } from '@/lib/publishing/config'
import { latestPublications } from '@/lib/publishing/engine'
import { isOnPlatform } from '@/lib/publishing/status'
import { PublishedClient } from './published-client'
import { loadPublishedContent } from './published-data'

export const dynamic = 'force-dynamic'

/**
 * Everything the active identity has published, social posts and blogs
 * together, filtered by content type and destination (?type=, ?destination=,
 * ?page=).
 */
export default async function PublishedPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Published Content" />

  const params = await searchParams
  const filters = parsePublishedFilters({
    type: params.type,
    destination: params.destination
  })
  const { items, pageInfo, counts } = await loadPublishedContent(
    db,
    identity.id,
    filters,
    parsePage(params.page),
    // Skipped when publishing is not set up, so the page does not depend on
    // its tables.
    { liveUrls: isPublishingConfigured() ? liveUrlsOf : undefined }
  )

  return (
    <PublishedClient
      identityName={identity.name}
      items={items}
      pageInfo={pageInfo}
      counts={counts}
      filters={filters}
    />
  )
}

/** Each post's live page, from its latest publication while it is out. */
async function liveUrlsOf(postIds: string[]): Promise<Map<string, string>> {
  const latest = await latestPublications(db, postIds)
  const urls = new Map<string, string>()
  for (const [postId, publication] of latest) {
    if (isOnPlatform(publication) && publication.postUrl) {
      urls.set(postId, publication.postUrl)
    }
  }
  return urls
}
