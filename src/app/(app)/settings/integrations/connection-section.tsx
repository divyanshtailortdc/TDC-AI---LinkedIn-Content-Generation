'use client'

import { PlatformMark } from '@/components/platform-mark'
import { Button, buttonClassName } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormAlert } from '@/components/form-alert'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { formatAbsoluteDate as formatDate } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { initialsOf } from '@/lib/initials'
import type { PlatformSpec } from '@/lib/platforms'
import type { ConnectionSummary } from '@/lib/publishing/connection'
import { CalendarClock, RefreshCw, Unplug } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import { disconnectPlatform, saveAutoPublish } from './actions'
import { BufferAccountSwitch, BufferConnectForm } from './buffer-connect-form'

/** A route, not a page: a full navigation that redirects to the platform. */
const connectUrl = (platform: PlatformSpec) =>
  `/api/integrations/${platform.id}/connect`

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
 * Settings → Integrations, one per platform: connect the account approved
 * posts are published to, separately from how the user signs in, and opt in
 * to auto-publishing. LinkedIn connects on its consent screen; X through
 * Buffer, on Buffer's consent screen (or, without a Buffer app client, with a
 * Buffer API key pasted here).
 */
export function ConnectionSection({
  platform,
  connectWith,
  via,
  configured,
  connection,
  notice
}: {
  platform: PlatformSpec
  connectWith: 'oauth' | 'api_key'
  /** The service posts go through ("Buffer"), when not the platform's own API. */
  via: string | null
  configured: boolean
  connection: ConnectionSummary | null
  notice: { variant: 'success' | 'error'; message: string } | null
}) {
  const mounted = useHasMounted()
  const titleId = useId()
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  // A pasted key (Buffer without an app client): the form, open to connect
  // or to change the key.
  const [keyFormOpen, setKeyFormOpen] = useState(false)
  const viaBuffer = via === 'Buffer'
  const withKey = connectWith === 'api_key'

  // The callback's outcome is shown once; a reload should not repeat it.
  useEffect(() => {
    if (!notice) return
    const url = new URL(window.location.href)
    url.searchParams.delete('connection')
    url.searchParams.delete('platform')
    window.history.replaceState(null, '', url)
  }, [notice])

  const status = connection?.status ?? 'disconnected'
  const connected = status === 'connected'
  const name = platform.name
  const CONNECT_URL = connectUrl(platform)

  const confirmDisconnect = async () => {
    setDisconnecting(true)
    const res = await disconnectPlatform(platform.id).catch(() => ({
      success: false as const,
      error: `${name} could not be disconnected. Please try again.`
    }))
    setDisconnecting(false)
    setConfirmingDisconnect(false)
    if (!res.success) {
      showToast({
        type: 'error',
        title: `${name} not disconnected`,
        message: res.error
      })
      return
    }
    showToast({
      type: 'success',
      title: `${name} disconnected`,
      message:
        res.cancelled > 0
          ? `${res.cancelled} scheduled ${res.cancelled === 1 ? 'post was' : 'posts were'} cancelled.`
          : `TDC AI can no longer publish to your ${name}.`
    })
  }

  // The way to connect: a link to the consent screen, or the key form.
  const connectButton = (label: string, variant: 'platform' | 'secondary') =>
    withKey ? (
      <Button
        variant={variant}
        size="sm"
        onClick={() => setKeyFormOpen(open => !open)}
        aria-expanded={keyFormOpen}
      >
        {variant === 'platform' ? (
          <PlatformMark platform={platform.id} className="h-4 w-4" />
        ) : (
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        )}
        {label}
      </Button>
    ) : (
      // A plain link: the route redirects to the platform.
      <a
        href={CONNECT_URL}
        title={
          variant === 'secondary'
            ? 'Connect again, e.g. before access runs out'
            : undefined
        }
        className={buttonClassName({ variant, size: 'sm' })}
      >
        {variant === 'platform' ? (
          <PlatformMark platform={platform.id} className="h-4 w-4" />
        ) : (
          <RefreshCw aria-hidden className="h-3.5 w-3.5" />
        )}
        {label}
      </a>
    )

  return (
    <div data-platform={platform.id} className="space-y-6">
      <section
        aria-labelledby={titleId}
        className="border-border bg-surface rounded-2xl border p-5 shadow-xs"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 basis-60">
            <h2
              id={titleId}
              className="text-foreground flex items-center gap-2.5 text-base font-semibold"
            >
              <span className="bg-platform/10 rounded-lg p-1.5">
                <PlatformMark
                  platform={platform.id}
                  className="text-platform-text h-4 w-4"
                />
              </span>
              {name} publishing
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
              {viaBuffer ? (
                <>
                  Connect the {name} account TDC AI publishes your approved
                  posts to, through{' '}
                  <a
                    href="https://buffer.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Buffer
                  </a>
                  : your {name} account is connected in Buffer, and TDC AI
                  hands Buffer each post to publish. TDC AI never sees your{' '}
                  {name} password.
                </>
              ) : (
                <>
                  Connect the {name} account TDC AI publishes your approved
                  posts to. This is separate from how you sign in: signing in
                  with {name} does not let TDC AI post for you.
                </>
              )}
            </p>
          </div>
          {configured &&
            !connected &&
            connectButton(
              status === 'expired' ? `Reconnect ${name}` : `Connect ${name}`,
              'platform'
            )}
        </div>

        <div className="mt-5 space-y-4">
          {notice && (
            <FormAlert variant={notice.variant}>{notice.message}</FormAlert>
          )}

          {configured && withKey && keyFormOpen && (
            <BufferConnectForm
              platformName={name}
              onDone={() => setKeyFormOpen(false)}
            />
          )}

          {!configured ? (
            <FormAlert variant="info">
              Publishing to {name} is not set up on this server yet. An
              administrator needs to set it up (see docs/PUBLISHING.md).
            </FormAlert>
          ) : !connection || status === 'disconnected' ? (
            keyFormOpen ? null : (
              <div className="border-border rounded-xl border-2 border-dashed px-6 py-8 text-center">
                <p className="text-foreground text-sm font-medium">
                  No {name} account connected
                </p>
                <p className="text-muted mx-auto mt-1 max-w-md text-xs leading-relaxed">
                  {viaBuffer && withKey
                    ? `Connect your ${name} account in Buffer (its free plan is enough), create a Buffer API key, and paste it here.`
                    : viaBuffer
                      ? `Connect your ${name} account in Buffer first (its free plan is enough). Buffer will then ask you to allow TDC AI to see your channels and create posts.`
                      : `${name} will ask you to allow TDC AI to see your name and photo and to create posts for you.`}{' '}
                  Nothing is posted until you approve a post and choose to
                  publish it.
                </p>
              </div>
            )
          ) : (
            <>
              {status === 'expired' && (
                <FormAlert>
                  {connection.lastError ??
                    `${name} no longer accepts this connection.`}{' '}
                  {withKey
                    ? 'Connect again with a working Buffer API key; scheduled posts will fail until you do.'
                    : 'Reconnect to keep publishing; scheduled posts will fail until you do.'}
                </FormAlert>
              )}
              {connected && !connection.canPublish && (
                <FormAlert>
                  {name} did not grant permission to create posts. Reconnect
                  and allow it.
                </FormAlert>
              )}
              <div className="border-border flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3.5">
                {connection.pictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the platform's CDN, not configured for next/image
                  <img
                    src={connection.pictureUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-11 w-11 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="bg-platform/10 text-platform-text flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  >
                    {initialsOf(connection.name ?? name)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {connection.name ?? `${name} account`}
                    {viaBuffer && (
                      <span className="text-muted font-normal"> · via Buffer</span>
                    )}
                  </p>
                  {/* Dates in the viewer's own format, so only after mount. */}
                  <p className="text-muted mt-0.5 text-xs">
                    {mounted && (
                      <>
                        Connected {formatDate(connection.connectedAt)}
                        {/* A token renewed by itself needs no date. */}
                        {connected && connection.expiresAt && !connection.renews && (
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
                  {connected && viaBuffer && !withKey && (
                    <BufferAccountSwitch platformName={name} />
                  )}
                  {connected &&
                    connectButton(
                      withKey ? 'Change key or account' : 'Reconnect',
                      'secondary'
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
                {viaBuffer && withKey ? (
                  <>
                    Posts go out through Buffer and count toward your Buffer
                    plan&apos;s limits. Disconnecting deletes the Buffer API
                    key saved here; to revoke the key itself, delete it in
                    Buffer (Settings → API).
                  </>
                ) : viaBuffer ? (
                  <>
                    Posts go out through Buffer and count toward your Buffer
                    plan&apos;s limits. TDC AI renews its access by itself.
                    Disconnecting deletes TDC AI&apos;s access here; to remove
                    it in Buffer too, remove TDC AI from the apps in your
                    Buffer account settings.
                  </>
                ) : (
                  <>
                    {name} grants access for a limited time; reconnect before
                    it runs out. Disconnecting deletes TDC AI&apos;s access
                    here. To also remove it on {name}, remove TDC AI from the
                    apps allowed in your {name} privacy settings.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </section>

      {configured && connection && connected && (
        <AutoPublishSection platform={platform} connection={connection} />
      )}

      {confirmingDisconnect && (
        <ConfirmDialog
          title={`Disconnect ${name}?`}
          description={
            <>
              TDC AI will no longer be able to publish to{' '}
              <span className="text-foreground font-medium">
                {connection?.name ?? `your ${name}`}
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
    </div>
  )
}

/** Opt-in auto-publishing: approved posts planned for a day go out that day. */
function AutoPublishSection({
  platform,
  connection
}: {
  platform: PlatformSpec
  connection: ConnectionSummary
}) {
  const mounted = useHasMounted()
  const titleId = useId()
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
    const res = await saveAutoPublish({
      platform: platform.id,
      enabled,
      time,
      timezone: zone
    }).catch(
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
      aria-labelledby={titleId}
      className="border-border bg-surface rounded-2xl border p-5 shadow-xs"
    >
      <h2
        id={titleId}
        className="text-foreground flex items-center gap-2.5 text-base font-semibold"
      >
        <span className="bg-accent/10 rounded-lg p-1.5">
          <CalendarClock aria-hidden className="text-accent h-4 w-4" />
        </span>
        Auto-publishing to {platform.name}
      </h2>
      <p className="text-muted mt-1 text-xs leading-relaxed">
        When on, every <strong className="text-foreground">approved</strong>{' '}
        {platform.name} post planned for a day on the{' '}
        <Link href="/schedule" className="text-accent hover:underline">
          Schedule
        </Link>{' '}
        page is published to {platform.name} automatically at the time below on that
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
              your {platform.name} at {time} ({zone}) that day, without asking again.
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
