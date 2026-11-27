'use client'

import { buttonClassName } from '@/components/button'
import { PageHeader } from '@/components/page-header'
import { FIELD_CLASS } from '@/components/ui/field'
import { FilterChips } from '@/components/ui/filter-chips'
import { TruncatedText } from '@/components/ui/tooltip'
import { BLOG_KIND_LABELS } from '@/lib/blogs/types'
import { cn } from '@/lib/cn'
import { formatAbsoluteDate, formatRelativeDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import {
  AlertCircle,
  ChevronRight,
  Clock,
  FileText,
  Globe,
  Newspaper,
  Plus,
  Search,
  Tag,
  Type
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { BlogStatusChip } from './blog-status'
import type { BlogListItem } from './blogs-data'

/** How often the list looks again while a blog is being written. */
const REFRESH_MS = 5000

type Show = 'all' | 'writing' | 'draft' | 'published' | 'failed'

/** Which of the list's filters a blog falls under. */
function shownAs(blog: BlogListItem): Exclude<Show, 'all'> {
  if (blog.generationStatus === 'generating' && !blog.stale) return 'writing'
  if (blog.generationStatus === 'failed' && blog.wordCount === 0) return 'failed'
  if (blog.status === 'published') return 'published'
  return 'draft'
}

const SHOW_LABELS: Record<Show, string> = {
  all: 'All',
  writing: 'Writing',
  draft: 'Drafts',
  published: 'Published',
  failed: 'Failed'
}

export function BlogsClient({ blogs }: { blogs: BlogListItem[] }) {
  const router = useRouter()
  const [show, setShow] = useState<Show>('all')
  const [query, setQuery] = useState('')
  const writing = blogs.some(
    blog => blog.generationStatus === 'generating' && !blog.stale
  )
  useEffect(() => {
    if (!writing) return
    const timer = setInterval(() => router.refresh(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [writing, router])

  const counts = useMemo(() => {
    const result: Record<Show, number> = {
      all: blogs.length,
      writing: 0,
      draft: 0,
      published: 0,
      failed: 0
    }
    for (const blog of blogs) result[shownAs(blog)] += 1
    return result
  }, [blogs])

  const needle = query.trim().toLowerCase()
  const visible = blogs.filter(
    blog =>
      (show === 'all' || shownAs(blog) === show) &&
      (!needle ||
        [blog.title, blog.topic, blog.primaryKeyword].some(text =>
          text.toLowerCase().includes(needle)
        ))
  )
  // Filters with nothing under them are left out, except the one picked.
  const filters = (Object.keys(SHOW_LABELS) as Show[]).filter(
    key => key === 'all' || key === show || counts[key] > 0
  )

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
          <div className="mx-auto max-w-5xl space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <FilterChips
                label="Show blogs by status"
                value={show}
                onChange={setShow}
                options={filters.map(key => ({
                  value: key,
                  label: SHOW_LABELS[key],
                  count: counts[key]
                }))}
              />
              <label className="relative block w-full sm:w-72">
                <span className="sr-only">Search blogs</span>
                <Search
                  aria-hidden
                  className="text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                />
                <input
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Search by title, topic or keyword"
                  className={cn(FIELD_CLASS, 'bg-surface h-9 py-1.5 pl-9')}
                />
              </label>
            </div>
            {visible.length === 0 ? (
              <div className="border-border bg-surface text-muted rounded-2xl border border-dashed px-6 py-12 text-center text-sm">
                Nothing matches
                {needle ? (
                  <>
                    {' '}
                    “<span className="text-foreground">{query.trim()}</span>”
                  </>
                ) : null}
                {show !== 'all' ? ` in ${SHOW_LABELS[show].toLowerCase()}` : ''}
                .
              </div>
            ) : (
              <ul className="space-y-3">
                {visible.map(blog => (
                  <BlogRow key={blog.id} blog={blog} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function BlogRow({ blog }: { blog: BlogListItem }) {
  const mounted = useHasMounted()
  const writing = blog.generationStatus === 'generating' && !blog.stale
  const heading = blog.title || blog.topic
  const failed = blog.generationStatus === 'failed' && blog.generationError
  const KindIcon = blog.kind === 'article' ? Newspaper : FileText
  return (
    <li>
      <Link
        href={`/blogs/${blog.id}`}
        className="group border-border bg-surface hover:border-brand/40 focus-visible:ring-brand/30 flex items-start gap-3 rounded-2xl border p-4 shadow-xs transition-[border-color,box-shadow] hover:shadow-md focus-visible:ring-3 focus-visible:outline-none sm:gap-4 sm:p-5"
      >
        <span
          className={cn(
            'hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex',
            writing ? 'bg-brand/10 text-brand' : 'bg-surface-hover text-muted'
          )}
        >
          <KindIcon aria-hidden className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="border-border text-foreground rounded-full border px-2 py-0.5 text-[11px] font-semibold">
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
            <span className="text-muted ml-auto inline-flex items-center gap-1 text-xs">
              <Clock aria-hidden className="h-3 w-3" />
              {mounted ? `Updated ${formatRelativeDate(blog.updatedAt)}` : ''}
            </span>
          </div>
          <h2 className="text-foreground group-hover:text-brand-strong mt-2 text-base leading-snug font-semibold transition-colors">
            <TruncatedText
              lines={2}
              text={writing && !blog.title ? `Writing: ${heading}` : heading}
            />
          </h2>
          <div className="text-muted mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {blog.wordCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Type aria-hidden className="h-3 w-3" />
                {blog.wordCount.toLocaleString('en-US')} words
              </span>
            )}
            {blog.primaryKeyword && (
              <span className="inline-flex max-w-full min-w-0 items-center gap-1">
                <Tag aria-hidden className="h-3 w-3 shrink-0" />
                <span className="sr-only">Keyword: </span>
                <TruncatedText
                  text={blog.primaryKeyword}
                  className="max-w-[16rem] sm:max-w-xs"
                />
              </span>
            )}
            {blog.status === 'published' && blog.publishedAt && mounted && (
              <span className="inline-flex items-center gap-1">
                <Globe aria-hidden className="h-3 w-3" />
                Published {formatAbsoluteDate(blog.publishedAt)}
              </span>
            )}
          </div>
          {failed && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-400">
              <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {blog.generationError}
              </span>
            </p>
          )}
        </div>
        <ChevronRight
          aria-hidden
          className="text-muted group-hover:text-foreground mt-1 hidden h-4 w-4 shrink-0 transition-[color,translate] group-hover:translate-x-0.5 sm:block"
        />
      </Link>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="border-border bg-surface mx-auto mt-8 max-w-md rounded-2xl border-2 border-dashed p-10 text-center">
      <div className="bg-brand/10 mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
        <FileText aria-hidden className="text-brand h-7 w-7" />
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
