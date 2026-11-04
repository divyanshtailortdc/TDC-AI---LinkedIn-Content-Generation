import { NoIdentity } from '@/components/no-identity'
import { getIdentity } from '@/lib/identity'
import { parsePage } from '@/lib/pagination'
import type { Metadata } from 'next'
import { LibraryClient } from './library-client'
import { loadLibraryPage, parseLibraryQuery } from './library-data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Library · TDC LinkedIn Content Engine'
}

export default async function LibraryPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Library" />

  const params = await searchParams
  const query = parseLibraryQuery(params.q)
  const { stories, pageInfo } = await loadLibraryPage(identity.id, {
    page: parsePage(params.page),
    query
  })

  return <LibraryClient stories={stories} pageInfo={pageInfo} query={query} />
}
