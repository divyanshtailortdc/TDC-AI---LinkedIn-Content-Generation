'use client'

import { Button } from '@/components/button'
import { FormAlert } from '@/components/form-alert'
import { Pagination } from '@/components/pagination'
import { formatAbsoluteDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import { ChevronDown, ExternalLink, Loader2, Sparkles } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition
} from 'react'
import type { DigestKind } from '~/lib/intel/status'
import {
  getInboxInsights,
  retryInboxInsights,
  setInboxSenderUnsubscribed
} from './actions'
import type { InboxInsights, InboxStory } from './inbox-data'

const POLL_MS = 4000
/** Polling stops after this (5 minutes); opening the email again checks again. */
const MAX_POLLS = 75

const KIND_LABELS: Record<DigestKind, string> = {
  newsletter: 'a newsletter',
  promotion: 'a promotional email',
  transactional: 'a confirmation or account email',
  other: 'not a newsletter'
}

function isWorking(insights: InboxInsights) {
  return (
    insights.status === 'pending' ||
    insights.status === 'processing' ||
    insights.stories.some(
      story =>
        story.article?.status === 'pending' ||
        story.article?.status === 'processing'
    )
  )
}

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
 * What extraction found in an email (src/lib/intel): a summary, topics, and
 * its stories with their links and what was read of each article. Above the
 * email in the reading pane; it checks again every few seconds while the
 * email or its articles are still being read.
 */
