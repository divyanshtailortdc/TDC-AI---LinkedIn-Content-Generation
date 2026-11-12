'use client'

import { PlatformMark } from '@/components/platform-mark'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  usePlatformPublishing,
  type PlatformPublishingStatus
} from '@/components/publishing-header-button'
import { markDataChanged } from '@/components/refresh-on-back'
import { showToast } from '@/components/toast-notification'
import { formatAbsoluteDateTime as formatDateTime } from '@/lib/format-date'
import { FORMATS, type FormatId } from '@/lib/formats'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { getPlatform, type PlatformId } from '@/lib/platforms'
import type { PublicationSummary } from '@/lib/publishing/engine'
import { SENDS_FIRST_COMMENT } from '@/lib/publishing/platform'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Trash2,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useEffectEvent, useId, useState } from 'react'
import {
  cancelPostPublication,
  deletePostFromPlatform,
  getPostPublication,
  publishPostNow,
  schedulePostPublication
} from './publish-actions'

/** A datetime-local value an hour from now, in the viewer's zone. */
function inAnHour(): string {
  const d = new Date(Date.now() + 60 * 60_000)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

/**
 * Connect (or Reconnect) the account a post is published to, in place of
 * Publish now while it is not connected. A platform signed into on its own
 * consent screen goes straight there; an expired connection, or one made with
 * a key pasted in Settings, opens Settings → Integrations.
 */
function ConnectButton({
  publishing
}: {
  publishing: PlatformPublishingStatus
}) {
  const { platform, connectWith, status } = publishing
  const expired = status === 'expired'
  const className = `${SMALL_BUTTON} bg-platform hover:bg-platform-hover text-white shadow-xs`
  const content = (
    <>
      <PlatformMark platform={platform.id} className="h-3.5 w-3.5" />
      {expired ? `Reconnect ${platform.name}` : `Connect ${platform.name}`}
    </>
  )
  const title = expired
    ? `The ${platform.name} connection expired. Reconnect it to publish.`
    : `Connect the ${platform.name} account approved posts are published to.`
  return !expired && connectWith === 'oauth' ? (
    // A plain link: the route redirects to the platform's consent screen.
    <a
      href={`/api/integrations/${platform.id}/connect`}
      title={title}
      className={className}
    >
      {content}
    </a>
  ) : (
    <Link href={INTEGRATIONS_SETTINGS_PATH} title={title} className={className}>
      {content}
    </Link>
  )
}

/** The viewer's own zone: a published post is marked posted on its day there. */
const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** How often a publication the worker has (or is due to take) is re-read. */
const POLL_MS = 15_000

/**
 * Codes that mean the connection itself is no longer usable (the server has
 * marked it expired, or it was disconnected elsewhere). The connection status
 * comes from the layout, so it is reloaded, and Publish now becomes Reconnect.
 */
const CONNECTION_LOST = new Set(['reauth_required', 'not_connected'])

const SMALL_BUTTON =
  'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Publish now, Schedule, and the state of the post's publication, for an
 * approved post, on the platform it was written for. Only the post id goes to
 * the server; it publishes as the signed-in user's own connected account on
 * that platform, or not at all. The connection comes from the layout
 * (usePlatformPublishing); only Publish now and Schedule need it, the
 * publication's state shows either way.
 */
export function PublishControls(
  props: Parameters<typeof PublishControlsInner>[0]
) {
  // The platform's colour for everything below.
  return (
    <span data-platform={props.platform} className="contents">
      <PublishControlsInner {...props} />
    </span>
  )
}

function PublishControlsInner({
  platform: platformId,
  formatId,
  postId,
  postedAt,
  publication,
  onChange
}: {
  /** The platform the post is written for. */
  platform: PlatformId
  /** Its format (src/lib/formats): a thread and its reply are worded as such. */
  formatId: FormatId
  postId: string
  /** Set when the post is already marked posted (e.g. by hand on Schedule). */
  postedAt: string | null
  publication: PublicationSummary | null | undefined
  onChange: (publication: PublicationSummary) => void
}) {
  const publishing = usePlatformPublishing(platformId)
  const platform = getPlatform(platformId)
  const name = platform.name
  const router = useRouter()
  const mounted = useHasMounted()
  const scheduleId = useId()
  const [busy, setBusy] = useState(false)
  // The open dialog. "unknown-…": the last attempt may have reached the platform;
  // "It's not there" goes on to publish now, or to schedule.
  const [dialog, setDialog] = useState<
    null | 'publish' | 'unknown-publish' | 'unknown-schedule' | 'delete'
  >(null)
  const [scheduling, setScheduling] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')

  // The worker publishes (and retries) without this page: while it has the
  // post, or a retry is due, the publication is re-read so its outcome shows.
  const following =
    publication?.status === 'publishing' || publication?.status === 'scheduled'
  const poll = useEffectEvent(async () => {
    if (busy || !publication) return
    if (
      publication.status === 'scheduled' &&
      Date.parse(publication.nextAttemptAt) > Date.now()
    ) {
      return
    }
    const latest = await getPostPublication(postId).catch(() => null)
    if (
      !latest ||
      (latest.id === publication.id &&
        latest.status === publication.status &&
        latest.attempts === publication.attempts)
    ) {
      return
    }
    onChange(latest)
    if (latest.errorCode && CONNECTION_LOST.has(latest.errorCode)) {
      router.refresh()
    }
  })
  useEffect(() => {
    if (!following) return
    const timer = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(timer)
  }, [following])

  const run = async (
    action: () => ReturnType<typeof publishPostNow>,
    success: (p: PublicationSummary) => { title: string; message?: string },
    // The dialog to open when the server asks to confirm first.
    unknownDialog?: 'unknown-publish' | 'unknown-schedule'
  ): Promise<boolean> => {
    // The server may ask to confirm first; the dialog it opens must stay open.
    let askedToConfirm = false
    setBusy(true)
    try {
      markDataChanged()
      const res = await action()
      if (!res.success) {
        // What the publication became instead (e.g. it started publishing).
        if (res.publication) onChange(res.publication)
        if (res.code === 'confirm_unknown_outcome' && unknownDialog) {
          askedToConfirm = true
          setDialog(unknownDialog)
          return false
        }
        showToast({ type: 'error', title: name, message: res.error })
        if (res.code && CONNECTION_LOST.has(res.code)) router.refresh()
        return false
      }
      onChange(res.publication)
      if (
        res.publication.errorCode &&
        CONNECTION_LOST.has(res.publication.errorCode)
      ) {
        router.refresh()
      }
      if (res.publication.status === 'failed') {
        showToast({
          type: 'error',
          title: 'Not published',
          message: res.publication.error ?? `${name} did not publish the post.`
        })
      } else {
        showToast({ type: 'success', ...success(res.publication) })
      }
      return true
    } catch {
      // The request itself failed (offline, server error): nothing to show
      // from the server, so say so instead of failing silently.
      showToast({
        type: 'error',
        title: name,
        message: 'The request did not go through. Please try again.'
      })
      return false
    } finally {
      setBusy(false)
      if (!askedToConfirm) setDialog(null)
    }
  }

  const publishNow = (confirmedNotPublished = false) =>
    run(
      () =>
        publishPostNow(postId, {
          confirmedNotPublished,
          timezone: viewerZone()
        }),
      p =>
        p.status === 'published'
          ? {
              title: `Published on ${name}`,
              message: p.commentError ?? undefined
            }
          : p.status === 'scheduled'
            ? {
                title: 'Will retry shortly',
                message: p.error ?? `${name} was busy; it will be tried again.`
              }
            : {
                title: 'Publishing…',
                message: `${name} is publishing it; this updates when it is out.`
              },
      'unknown-publish'
    )

  const schedule = (confirmedNotPublished = false) => {
    const at = new Date(scheduleAt)
    if (Number.isNaN(at.getTime())) return
    void run(
      () =>
        schedulePostPublication(postId, at.toISOString(), {
          confirmedNotPublished,
          timezone: viewerZone()
        }),
      p => ({
        title: 'Scheduled',
        message: `Publishes ${formatDateTime(p.scheduledAt)}.`
      }),
      'unknown-schedule'
    ).then(ok => ok && setScheduling(false))
  }

  const cancel = (id: string) =>
    run(
      () => cancelPostPublication(id),
      () => ({ title: 'Scheduled publishing cancelled' })
    )

  const deleteFromPlatform = (id: string) =>
    run(
      () => deletePostFromPlatform(id),
      () => ({
        title: `Deleted from ${name}`,
        message: 'The post stays here, and cannot be published again.'
      })
    )

  // Not connected, or the connection expired: Connect (or Reconnect) takes the
  // place of Publish now and Schedule. Not set up on this server (publishing
  // is null): nothing to offer here but the publication's state.
  const canPublish = publishing?.status === 'connected'

  // Deleted from the platform: still the record of it, and it stays published so
  // it is not published again.
  if (publication?.status === 'published' && publication.deletedAt) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5 text-[12px]">
        <span className="text-muted inline-flex gap-1 font-semibold">
          <Trash2 className="h-3.5 w-3.5 shrink-0" />
          Deleted from {name}
        </span>
        {mounted && (
          <span className="text-muted self-end">
            {formatDateTime(publication.deletedAt)}
          </span>
        )}
      </span>
    )
  }

  if (publication?.status === 'published') {
    // The post's link, then Delete, after the date.
    const links = [
      publication.postUrl && (
        <a
          key="view"
          href={publication.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-platform-text inline-flex items-center gap-1 font-medium hover:underline"
        >
          View post
          <ExternalLink className="h-3 w-3" />
        </a>
      ),
      canPublish && publication.canDelete && (
        <button
          key="delete"
          type="button"
          disabled={busy}
          onClick={() => setDialog('delete')}
          className="text-muted inline-flex cursor-pointer items-center gap-1 hover:text-rose-600 disabled:opacity-50 dark:hover:text-rose-400"
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      )
    ].filter(Boolean)
    return (
      <>
        {/* Two rows: what happened, then when, the link to it and Delete. */}
        <span className="inline-flex flex-col items-start gap-0.5 text-[12px]">
          <span className="inline-flex gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            Published on {name}
          </span>
          {((mounted && publication.publishedAt) || links.length > 0) && (
            // Right-aligned under the first row.
            <span className="inline-flex items-center gap-1.5 self-end">
              {mounted && publication.publishedAt && (
                <span className="text-muted">
                  {formatDateTime(publication.publishedAt)}
                  {links.length > 0 && ' ·'}
                </span>
              )}
              {links.flatMap((link, i) =>
                i === 0
                  ? [link]
                  : [
                      <span key={`dot-${i}`} className="text-muted">
                        ·
                      </span>,
                      link
                    ]
              )}
            </span>
          )}
        </span>

        {dialog === 'delete' && (
          <ConfirmDialog
            title={`Delete it from ${name}?`}
            description={
              <>
                The post is removed from {name} for good, with its first
                comment, reactions and comments. It stays here, and cannot be
                published again.
              </>
            }
            confirmLabel={`Delete from ${name}`}
            pendingLabel="Deleting…"
            pending={busy}
            onCancel={() => setDialog(null)}
            onConfirm={() => void deleteFromPlatform(publication.id)}
          />
        )}
      </>
    )
  }

  if (publication?.status === 'publishing') {
    return (
      <span className="text-muted inline-flex h-8 items-center gap-1.5 text-[12px] font-medium">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Publishing to {name}…
      </span>
    )
  }

  if (publication?.status === 'scheduled') {
    const retrying = publication.attempts > 0
    return (
      <span className="inline-flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-foreground inline-flex items-center gap-1 font-medium">
          <CalendarClock className="text-accent h-3.5 w-3.5" />
          {retrying ? 'Retrying' : 'Publishes'}{' '}
          {mounted &&
            formatDateTime(
              retrying ? publication.nextAttemptAt : publication.scheduledAt
            )}
          {publication.trigger === 'auto' && (
            <span className="text-muted">(auto)</span>
          )}
        </span>
        {retrying && publication.error && (
          <span className="text-muted" title={publication.error}>
            · last attempt failed
          </span>
        )}
        {/* Scheduled, but the connection has since expired: it would fail
            when due unless it is reconnected first. */}
        {publishing && !canPublish && <ConnectButton publishing={publishing} />}
        <button
          type="button"
          disabled={busy}
          onClick={() => void cancel(publication.id)}
          className="text-muted inline-flex cursor-pointer items-center gap-1 hover:text-rose-600 disabled:opacity-50 dark:hover:text-rose-400"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      </span>
    )
  }

  // Marked posted by hand (on Schedule): publishing it would post it twice,
  // and the server refuses it anyway, so there is nothing to offer.
  if (postedAt) {
    return (
      <span
        className="text-muted inline-flex h-8 items-center gap-1 text-[12px] font-medium"
        title="Marked as posted on the Schedule page. Unmark it there to publish from here."
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Marked as posted
        {mounted && (
          <span className="font-normal"> {formatDateTime(postedAt)}</span>
        )}
      </span>
    )
  }

  // No publication yet, or the last one failed or was cancelled.
  const lastFailed = publication?.status === 'failed'
  // Publishing not set up on this server: nothing to offer but the last failure.
  if (!lastFailed && !canPublish && !publishing) return null
  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-2">
        {lastFailed && (
          <span
            className="inline-flex max-w-40 items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400"
            title={publication.error ?? undefined}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {publication.error ?? 'Publishing failed.'}
            </span>
          </span>
        )}
        {!canPublish ? (
          publishing && <ConnectButton publishing={publishing} />
        ) : scheduling ? (
          <form
            onSubmit={e => {
              e.preventDefault()
              schedule()
            }}
            // Keys typed here must not trigger the review shortcuts.
            onKeyDown={e => {
              e.stopPropagation()
              if (e.key === 'Escape') setScheduling(false)
            }}
            className="inline-flex flex-wrap items-center gap-2"
          >
            <label htmlFor={scheduleId} className="sr-only">
              Publish on {name} at
            </label>
            <input
              id={scheduleId}
              type="datetime-local"
              autoFocus
              required
              value={scheduleAt}
              onChange={e => setScheduleAt(e.target.value)}
              className="border-border bg-surface text-foreground h-8 rounded-lg border px-2 text-xs"
            />
            <button
              type="submit"
              disabled={busy || !scheduleAt}
              className={`${SMALL_BUTTON} border-border text-foreground hover:bg-surface-hover border`}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Schedule
            </button>
            <button
              type="button"
              onClick={() => setScheduling(false)}
              className="text-muted hover:text-foreground h-8 cursor-pointer px-1 text-[12px]"
            >
              Cancel
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setDialog(
                  lastFailed && publication.errorCode === 'unknown_outcome'
                    ? 'unknown-publish'
                    : 'publish'
                )
              }
              className={`${SMALL_BUTTON} bg-platform hover:bg-platform-hover text-white shadow-xs`}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlatformMark platform={platform.id} className="h-3.5 w-3.5" />
              )}
              {lastFailed ? 'Try again' : 'Publish now'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setScheduleAt(inAnHour())
                setScheduling(true)
              }}
              className={`${SMALL_BUTTON} border-border text-foreground hover:bg-surface-hover border`}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule
            </button>
          </>
        )}
      </span>

      {dialog === 'publish' && (
        <ConfirmDialog
          title={`Publish to ${name} now?`}
          description={
            <>
              This {FORMATS[formatId].structure === 'thread' ? 'thread' : 'post'}, with its image
              {SENDS_FIRST_COMMENT.has(platform.id)
                ? ` and ${FORMATS[formatId].commentLabel.toLowerCase()}`
                : ''}, is published
              publicly as{' '}
              <span className="text-foreground font-medium">
                {publishing?.name ?? `your ${name} account`}
              </span>
              .
            </>
          }
          confirmLabel="Publish now"
          pendingLabel="Publishing…"
          pending={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void publishNow()}
        />
      )}
      {(dialog === 'unknown-publish' || dialog === 'unknown-schedule') && (
        <ConfirmDialog
          title={`Is it already on ${name}?`}
          description={
            <>
              The last attempt may have reached {name}. Open your {name}
              profile first: publish again only if the post is not there, or it
              will appear twice.
            </>
          }
          confirmLabel={
            dialog === 'unknown-schedule'
              ? "It's not there, schedule"
              : "It's not there, publish"
          }
          pendingLabel={
            dialog === 'unknown-schedule' ? 'Scheduling…' : 'Publishing…'
          }
          pending={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            dialog === 'unknown-schedule'
              ? schedule(true)
              : void publishNow(true)
          }
        />
      )}
    </>
  )
}
