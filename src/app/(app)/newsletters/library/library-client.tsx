'use client'

import { Button } from '@/components/button'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { showToast } from '@/components/toast-notification'
import { formatAbsoluteDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { INBOX_PATH } from '@/lib/inbox-path'
import { LIBRARY_PATH, MAX_LIBRARY_QUERY_LENGTH } from '@/lib/library-path'
import type { PageInfo } from '@/lib/pagination'
import { BookOpen, Check, ExternalLink, Loader2, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveToKnowledge } from './actions'
import type { LibraryStory } from './library-data'

/** Reading speed for "5 min read". */
const WORDS_PER_MINUTE = 230

function hostOf(url: string | null) {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const isWebUrl = (url: string | null): url is string =>
  !!url && /^https?:\/\//i.test(url)

/**
 * The newsletter library: every story the identity's newsletters covered,
 * newest first, with what was read of each article. Search and paging are in
 * the URL and loaded on the server. A story worth keeping can be saved to the
 * Knowledge base, which every run reads as the account's own material.
 */
export function LibraryClient({
  stories,
  pageInfo,
  query
}: {
  stories: LibraryStory[]
  pageInfo: PageInfo
  /** The search the page was loaded with (?q=). */
  query: string
}) {
  const router = useRouter()
  const hasMounted = useHasMounted()
  const [navigating, startNavigation] = useTransition()

  const search = (value: string) => {
    const q = value.trim()
    startNavigation(() => {
      router.push(
        q ? `${LIBRARY_PATH}?q=${encodeURIComponent(q)}` : LIBRARY_PATH
      )
    })
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <PageHeader
        title="Library"
        description="Stories and articles from the newsletters you receive. Save the ones you trust to your Knowledge base."
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 sm:px-6">
          <form
            key={query}
            role="search"
            onSubmit={e => {
              e.preventDefault()
              search(String(new FormData(e.currentTarget).get('q') ?? ''))
            }}
            className="flex items-center gap-2"
          >
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden
                className="text-muted pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2"
              />
              <input
                name="q"
                type="search"
                defaultValue={query}
                maxLength={MAX_LIBRARY_QUERY_LENGTH}
                placeholder="Search stories and articles"
                aria-label="Search the library"
                className="border-border bg-surface text-foreground placeholder:text-muted focus-visible:ring-foreground/30 h-9 w-full rounded-lg border pr-3 pl-8.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
            {navigating ? (
              <Loader2
                aria-label="Loading"
                className="text-muted h-4 w-4 animate-spin"
              />
            ) : (
              query && (
                <button
                  type="button"
                  onClick={() => search('')}
                  className="text-muted hover:text-foreground flex shrink-0 cursor-pointer items-center gap-1 text-xs font-medium"
                >
                  <X aria-hidden className="h-3 w-3" />
                  Clear
                </button>
              )
            )}
          </form>

          {stories.length === 0 ? (
            <EmptyLibrary query={query} />
          ) : (
            <ul className="space-y-3">
              {stories.map(story => (
                <StoryCard
                  key={story.id}
                  story={story}
                  hasMounted={hasMounted}
                />
              ))}
            </ul>
          )}

          <Pagination
            {...pageInfo}
            noun="stories"
            query={query ? { q: query } : {}}
          />
        </div>
      </div>
    </div>
  )
}

function EmptyLibrary({ query }: { query: string }) {
  return (
    <div className="text-muted flex flex-col items-center px-4 py-16 text-center text-sm leading-relaxed">
      <BookOpen aria-hidden className="mb-3 h-6 w-6 opacity-60" />
      {query ? (
        <>No stories match “{query}”.</>
      ) : (
        <p>
          No stories yet. They appear here as newsletters arrive in your{' '}
          <Link href={INBOX_PATH} className="text-foreground underline">
            Inbox
          </Link>
          .
        </p>
      )}
    </div>
  )
}

function StoryCard({
  story,
  hasMounted
}: {
  story: LibraryStory
  hasMounted: boolean
}) {
  const [saved, setSaved] = useState(story.saved)
  const [saving, startSaving] = useTransition()
  const { article } = story
  const host = hostOf(story.url)

  const save = () =>
    startSaving(async () => {
      const res = await saveToKnowledge(story.id).catch(() => null)
      if (res?.success) {
        setSaved(true)
        showToast({
          type: 'success',
          title: 'Saved to your Knowledge base',
          message: article?.title ?? story.headline
        })
      } else {
        showToast({
          type: 'error',
          title: 'Could not save it',
          message: res?.error ?? 'Please try again.'
        })
      }
    })

  return (
    <li className="border-border bg-surface space-y-2 rounded-xl border px-4 py-3.5">
      <div className="text-muted flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="text-foreground font-medium">{story.newsletter}</span>
        {hasMounted && <span>{formatAbsoluteDate(story.receivedAt)}</span>}
        {story.sponsored && (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
            Sponsored
          </span>
        )}
        {story.unsubscribed && (
          <span className="bg-surface-hover rounded-full px-1.5 py-0.5 text-[10px] font-semibold">
            Unsubscribed · not used for ideas
          </span>
        )}
      </div>

      <div className="flex items-start gap-3">
        <h2 className="text-foreground min-w-0 flex-1 text-[15px] leading-snug font-semibold break-words">
          {isWebUrl(story.url) ? (
            <a
              href={story.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {story.headline}
              <ExternalLink
                aria-label="(opens in a new tab)"
                className="text-muted ml-1 inline h-3 w-3 align-baseline"
              />
            </a>
          ) : (
            story.headline
          )}
        </h2>
        {article?.status === 'done' &&
          (saved ? (
            <span className="text-muted inline-flex shrink-0 items-center gap-1 text-xs font-medium">
              <Check aria-hidden className="h-3.5 w-3.5 text-emerald-600" />
              In Knowledge base
            </span>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={save}
              loading={saving}
            >
              Save to Knowledge base
            </Button>
          ))}
      </div>

      {story.blurb && (
        <p className="text-muted text-sm leading-relaxed break-words">
          {story.blurb}
        </p>
      )}

      {article?.status === 'done' ? (
        <div className="border-border space-y-1.5 border-l-2 pl-3">
          <p className="text-muted text-[11px]">
            {[
              article.siteName ?? host,
              article.author,
              article.publishedAt && hasMounted
                ? formatAbsoluteDate(article.publishedAt)
                : null,
              article.wordCount
                ? `${Math.max(1, Math.round(article.wordCount / WORDS_PER_MINUTE))} min read`
                : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {article.summary && (
            <p className="text-foreground/90 text-xs leading-relaxed break-words">
              {article.summary}
            </p>
          )}
          {article.claims.length > 0 && (
            <ul className="text-muted list-disc space-y-0.5 pl-4 text-xs break-words">
              {article.claims.map((claim, i) => (
                <li key={i}>{claim}</li>
              ))}
            </ul>
          )}
          {article.topics.length > 0 && (
            <ul aria-label="Topics" className="flex flex-wrap gap-1.5 pt-0.5">
              {article.topics.map(topic => (
                <li
                  key={topic}
                  className="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-[11px] font-medium"
                >
                  {topic}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : article?.status === 'pending' || article?.status === 'processing' ? (
        <p className="text-muted flex items-center gap-1.5 text-[11px]">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          Reading the article{host ? ` on ${host}` : ''}…
        </p>
      ) : article ? (
        <p className="text-muted text-[11px] break-words">
          Could not read the article{host ? ` on ${host}` : ''}
          {article.note ? `: ${article.note}` : '.'}
        </p>
      ) : (
        host && <p className="text-muted text-[11px]">{host}</p>
      )}
    </li>
  )
}
