'use client'

import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { cn } from '@/lib/cn'
import { formatRelativeDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import type { PageInfo } from '@/lib/pagination'
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Lightbulb,
  Loader2,
  Newspaper
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect } from 'react'
import type { ArticleListItem } from './articles-data'

/** While any article is being written, the list refreshes this often. */
const REFRESH_MS = 6000

const STATUS = {
  generating: {
    label: 'Writing…',
    className: 'bg-blue-500/10 text-blue-700 dark:text-blue-400'
  },
  failed: {
    label: 'Failed',
    className: 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
  },
  draft: {
    label: 'Draft',
    className: 'bg-surface-hover text-muted'
  },
  published: {
    label: 'Published',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
  }
} as const

/** The identity's articles, newest activity first. */
export function ArticlesClient({
  articles,
  pageInfo,
  identityName
}: {
  articles: ArticleListItem[]
  pageInfo: PageInfo
  identityName: string
}) {
  const router = useRouter()
  const mounted = useHasMounted()
  const anyGenerating = articles.some(a => a.generationStatus === 'generating')

  useEffect(() => {
    if (!anyGenerating) return
    const t = setInterval(
      () => startTransition(() => router.refresh()),
      REFRESH_MS
    )
    return () => clearInterval(t)
  }, [anyGenerating, router])

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Articles"
        description={`Long-form articles written from ${identityName}'s approved ideas`}
        actions={
          <Link
            href="/ideas?status=approved"
            className="border-accent/30 text-accent hover:bg-accent/10 inline-flex h-8 items-center gap-1.5 rounded-lg border px-3.5 text-[13px] font-semibold transition-colors"
          >
            <Lightbulb className="h-3.5 w-3.5" />
            Approved ideas
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 sm:px-6 sm:pb-8">
        {articles.length === 0 ? (
          <div className="border-border bg-surface rounded-2xl border-2 border-dashed p-12 text-center">
            <Newspaper className="text-muted mx-auto mb-3 h-8 w-8" />
            <h2 className="text-foreground text-sm font-semibold">
              No articles yet
            </h2>
            <p className="text-muted mx-auto mt-1 mb-5 max-w-sm text-xs leading-relaxed">
              On the Ideas page, choose Generate Article on an approved idea.
              The same idea can also become a post.
            </p>
            <Link
              href="/ideas?status=approved"
              className="bg-accent text-background hover:bg-accent-hover inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold"
            >
              Go to approved ideas
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {articles.map(article => {
              const badge =
                article.generationStatus === 'generating'
                  ? STATUS.generating
                  : article.generationStatus === 'failed'
                    ? STATUS.failed
                    : STATUS[article.status]
              return (
                <li key={article.id}>
                  <Link
                    href={`/articles/${article.id}`}
                    className="border-border bg-surface hover:border-foreground/15 group flex items-start gap-4 rounded-2xl border p-4 shadow-xs transition-colors sm:p-5"
                  >
                    <span className="bg-surface-hover text-muted mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:flex">
                      {article.generationStatus === 'generating' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : article.generationStatus === 'failed' ? (
                        <AlertTriangle className="h-5 w-5 text-rose-600" />
                      ) : article.status === 'published' ? (
                        <CircleCheck className="h-5 w-5 text-emerald-600" />
                      ) : (
                        <Newspaper className="h-5 w-5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="text-foreground line-clamp-2 flex-1 text-base leading-snug font-semibold">
                          {article.title ||
                            article.ideaTitle ||
                            'Untitled article'}
                        </span>
                        <span
                          className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
                            badge.className
                          )}
                        >
                          {badge.label}
                        </span>
                      </span>
                      {article.subtitle && (
                        <span className="text-muted mt-1 line-clamp-2 block text-sm leading-relaxed">
                          {article.subtitle}
                        </span>
                      )}
                      <span className="text-muted mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        {article.wordCount > 0 && (
                          <span className="tabular-nums">
                            {article.wordCount.toLocaleString()} words
                          </span>
                        )}
                        {article.ideaTitle && (
                          <span className="min-w-0 truncate">
                            Idea: {article.ideaTitle}
                          </span>
                        )}
                        {mounted && (
                          <span>
                            Updated {formatRelativeDate(article.updatedAt)}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        <div className="pt-4">
          <Pagination {...pageInfo} noun="articles" />
        </div>
      </div>
    </div>
  )
}
