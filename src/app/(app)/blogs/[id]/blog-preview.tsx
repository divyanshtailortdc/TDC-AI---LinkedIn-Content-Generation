import { blogArticleHtml } from '@/lib/blogs/render'
import type { BlogContent } from '@/lib/blogs/types'
import { SearchResult } from './seo-panel'

/**
 * The blog as a reader will see it: how it shows in search results, then
 * the article with its FAQ and sources, exactly as the exports build it.
 */
export function BlogPreview({
  blog,
  site,
  diagramColor
}: {
  blog: BlogContent
  /** The identity's site for the search preview. */
  site: string | null
  /** The brand colour diagrams are drawn in. */
  diagramColor?: string
}) {
  return (
    <div className="space-y-4">
      <section aria-label="In search results">
        <h2 className="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">
          In search results
        </h2>
        <SearchResult edit={blog} site={site} />
      </section>
      <div className="border-border bg-surface rounded-2xl border px-5 py-8 shadow-xs sm:px-12 sm:py-10">
        <article
          className="blog-doc"
          // Built by blogArticleHtml from validated document JSON, every text escaped.
          dangerouslySetInnerHTML={{
            __html: blogArticleHtml(blog, { newTab: true, diagramColor })
          }}
        />
      </div>
    </div>
  )
}
