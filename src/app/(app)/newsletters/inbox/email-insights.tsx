'use client'

import { Button } from '@/components/button'
import { Pagination } from '@/components/pagination'
import { ProgressBar } from '@/components/ui/meter'
import { StatusChip } from '@/components/ui/status-chip'
import { TimeAgo } from '@/components/ui/time-ago'
import { FOCUS_RING, TONES, type Tone } from '@/components/ui/tone'
import { cn } from '@/lib/cn'
import { formatAbsoluteDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { PAGE_SIZE, paginate } from '@/lib/pagination'
import { ChevronDown, ExternalLink, Info, Sparkles } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode
} from 'react'
import { InfoTip } from '@/components/ui/info-tip'
import {
  getInboxInsights,
  retryInboxInsights,
  setInboxSenderUnsubscribed
} from './actions'
import type { InboxInsights, InboxStory } from './inbox-data'
import { emailProcessing } from './inbox-status'

const POLL_MS = 4000
/** Polling stops after this (5 minutes); opening the email again checks again. */
const MAX_POLLS = 75

/** Topics shown as chips; the rest are counted ("+2"). */
const SHOWN_TOPICS = 4
/** A summary longer than this is clamped to three lines, with More. */
const LONG_SUMMARY = 240

const SENDER_HELP =
  'Unsubscribing deletes nothing: its stories stay in your Knowledge base but stop being used for ideas, and new emails from it are not read.'