export function EmailInsights({ messageId }: { messageId: string }) {
  const hasMounted = useHasMounted()
  const [insights, setInsights] = useState<InboxInsights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retrying, startRetry] = useTransition()
  const [changingSender, startSenderChange] = useTransition()
  // The email's stories, a page at a time (an email can carry 25).
  const [storyPage, setStoryPage] = useState(1)
  const storyListRef = useRef<HTMLOListElement>(null)

  const show = useCallback(
    (res: Awaited<ReturnType<typeof getInboxInsights>> | null) => {
      if (res?.success) {
        setInsights(res.insights)
        setError(null)
      } else {
        setError(res?.error ?? 'Could not load what was found in this email.')
      }
    },
    []
  )
  const check = useCallback(
    () => getInboxInsights(messageId).catch(() => null),
    [messageId]
  )

  useEffect(() => {
    let current = true
    void check().then(res => {
      if (current) show(res)
    })
    return () => {
      current = false
    }
  }, [check, show])

  const working = insights ? isWorking(insights) : false
  useEffect(() => {
    if (!working) return
    let polls = 0
    const timer = setInterval(() => {
      if (++polls > MAX_POLLS) return clearInterval(timer)
      if (document.visibilityState === 'visible') void check().then(show)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [working, check, show])

  const retry = () =>
    startRetry(async () => {
      const res = await retryInboxInsights(messageId).catch(() => null)
      if (res?.success) show(await check())
      else setError(res?.error ?? 'Could not try again.')
    })

  const changeSender = (unsubscribed: boolean) =>
    startSenderChange(async () => {
      const res = await setInboxSenderUnsubscribed(
        messageId,
        unsubscribed
      ).catch(() => null)
      if (res?.success) show(await check())
      else setError(res?.error ?? 'Could not save that.')
    })

  if (!insights) {
    return error ? <p className="text-muted text-xs">{error}</p> : null
  }

  const { status, kind, summary, topics, stories, newerVersion } = insights
  const { rows: pageStories, pageInfo: storyPageInfo } = paginate(
    stories,
    storyPage,
    PAGE_SIZE
  )
  return (
    <details
      open
      className="group border-border bg-surface rounded-xl border px-4 py-3"
    >
      <summary className="text-foreground flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <Sparkles aria-hidden className="text-accent h-4 w-4 shrink-0" />
        Found in this email
        {stories.length > 0 && (
          <span className="text-muted font-normal">
            · {stories.length} {stories.length === 1 ? 'story' : 'stories'}
          </span>
        )}
        <ChevronDown
          aria-hidden
          className="text-muted ml-auto h-4 w-4 transition-transform group-open:rotate-180"
        />
      </summary>

      <div className="mt-3 space-y-3">
        {(status === 'pending' || status === 'processing') && (
          <p className="text-muted flex items-center gap-2 text-xs">
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
            {/* Waiting to try again after a failure that may pass. */}
            {status === 'pending' && insights.error
              ? `${insights.error} Trying again automatically.`
              : 'Reading this email for its stories and links…'}
          </p>
        )}

        {status === 'failed' && (
          <FormAlert variant="error">
            <span className="block">
              Could not read this email.{' '}
              {insights.error ?? 'Something went wrong.'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={retry}
              loading={retrying}
            >
              Try again
            </Button>
          </FormAlert>
        )}

        {status === 'done' && (
          <>
            {summary && (
              <p className="text-foreground text-sm leading-relaxed">
                {summary}
              </p>
            )}
            {topics.length > 0 && (
              <ul aria-label="Topics" className="flex flex-wrap gap-1.5">
                {topics.map(topic => (
                  <li
                    key={topic}
                    className="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-[11px] font-medium"
                  >
                    {topic}
                  </li>
                ))}
              </ul>
            )}
            {newerVersion && (
              <p className="text-muted text-xs">
                A newer version of this issue arrived
                {hasMounted &&
                  ` on ${formatAbsoluteDate(newerVersion.receivedAt)}`}
                {newerVersion.subject ? `: “${newerVersion.subject}”` : ''}. The
                stories it repeats are listed with it.
              </p>
            )}
            {stories.length === 0 ? (
              // An older version whose stories all moved says so above.
              !newerVersion && (
                <p className="text-muted text-xs">
                  {/* A reason it was not read (an unsubscribed sender). */}
                  {insights.error ??
                    (kind && kind !== 'newsletter'
                      ? `This looks like ${KIND_LABELS[kind]}, so no stories were taken from it.`
                      : 'No stories with links were found in this email.')}
                </p>
              )
            ) : (
              <>
                <ol ref={storyListRef} className="space-y-3">
                  {pageStories.map((story, i) => (
                    <Story
                      key={story.id}
                      story={story}
                      number={
                        (storyPageInfo.page - 1) * storyPageInfo.pageSize +
                        i +
                        1
                      }
                      hasMounted={hasMounted}
                    />
                  ))}
                </ol>
                <Pagination
                  {...storyPageInfo}
                  noun="stories"
                  onPageChange={setStoryPage}
                  scrollTarget={storyListRef}
                />
              </>
            )}
          </>
        )}
        {insights.sender && (
          <SenderSubscription
            sender={insights.sender}
            saving={changingSender}
            onChange={changeSender}
          />
        )}
        {error && <p className="text-muted text-xs">{error}</p>}
      </div>
    </details>
  )
}

/**
 * "I unsubscribed from this sender", or Undo. Unsubscribing deletes nothing:
 * the stories stay in the Knowledge base, but ideas stop using them and new mail
 * from the sender is not read (setSenderUnsubscribed).
 */
function SenderSubscription({
  sender,
  saving,
  onChange
}: {
  sender: { address: string; unsubscribed: boolean }
  saving: boolean
  onChange: (unsubscribed: boolean) => void
}) {
  return (
    <div className="border-border flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t pt-3">
      <p className="text-muted min-w-0 flex-1 text-xs break-words">
        {sender.unsubscribed
          ? `You unsubscribed from ${sender.address}. Its stories stay in your Knowledge base but are not used for ideas, and new emails from it are not read.`
          : `Unsubscribed from ${sender.address}? Its stories stay in your Knowledge base but stop being used for ideas.`}
      </p>
      <Button
        variant="secondary"
        size="sm"
        loading={saving}
        onClick={() => onChange(!sender.unsubscribed)}
      >
        {sender.unsubscribed ? 'Undo' : 'I unsubscribed'}
      </Button>
    </div>
  )
}

function Story({
  story,
  number,
  hasMounted
}: {
  story: InboxStory
  number: number
  hasMounted: boolean
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="text-muted mt-0.5 w-4 shrink-0 text-right text-xs tabular-nums">
        {number}.
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-foreground text-sm font-medium break-words">
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
          {story.sponsored && (
            <span className="ml-2 rounded-full bg-amber-500/10 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              Sponsored
            </span>
          )}
        </p>
        {story.blurb && (
          <p className="text-muted text-xs leading-relaxed break-words">
            {story.blurb}
          </p>
        )}
        <ArticleInfo story={story} hasMounted={hasMounted} />
      </div>
    </li>
  )
}

function ArticleInfo({
  story,
  hasMounted
}: {
  story: InboxStory
  hasMounted: boolean
}) {
  const { article } = story
  const host = hostOf(story.url)
  if (!article) {
    return host ? <p className="text-muted text-[11px]">{host}</p> : null
  }
  if (article.status === 'pending' || article.status === 'processing') {
    return (
      <p className="text-muted flex items-center gap-1.5 text-[11px]">
        <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
        Reading the article{host ? ` on ${host}` : ''}…
      </p>
    )
  }
  if (article.status === 'skipped' || article.status === 'failed') {
    return (
      <p className="text-muted text-[11px] break-words">
        Could not read the article{host ? ` on ${host}` : ''}
        {article.note ? `: ${article.note}` : '.'}
      </p>
    )
  }
  return (
    <div className="border-border space-y-1 border-l-2 pl-3">
      <p className="text-muted text-[11px]">
        {article.siteName ?? host}
        {article.publishedAt &&
          hasMounted &&
          ` · ${formatAbsoluteDate(article.publishedAt)}`}
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
    </div>
  )
}
