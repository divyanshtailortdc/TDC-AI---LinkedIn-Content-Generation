'use client'

import { LinkedInMark } from '@/components/auth/linkedin-mark'
import { Button, buttonClassName } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormAlert } from '@/components/form-alert'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { formatAbsoluteDate as formatDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { initialsOf } from '@/lib/initials'
import type { ConnectionSummary } from '@/lib/linkedin/connection'
import { CalendarClock, RefreshCw, Unplug } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { disconnectLinkedIn, saveAutoPublish } from './actions'

/** A route, not a page: a full navigation that redirects to LinkedIn. */
const CONNECT_URL = '/api/linkedin/connect'

const STATUS = {
  connected: {
    label: 'Connected',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  expired: {
    label: 'Expired',
    className:
      'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
  },
  disconnected: {
    label: 'Not connected',
    className: 'border-border bg-surface-hover text-muted'
  }
} as const

/**
 * Settings → LinkedIn: connect the LinkedIn account approved posts are
 * published to, separately from how the user signs in, and opt in to
 * auto-publishing.
 */
export function LinkedInSection({
  configured,
  connection,
  notice
}: {
  configured: boolean
  connection: ConnectionSummary | null
  notice: { variant: 'success' | 'error'; message: string } | null
}) {
  const mounted = useHasMounted()
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // The callback's ?linkedin= is shown once; a reload should not repeat it.
  useEffect(() => {
    if (!notice) return
    const url = new URL(window.location.href)
    url.searchParams.delete('linkedin')
    window.history.replaceState(null, '', url)
  }, [notice])

  const status = connection?.status ?? 'disconnected'
  const connected = status === 'connected'

  const confirmDisconnect = async () => {
    setDisconnecting(true)
    const res = await disconnectLinkedIn().catch(() => ({
      success: false as const,
      error: 'LinkedIn could not be disconnected. Please try again.'
    }))
    setDisconnecting(false)
    setConfirmingDisconnect(false)
    if (!res.success) {
      showToast({
        type: 'error',
        title: 'LinkedIn not disconnected',
        message: res.error
      })
      return
    }
    showToast({
      type: 'success',
      title: 'LinkedIn disconnected',
      message:
        res.cancelled > 0
          ? `${res.cancelled} scheduled ${res.cancelled === 1 ? 'post was' : 'posts were'} cancelled.`
          : 'TDC AI can no longer publish to your LinkedIn.'
    })
  }

  return (
    <>
      <section
        aria-labelledby="linkedin-title"
        className="border-border bg-surface rounded-2xl border p-5 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-60">
            <h2
              id="linkedin-title"
              className="text-foreground flex items-center gap-2.5 text-base font-semibold"
            >
              <span className="bg-linkedin/10 rounded-lg p-1.5">
                <LinkedInMark className="text-linkedin-text h-4 w-4" />
              </span>
              LinkedIn publishing
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                  STATUS[status].className
                )}
              >
                {STATUS[status].label}
              </span>
            </h2>
            <p className="text-muted mt-1 text-xs leading-relaxed">
              Connect the LinkedIn account TDC AI publishes your approved posts
              to. This is separate from how you sign in: signing in with
              LinkedIn does not let TDC AI post for you.
            </p>
          </div>
          {configured && !connected && (
            // A plain link: the route redirects to LinkedIn.
            <a
              href={CONNECT_URL}
              className={buttonClassName({ variant: 'linkedin', size: 'sm' })}
            >
              <LinkedInMark className="h-4 w-4" />
              {status === 'expired' ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}
            </a>
          )}
        </div>

        <div className="mt-5 space-y-4">
          {notice && (
            <FormAlert variant={notice.variant}>{notice.message}</FormAlert>
          )}

          {!configured ? (
            <FormAlert variant="info">
              Publishing to LinkedIn is not set up on this server yet. An
              administrator needs to add the LinkedIn publishing app&apos;s
              credentials (see docs/LINKEDIN_PUBLISHING.md).
            </FormAlert>
          ) : !connection || status === 'disconnected' ? (
            <div className="border-border rounded-xl border-2 border-dashed px-6 py-8 text-center">
              <p className="text-foreground text-sm font-medium">
                No LinkedIn account connected
              </p>
              <p className="text-muted mx-auto mt-1 max-w-md text-xs leading-relaxed">
                LinkedIn will ask you to allow TDC AI to see your name and photo
                and to create posts for you. Nothing is posted until you approve
                a post and choose to publish it.
              </p>
            </div>
          ) : (
            <>
              {status === 'expired' && (
                <FormAlert>
                  {connection.lastError ??
                    'LinkedIn no longer accepts this connection.'}{' '}
                  Reconnect to keep publishing; scheduled posts will fail until
                  you do.
                </FormAlert>
              )}
              {connected && !connection.canPublish && (
                <FormAlert>
                  LinkedIn did not grant permission to create posts. Reconnect
                  and allow it.
                </FormAlert>
              )}
              <div className="border-border flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3.5">
                {connection.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- LinkedIn's CDN, not configured for next/image
                  <img
                    src={connection.pictureUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-11 w-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="bg-linkedin/10 text-linkedin-text flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  >
                    {initialsOf(connection.name ?? 'LinkedIn')}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {connection.name ?? 'LinkedIn member'}
                  </p>
                  {/* Dates in the viewer's own format, so only after mount. */}
                  <p className="text-muted mt-0.5 text-xs">
                    {mounted && (
                      <>
                        Connected {formatDate(connection.connectedAt)}
                        {connected && connection.expiresAt && (
                          <>
                            {' '}
                            · Access until {formatDate(connection.expiresAt)}
                          </>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {connected && (
                    <a
                      href={CONNECT_URL}
                      title="Connect again, e.g. before access runs out"
                      className={buttonClassName({
                        variant: 'secondary',
                        size: 'sm'
                      })}
                    >
                      <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                      Reconnect
                    </a>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmingDisconnect(true)}
                    aria-haspopup="dialog"
                    className="hover:text-rose-600 dark:hover:text-rose-400"
                  >
                    <Unplug aria-hidden className="h-3.5 w-3.5" />
                    Disconnect
                  </Button>
                </div>
              </div>
              <p className="text-muted text-[11px] leading-relaxed">
                LinkedIn grants access for about 60 days; reconnect before it
                runs out. Disconnecting deletes TDC AI&apos;s access here. To
                also remove it on LinkedIn, open LinkedIn Settings → Data
                privacy → Permitted services.
              </p>
            </>
          )}
        </div>
      </section>

      {configured && connection && connected && (
        <AutoPublishSection connection={connection} />
      )}

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Disconnect LinkedIn?"
          description={
            <>
              TDC AI will no longer be able to publish to{' '}
              <span className="text-foreground font-medium">
                {connection?.name ?? 'your LinkedIn'}
              </span>
              . Posts scheduled to publish are cancelled and auto-publishing
              turns off. How you sign in does not change.
            </>
          }
          confirmLabel="Yes, disconnect"
          pendingLabel="Disconnecting…"
          pending={disconnecting}
          onCancel={() => setConfirmingDisconnect(false)}
          onConfirm={confirmDisconnect}
        />
      )}
    </>
  )
}

/** Opt-in auto-publishing: approved posts planned for a day go out that day. */
function AutoPublishSection({ connection }: { connection: ConnectionSummary }) {
  const mounted = useHasMounted()
  const toggleId = useId()
  const timeId = useId()
  const [enabled, setEnabled] = useState(connection.autoPublish)
  const [time, setTime] = useState(connection.autoPublishTime)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  // The viewer's zone, which a save stores; before mount, the saved one.
  const zone = mounted
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : (connection.autoPublishTimezone ?? '')
  const savedZone = connection.autoPublishTimezone
  const dirty =
    enabled !== connection.autoPublish ||
    time !== connection.autoPublishTime ||
    (enabled && mounted && zone !== savedZone)

  const save = async () => {
    setSaving(true)
    const res = await saveAutoPublish({ enabled, time, timezone: zone }).catch(
      () => ({
        success: false as const,
        error: 'The setting could not be saved. Please try again.'
      })
    )
    setSaving(false)
    setConfirming(false)
    if (!res.success) {
      showToast({ type: 'error', title: 'Not saved', message: res.error })
      return
    }
    showToast({
      type: 'success',
      title: enabled ? 'Auto-publishing is on' : 'Auto-publishing is off'
    })
  }

  // Turning it on asks first; turning it off or changing the time does not.
  const onSave = () =>
    enabled && !connection.autoPublish ? setConfirming(true) : void save()

  return (
    <section
      aria-labelledby="auto-publish-title"
      className="border-border bg-surface rounded-2xl border p-5 shadow-xs"
    >
      <h2
        id="auto-publish-title"
        className="text-foreground flex items-center gap-2.5 text-base font-semibold"
      >
        <span className="bg-accent/10 rounded-lg p-1.5">
          <CalendarClock aria-hidden className="text-accent h-4 w-4" />
        </span>
        Auto-publishing
      </h2>
      <p className="text-muted mt-1 text-xs leading-relaxed">
        When on, every <strong className="text-foreground">approved</strong>{' '}
        post planned for a day on the{' '}
        <Link href="/schedule" className="text-accent hover:underline">
          Schedule
        </Link>{' '}
        page is published to LinkedIn automatically at the time below on that
        day. Posts waiting for review are never published, and nothing is
        published for a time that already passed when you turn it on. A post
        approved, edited or planned for today after that time is not published
        automatically; publish it yourself. Off by default.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label
          htmlFor={toggleId}
          className="flex cursor-pointer items-center gap-2.5"
        >
          <input
            id={toggleId}
            type="checkbox"
            role="switch"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="accent-accent h-4 w-4 cursor-pointer"
          />
          <span className="text-foreground text-sm font-medium">
            Publish approved, planned posts automatically
          </span>
        </label>
        <div className="flex items-center gap-2">
          <label htmlFor={timeId} className="text-muted text-xs">
            at
          </label>
          <input
            id={timeId}
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="border-border bg-surface-hover text-foreground h-8 rounded-lg border px-2 text-sm"
          />
          {/* The zone in use until a save stores the viewer's own. */}
          {(savedZone ?? zone) && (
            <span className="text-muted text-xs">
              ({savedZone ?? zone})
              {enabled && mounted && savedZone && zone !== savedZone && (
                <> · Save to switch to {zone}</>
              )}
            </span>
          )}
        </div>
        <Button
          size="sm"
          loading={saving}
          disabled={!dirty || !time}
          onClick={onSave}
        >
          Save
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Turn on auto-publishing?"
          description={
            <>
              From now on, approved posts planned for a day are published to
              your LinkedIn at {time} ({zone}) that day, without asking again.
              You can turn this off at any time.
            </>
          }
          confirmLabel="Yes, turn it on"
          pendingLabel="Saving…"
          pending={saving}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      )}
    </section>
  )
}
