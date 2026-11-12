import { NoIdentity } from '@/components/no-identity'
import { OtherIdentityNotice } from '@/components/other-identity-notice'
import { db } from '@/db'
import { accountsTable, postDraftsTable } from '@/db/schema'
import { ownedByUser } from '@/lib/ownership'
import { requireUser } from '@/lib/session'
import { and, eq } from 'drizzle-orm'
import { loadChannels } from '@/lib/channels'
import { getIdentity } from '@/lib/identity'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { loadBrandTheme } from '~/lib/ai/context'
import { brandColors, displayWebsite } from '~/lib/brand/theme'
import { LIST_PARAMS } from '../list-params'
import { PostDetailClient } from '../post-detail-client'
import { loadPostWithVersions } from '../posts-data'

export const dynamic = 'force-dynamic'

export default async function PostPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const identity = await getIdentity()
  if (!identity) {
    return <NoIdentity title="Post" />
  }

  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()

  // The list's filters ride along (?platform=x&status=…), so "All posts"
  // goes back to the list as it was left.
  const query = new URLSearchParams()
  const search = await searchParams
  for (const key of LIST_PARAMS) {
    const value = search[key]
    if (typeof value === 'string' && value) query.set(key, value)
  }
  const listQuery = query.toString()

  const [found, brand, channels] = await Promise.all([
    loadPostWithVersions(identity.id, id),
    loadBrandTheme(identity.id),
    loadChannels(identity.id)
  ])
  if (!found) {
    // One of the user's other identities' posts opens after a switch;
    // anyone else's, or one that is gone, is not found.
    const user = await requireUser()
    const [owner] = await db
      .select({ id: accountsTable.id, name: accountsTable.name })
      .from(postDraftsTable)
      .innerJoin(accountsTable, eq(accountsTable.id, postDraftsTable.accountId))
      .where(and(eq(postDraftsTable.id, id), ownedByUser(user.id)))
      .limit(1)
    if (owner && owner.id !== identity.id) {
      return <OtherIdentityNotice identity={owner} what="post" />
    }
    notFound()
  }

  return (
    // Keyed by post, so opening another version starts from its own state.
    <PostDetailClient
      key={found.post.id}
      initialPost={found.post}
      initialVersions={found.versions}
      backHref={`/posts${listQuery ? `?${listQuery}` : ''}`}
      listQuery={listQuery}
      enabledFormats={channels.enabledFormats}
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