/** How far the article behind a story was read, as its chip says it. */
function articleState(story: InboxStory): {
  tone: Tone
  label: string
  spinning: boolean
} {
  switch (story.article?.status) {
    case 'pending':
    case 'processing':
      return { tone: 'brand', label: 'Reading…', spinning: true }
    case 'failed':
      return { tone: 'danger', label: "Couldn't read", spinning: false }
    case 'done':
    case 'duplicate':
      return { tone: 'success', label: 'Read', spinning: false }
    // No link, or one that leads to nothing readable (gone, a paywall): the
    // story keeps the newsletter's own words.
    default:
      return { tone: 'neutral', label: 'No article', spinning: false }
  }
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
export function EmailInsights({
  messageId,
  onChanged
}: {
  messageId: string
  /** After Try again or a sender change: what the list shows for it changed. */
  onChanged?: () => void
}) {
  const [insights, setInsights] = useState<InboxInsights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retrying, startRetry] = useTransition()
  const [reloading, startReload] = useTransition()
  const [changingSender, startSenderChange] = useTransition()
  const [summaryOpen, setSummaryOpen] = useState(false)
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

  const reload = () => startReload(async () => show(await check()))

  const retry = () =>
    startRetry(async () => {
      const res = await retryInboxInsights(messageId).catch(() => null)
      if (res?.success) {
        show(await check())
        onChanged?.()
      } else setError(res?.error ?? 'Could not try again.')
    })

  const changeSender = (unsubscribed: boolean) =>
    startSenderChange(async () => {
      const res = await setInboxSenderUnsubscribed(
        messageId,
        unsubscribed
      ).catch(() => null)
      if (res?.success) {
        show(await check())
        onChanged?.()
      } else setError(res?.error ?? 'Could not save that.')
    })

  if (!insights) {
    return (
      <InsightsCard
        chip={
          error ? null : (
            <StatusChip tone="brand" spinning>
              Loading…
            </StatusChip>
          )
        }
      >
        {error ? (
          <ErrorLine message={error} onRetry={reload} busy={reloading} />
        ) : (
          <div className="space-y-2" aria-hidden>
            <div className="bg-surface-hover h-3 w-11/12 animate-pulse rounded motion-reduce:animate-none" />
            <div className="bg-surface-hover h-3 w-3/4 animate-pulse rounded motion-reduce:animate-none" />
          </div>
        )}
      </InsightsCard>
    )
  }

  const { status, summary, topics, stories, newerVersion } = insights
  const processing = emailProcessing({
    status,
    error: insights.error,
    kind: insights.kind,
    storyCount: stories.length,
    superseded: newerVersion !== null
  })
  const { rows: pageStories, pageInfo: storyPageInfo } = paginate(
    stories,
    storyPage,
    PAGE_SIZE
  )
  const longSummary = (summary?.length ?? 0) > LONG_SUMMARY

  return (
    <InsightsCard
      chip={
        <StatusChip
          tone={processing.tone}
          spinning={processing.spinning}
          title={processing.detail ?? undefined}
        >
          {processing.label}
        </StatusChip>
      }
    >
      {processing.spinning && (
        <ProgressBar indeterminate size="xs" label="Reading" />
      )}

      {status === 'failed' && (
        <ErrorLine
          message={insights.error ?? 'Something went wrong.'}
          onRetry={retry}
          busy={retrying}
        />
      )}

      {status === 'done' && (
        <>
          {summary && (
            <div>
              <p
                className={cn(
                  'text-foreground text-sm leading-relaxed',
                  longSummary && !summaryOpen && 'line-clamp-3'
                )}
              >
                {summary}
              </p>
              {longSummary && (
                <button
                  type="button"
                  onClick={() => setSummaryOpen(open => !open)}
                  aria-expanded={summaryOpen}
                  className={cn(
                    'text-muted hover:text-foreground mt-1 cursor-pointer rounded-sm text-xs font-medium',
                    FOCUS_RING
                  )}
                >
                  {summaryOpen ? 'Less' : 'More'}
                </button>
              )}
            </div>
          )}
          {topics.length > 0 && (
            <ul aria-label="Topics" className="flex flex-wrap gap-1.5">
              {topics.slice(0, SHOWN_TOPICS).map(topic => (
                <li
                  key={topic}
                  className="border-border bg-surface-hover text-foreground/80 max-w-full truncate rounded-full border px-2.5 py-0.5 text-xs"
                >
                  {topic}
                </li>
              ))}
              {topics.length > SHOWN_TOPICS && (
                <li
                  title={topics.slice(SHOWN_TOPICS).join(', ')}
                  className="text-muted px-1 py-0.5 text-xs tabular-nums"
                >
                  +{topics.length - SHOWN_TOPICS}
                </li>
              )}
            </ul>
          )}
          {newerVersion && (
            <NewerVersion
              subject={newerVersion.subject}
              receivedAt={newerVersion.receivedAt}
            />
          )}
          {stories.length > 0 && (
            <section
              aria-labelledby={`stories-${messageId}`}
              className="border-border border-t pt-4"
            >
              <h3
                id={`stories-${messageId}`}
                className="text-foreground mb-1 text-sm font-semibold"
              >
                Stories
              </h3>
              <ol ref={storyListRef} className="divide-border divide-y">
                {pageStories.map(story => (
                  <Story key={story.id} story={story} />
                ))}
              </ol>
              <div className="mt-3">
                <Pagination
                  {...storyPageInfo}
                  noun="stories"
                  onPageChange={setStoryPage}
                  scrollTarget={storyListRef}
                />
              </div>
            </section>
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
      {error && (
        <p role="alert" className={cn('text-xs', TONES.danger.text)}>
          {error}
        </p>
      )}
    </InsightsCard>
  )
}

/** The card: "AI summary" and its chip as a toggle, then what was found. */
function InsightsCard({
  chip,
  children
}: {
  chip: ReactNode
  children: ReactNode
}) {
  return (
    <details
      open
      className="group border-border bg-surface rounded-2xl border shadow-xs"
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2.5 rounded-2xl px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden',
          FOCUS_RING
        )}
      >
        <Sparkles aria-hidden className="text-brand-strong h-4 w-4 shrink-0" />
        <span className="text-foreground text-sm font-semibold">
          AI summary
        </span>
        {chip}
        <ChevronDown
          aria-hidden
          className="text-muted ml-auto h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <div className="space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </details>
  )
}

/** One short line of what went wrong, and Try again. */
function ErrorLine({
  message,
  onRetry,
  busy
}: {
  message: string
  onRetry: () => void
  busy: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p
        role="alert"
        className={cn('min-w-0 flex-1 text-[13px]', TONES.danger.text)}
      >
        {message}
      </p>
      <Button
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={onRetry}
        className={FOCUS_RING}
      >
        Try again
      </Button>
    </div>
  )
}

/** A newer version of this issue arrived, which carries the stories both have. */
function NewerVersion({
  subject,
  receivedAt
}: {
  subject: string | null
  receivedAt: Date
}) {
  const hasMounted = useHasMounted()
  const detail = `${subject ? `“${subject}”` : 'The newer version'}${
    hasMounted ? `, ${formatAbsoluteDate(receivedAt)}` : ''
  }. The stories it repeats are listed with it.`
  return (
    <p title={detail} className="text-muted flex items-center gap-1.5 text-xs">
      <Info aria-hidden className="h-3.5 w-3.5 shrink-0" />
      Newer version <TimeAgo value={receivedAt} />
    </p>
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
    <div className="border-border flex flex-wrap items-center gap-x-2 gap-y-2 border-t pt-4">
      <p className="text-muted min-w-0 flex-1 truncate text-xs">
        {sender.address}
      </p>
      {sender.unsubscribed && (
        <StatusChip tone="neutral">Unsubscribed</StatusChip>
      )}
      <InfoTip label="About unsubscribing">{SENDER_HELP}</InfoTip>
      <Button
        variant="secondary"
        size="sm"
        loading={saving}
        onClick={() => onChange(!sender.unsubscribed)}
        className={FOCUS_RING}
      >
        {sender.unsubscribed ? 'Undo' : 'I unsubscribed'}
      </Button>
    </div>
  )
}

/**
 * A story in a compact row: its headline (the link), where it leads and how
 * far its article was read. What the newsletter said and what was read of
 * the article open under it.
 */
function Story({ story }: { story: InboxStory }) {
  const hasMounted = useHasMounted()
  const { article } = story
  const state = articleState(story)
  const site = article?.siteName ?? hostOf(story.url)
  const hasDetails = Boolean(
    story.blurb || article?.summary || (article?.claims.length ?? 0) > 0
  )
  return (
    <li className="py-3 first:pt-2 last:pb-0">
      <p className="text-foreground text-[13px] leading-snug font-medium wrap-break-word">
        {isWebUrl(story.url) ? (
          <a
            href={story.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'rounded-sm underline-offset-2 hover:underline',
              FOCUS_RING
            )}
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
      </p>
      <div className="text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {site && <span className="min-w-0 truncate">{site}</span>}
        {article?.publishedAt && hasMounted && (
          <span className="tabular-nums">
            {formatAbsoluteDate(article.publishedAt)}
          </span>
        )}
        <StatusChip
          tone={state.tone}
          spinning={state.spinning}
          title={article?.note ?? undefined}
        >
          {state.label}
        </StatusChip>
        {story.sponsored && <StatusChip tone="neutral">Sponsored</StatusChip>}
      </div>
      {hasDetails && (
        <details className="group/story mt-1.5">
          <summary
            className={cn(
              'text-muted hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium [&::-webkit-details-marker]:hidden',
              FOCUS_RING
            )}
          >
            <ChevronDown
              aria-hidden
              className="h-3.5 w-3.5 transition-transform group-open/story:rotate-180 motion-reduce:transition-none"
            />
            Details
          </summary>
          <div className="mt-2 space-y-2 text-xs leading-relaxed wrap-break-word">
            {story.blurb && <p className="text-muted">{story.blurb}</p>}
            {article?.summary && (
              <p className="text-foreground/90">{article.summary}</p>
            )}
            {article && article.claims.length > 0 && (
              <ul
                aria-label="Key claims"
                className="text-muted list-disc space-y-0.5 pl-4"
              >
                {article.claims.map((claim, i) => (
                  <li key={i}>{claim}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </li>
  )
}
