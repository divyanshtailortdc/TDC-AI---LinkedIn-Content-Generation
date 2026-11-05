'use client'

import { Pagination } from '@/components/pagination'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { formatAbsoluteDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { INBOX_PATH } from '@/lib/inbox-path'
import {
  MAX_NEWSLETTER_QUERY_LENGTH,
  NEWSLETTER_KNOWLEDGE_PATH
} from '@/lib/knowledge-path'
import type { PageInfo } from '@/lib/pagination'
import { ExternalLink, Loader2, Newspaper, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { StoryUse } from '~/lib/intel/status'
import { changeStoryUse } from './newsletter-actions'
import type { KnowledgeStory } from './newsletter-data'

/** Reading speed for "5 min read". */
const WORDS_PER_MINUTE = 230

const STATUS_TONE = {
  used: 'bg-accent/10 text-accent',
  kept: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  unused: 'bg-surface-hover text-muted'
} as const

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

/** Whether ideas use the story now, and why not when they do not. */
function ideasStatus(
  story: Pick<KnowledgeStory, 'sponsored' | 'unsubscribed' | 'freshUntil'>,
  use: StoryUse,
  /** Null until mounted: the server's clock and the browser's may differ. */
  now: Date | null
): { label: string; tone: keyof typeof STATUS_TONE } {
  if (use === 'never') return { label: 'Not used for ideas', tone: 'unused' }
  if (use === 'keep')
    return { label: 'Kept: used for ideas when relevant', tone: 'kept' }
  if (story.sponsored)
    return { label: 'Sponsored: not used for ideas', tone: 'unused' }
  if (story.unsubscribed)
    return { label: 'Unsubscribed: not used for ideas', tone: 'unused' }
  if (now && now > story.freshUntil)
    return { label: 'No longer recent: not used for ideas', tone: 'unused' }
  return {
    label: now
      ? `Used for ideas when relevant, until ${formatAbsoluteDate(story.freshUntil)}`
      : 'Used for ideas when relevant',
    tone: 'used'
  }
}

/**
 * The Knowledge base's "From newsletters" view: every story the identity's
 * newsletters covered, newest first, with what was read of each article.
 * Nothing needs saving: ideas use a story automatically while it is recent
 * and relevant. Keep and Don't use are the exceptions. Search and paging are
 * in the URL and loaded on the server.
 */
export function NewsletterKnowledge({
  stories,
  pageInfo,
  query
}: {
  stories: KnowledgeStory[]
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
        q
          ? `${NEWSLETTER_KNOWLEDGE_PATH}&q=${encodeURIComponent(q)}`
          : NEWSLETTER_KNOWLEDGE_PATH
      )
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-muted text-sm leading-relaxed">
        Stories from the newsletters you receive, added automatically. Ideas use
        a story while it is recent and relevant to a goal; nothing needs saving.{' '}
        <span className="text-foreground font-medium">Keep</span> one to use it
        for longer, or mark it{' '}
        <span className="text-foreground font-medium">Don&apos;t use</span>.
      </p>

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
            maxLength={MAX_NEWSLETTER_QUERY_LENGTH}
            placeholder="Search stories and articles"
            aria-label="Search newsletter stories"
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
        <EmptyNewsletters query={query} />
      ) : (
        <ul className="space-y-3">
          {stories.map(story => (
            <StoryCard key={story.id} story={story} hasMounted={hasMounted} />
          ))}
        </ul>
      )}

      <Pagination
        {...pageInfo}
        noun="stories"
        query={
          query ? { view: 'newsletters', q: query } : { view: 'newsletters' }
        }
      />
    </div>
  )
}

function EmptyNewsletters({ query }: { query: string }) {
  return (
    <div className="text-muted flex flex-col items-center px-4 py-14 text-center text-sm leading-relaxed">
      <Newspaper aria-hidden className="mb-3 h-6 w-6 opacity-60" />
      {query ? (
        <>No stories match “{query}”.</>
      ) : (
        <p>
          No stories yet. They are added here as newsletters arrive in your{' '}
          <Link href={INBOX_PATH} className="text-foreground underline">
            Inbox
          </Link>
          .
        </p>
      )}
    </div>
  )
}

/** Whether ideas use the story, with Keep and Don't use. */
function IdeasUse({
  story,
  hasMounted
}: {
  story: KnowledgeStory
  hasMounted: boolean
}) {
  const [use, setUse] = useState(story.use)
  const [changing, startChange] = useTransition()
  const status = ideasStatus(story, use, hasMounted ? new Date() : null)

  const change = (next: StoryUse) =>
    startChange(async () => {
      const previous = use
      setUse(next)
      const res = await changeStoryUse(story.id, next).catch(() => null)
      if (!res?.success) {
        setUse(previous)
        showToast({
          type: 'error',
          title: 'Could not change it',
          message: res?.error ?? 'Please try again.'
        })
      }
    })

  const button =
    'border-border text-foreground hover:bg-surface-hover inline-flex h-6 cursor-pointer items-center rounded-md border px-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:bg-surface-hover'
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span
        className={cn(
          'rounded-full px-2 py-0.5 font-medium',
          STATUS_TONE[status.tone]
        )}
      >
        {status.label}
      </span>
      <button
        type="button"
        aria-pressed={use === 'keep'}
        disabled={changing}
        onClick={() => change(use === 'keep' ? 'auto' : 'keep')}
        title="Use it for ideas after it stops being recent"
        className={button}
      >
        {use === 'keep' ? 'Kept' : 'Keep'}
      </button>
      <button
        type="button"
        aria-pressed={use === 'never'}
        disabled={changing}
        onClick={() => change(use === 'never' ? 'auto' : 'never')}
        title="Never use it for ideas"
        className={button}
      >
        {use === 'never' ? 'Use again' : "Don't use"}
      </button>
    </div>
  )
}

function StoryCard({
  story,
  hasMounted
}: {
  story: KnowledgeStory
  hasMounted: boolean
}) {
  const { article } = story
  const host = hostOf(story.url)

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
      </div>

      <h2 className="text-foreground text-[15px] leading-snug font-semibold break-words">
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

      <IdeasUse story={story} hasMounted={hasMounted} />

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
