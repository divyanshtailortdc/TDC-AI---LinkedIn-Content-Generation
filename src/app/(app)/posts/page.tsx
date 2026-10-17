import { PostsClient } from './posts-client'
import { countPosts, loadPostsPage } from './posts-data'
import { getActiveAccount } from '@/lib/active-account'
import { NoActiveAccount } from '@/components/no-active-account'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export default async function PostsPage({
  searchParams
}: {
  searchParams: Promise<{ runId?: string | string[] }>
}) {
  const activeAccount = await getActiveAccount()

  if (!activeAccount) {
    return <NoActiveAccount title="Review & Ship Posts" />
  }

  // Opened from a run (?runId=): that run's posts are loaded along with the
  // newest page, however far back they are.
  const { runId: rawRunId } = await searchParams
  const runId = z.string().uuid().safeParse(rawRunId).success
    ? (rawRunId as string)
    : null

  const [{ posts, nextCursor }, total] = await Promise.all([
    loadPostsPage(activeAccount.id, { runId }),
    countPosts(activeAccount.id)
  ])

  // Keying on the active account (and the run) forces a remount on a switch, so
  // this client component's local state (which only seeds from initialPosts
  // once) resets and reflects the data for what is now being shown.
  return (
    <PostsClient
      key={`${activeAccount.id}:${runId ?? ''}`}
      initialPosts={posts}
      initialNextCursor={nextCursor}
      totalCount={total}
      activeAccount={activeAccount}
    />
  )
}
