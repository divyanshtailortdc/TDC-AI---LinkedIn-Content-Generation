import { NoIdentity } from '@/components/no-identity'
import { getIdentity } from '@/lib/identity'
import { isUuid } from '@/lib/ids'
import { notFound } from 'next/navigation'
import { loadArticleForEditor } from '../articles-data'
import { ArticleEditor } from './article-editor'

export const dynamic = 'force-dynamic'

export default async function ArticlePage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const identity = await getIdentity()
  if (!identity) return <NoIdentity title="Article" />

  const { id } = await params
  // Another account's article is a 404, the same as one that does not exist.
  const article = isUuid(id)
    ? await loadArticleForEditor(identity.id, id)
    : null
  if (!article) notFound()

  return (
    // Remounted when a generation lands or an earlier version is restored,
    // so the editor (which loads its content once) shows the new text.
    <ArticleEditor
      key={`${article.id}:${article.generationCount}:${article.generationStatus}:${article.previousVersionAt ?? ''}`}
      article={article}
      authorName={identity.name}
      authorHeadline={identity.headline}
    />
  )
}
