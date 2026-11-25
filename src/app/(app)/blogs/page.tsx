import { NoIdentity } from '@/components/no-identity'
import { getIdentity } from '@/lib/identity'
import { BlogsClient } from './blogs-client'
import { loadBlogList } from './blogs-data'

export const dynamic = 'force-dynamic'

export default async function BlogsPage() {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Blogs & Articles" />
  const blogs = await loadBlogList(identity.id)
  return <BlogsClient blogs={blogs} />
}
