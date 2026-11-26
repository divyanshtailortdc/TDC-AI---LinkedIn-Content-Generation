'use client'

import { buttonClassName } from '@/components/button'
import { PageHeader } from '@/components/page-header'
import { BLOG_KIND_LABELS } from '@/lib/blogs/types'
import { formatAbsoluteDate, formatRelativeDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { FileText, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { BlogStatusChip } from './blog-status'
import type { BlogListItem } from './blogs-data'

/** How often the list looks again while a blog is being written. */
const REFRESH_MS = 5000

export function BlogsClient({ blogs }: { blogs: BlogListItem[] }) {
  const router = useRouter()
  const writing = blogs.some(
    blog => blog.generationStatus === 'generating' && !blog.stale
  )
  useEffect(() => {
    if (!writing) return
    const timer = setInterval(() => router.refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [writing, router])

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Blogs & Articles"
        description="Long-form, SEO-ready pieces for your own website"
        actions={
          <Link href="/blogs/new" className={buttonClassName({ size: 'sm' })}>
            <Plus aria-hidden className="h-4 w-4" />
            New blog or article
          </Link>
        }
      />
      <div className="bg-background flex-1 overflow-y-auto p-4 sm:p-6">
        {blogs.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="mx-auto max-w-5xl space-y-3">
            {blogs.map(blog => (
              <BlogRow key={blog.id} blog={blog} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function BlogRow({ blog }: { blog: BlogListItem }) {
  const mounted = useHasMounted()
  const writing = blog.generationStatus === 'generating' && !blog.stale
  const heading = blog.title || blog.topic
  return (
    <li>
      <Link
        href={`/blogs/${blog.id}`}
        className="border-border bg-surface hover:border-brand/40 hover:bg-surface-hover/40 block rounded-2xl border p-4 shadow-xs transition-colors sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-accent/10 text-foreground rounded-full px-2 py-0.5 text-[11px] font-semibold">
            {BLOG_KIND_LABELS[blog.kind]}
          </span>
          <BlogStatusChip
            status={blog.status}
            generationStatus={blog.generationStatus}
            generationStage={blog.generationStage}
            stale={blog.stale}
            hasText={blog.wordCount > 0}
            publishedTo={blog.publishedTo}
          />
          <span className="text-muted ml-auto text-xs">
            {mounted ? `Updated ${formatRelativeDate(blog.updatedAt)}` : ''}
          </span>
        </div>
        <h2 className="text-foreground mt-2 line-clamp-2 text-base font-semibold">
          {writing && !blog.title ? `Writing: ${heading}` : heading}
        </h2>
        <p className="text-muted mt-1 text-xs">
          {[
            blog.wordCount > 0
              ? `${blog.wordCount.toLocaleString('en-US')} words`
              : null,
            blog.primaryKeyword ? `Keyword: ${blog.primaryKeyword}` : null,
            blog.status === 'published' && blog.publishedAt && mounted
              ? `Published ${formatAbsoluteDate(blog.publishedAt)}`
              : null,
            blog.generationStatus === 'failed' && blog.generationError
              ? blog.generationError
              : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </Link>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="border-border bg-surface mx-auto mt-8 max-w-md rounded-2xl border-2 border-dashed p-10 text-center">
      <div className="bg-accent/10 mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
        <FileText aria-hidden className="text-accent h-7 w-7" />
      </div>
      <h2 className="text-foreground mb-2 text-lg font-semibold">
        No blogs or articles yet
      </h2>
      <p className="text-muted mb-8 text-sm leading-relaxed">
        Give a topic and a keyword, and get a researched, SEO-ready piece in
        your own voice, with its sources cited, ready to edit and paste into
        your website.
      </p>
      <Link href="/blogs/new" className={buttonClassName({ size: 'sm' })}>
        <Plus aria-hidden className="h-4 w-4" />
        New blog or article
      </Link>
    </div>
  )
}
