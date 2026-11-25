import { NoIdentity } from '@/components/no-identity'
import { OtherIdentityNotice } from '@/components/other-identity-notice'
import { db } from '@/db'
import { getIdentity } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { findOwnedBlog } from '@/lib/ownership'
import { requireUser } from '@/lib/session'
import { notFound } from 'next/navigation'
import { loadBlogEditor } from '../blogs-data'
import { BlogView } from './blog-view'

export const dynamic = 'force-dynamic'

export default async function BlogPage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Blog" />
  const { id } = await params
  if (!isUuid(id)) notFound()

  const found = await loadBlogEditor(identity.id, id)
  if (!found) {
    // One of the user's other identities' blogs opens after a switch;
    // anyone else's, or one that is gone, is not found.
    const user = await requireUser()
    const owner = await findOwnedBlog(db, user.id, id)
    if (owner && owner.accountId !== identity.id) {
      return (
        <OtherIdentityNotice
          identity={{ id: owner.accountId, name: owner.accountName }}
          what="blog"
        />
      )
    }
    notFound()
  }

  // Keyed by blog, so opening another one starts from its own state.
  return (
    <BlogView key={found.blog.id} initial={found.blog} labels={found.labels} />
  )
}
