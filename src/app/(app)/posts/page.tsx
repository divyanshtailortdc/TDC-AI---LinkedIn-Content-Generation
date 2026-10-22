import { PostsClient } from './posts-client'
import { countPosts, loadPostsPage } from './posts-data'
import { getIdentity, toIdentitySummary } from '@/lib/identity'
import { NoIdentity } from '@/components/no-identity'
import { loadBrandTheme } from '~/lib/ai/context'
import { brandColors, displayWebsite } from '~/lib/brand/theme'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export default async function PostsPage({
  searchParams
}: {
  searchParams: Promise<{ runId?: string | string[] }>
}) {
  const identity = await getIdentity()

  if (!identity) {
    return <NoIdentity title="Post Review & Approval" />
  }

  // Opened from a run (?runId=): that run's posts are loaded along with the
  // newest page, however far back they are.
  const { runId: rawRunId } = await searchParams
  const runId = z.string().uuid().safeParse(rawRunId).success
    ? (rawRunId as string)
    : null

  const [{ posts, nextCursor }, total, brand] = await Promise.all([
    loadPostsPage(identity.id, { runId }),
    countPosts(identity.id),
    loadBrandTheme(identity.id)
  ])

  // Keying on the run forces a remount when it changes, so this client
  // component's local state (which only seeds from initialPosts once) resets
  // and reflects the data for what is now being shown.
  return (
    <PostsClient
      key={runId ?? ''}
      initialPosts={posts}
      initialNextCursor={nextCursor}
      totalCount={total}
      identity={toIdentitySummary(identity)}
      brand={{
        hasLogo: brand.hasLogo,
        colors: brandColors(brand).map(c => c.hex),
        pattern: brand.backgroundPattern,
        footerText: brand.footerText,
        website: displayWebsite(identity.websiteUrl)
      }}
    />
  )
}
