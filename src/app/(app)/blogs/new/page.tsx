import { NoIdentity } from '@/components/no-identity'
import { getIdentity } from '@/lib/identity'
import { loadNewBlogOptions } from '../blogs-data'
import { NewBlogForm } from './new-blog-form'

export const dynamic = 'force-dynamic'

/** `?idea=<id>` starts from an idea; `?from=<blog id>` from an earlier blog's brief. */
export default async function NewBlogPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="New blog or article" />
  const params = await searchParams
  const one = (value: string | string[] | undefined) =>
    typeof value === 'string' ? value : null
  const options = await loadNewBlogOptions(identity.id, {
    ideaId: one(params.idea),
    blogId: one(params.from)
  })
  return <NewBlogForm options={options} />
}
