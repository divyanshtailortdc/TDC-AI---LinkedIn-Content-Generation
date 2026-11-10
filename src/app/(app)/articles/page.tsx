import { NoIdentity } from '@/components/no-identity'
import { getIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import { ArticlesClient } from './articles-client'
import { loadArticlesPage } from './articles-data'

export const dynamic = 'force-dynamic'

export default async function ArticlesPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Articles" />

  const params = await searchParams
  const { articles, pageInfo } = await loadArticlesPage(
    identity.id,
    parsePage(params.page)
  )
  return (
    <ArticlesClient
      articles={articles}
      pageInfo={pageInfo}
      identityName={identity.name}
    />
  )
}
