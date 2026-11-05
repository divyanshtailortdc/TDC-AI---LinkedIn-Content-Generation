import { NEWSLETTER_KNOWLEDGE_PATH } from '@/lib/knowledge-path'
import { redirect } from 'next/navigation'

/**
 * The Library moved into the Knowledge base ("From newsletters"); links to
 * it land there, with their search.
 */
export default async function LibraryPage({
  searchParams
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { q } = await searchParams
  const query = Array.isArray(q) ? q[0] : q
  redirect(
    query
      ? `${NEWSLETTER_KNOWLEDGE_PATH}&q=${encodeURIComponent(query)}`
      : NEWSLETTER_KNOWLEDGE_PATH
  )
}
