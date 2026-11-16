'use client'

import { Button, buttonClassName } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormAlert } from '@/components/form-alert'
import { PlatformMark } from '@/components/platform-mark'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import {
  formatAbsoluteDate as formatDate,
  formatRelativeDate
} from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import { initialsOf } from '@/lib/initials'
import { getPlatform, isPlatformId } from '@/lib/platforms'
import type {
  BufferChannelSummary,
  BufferSummary
} from '@/lib/publishing/buffer/connection'
import type { ConnectionSummary } from '@/lib/publishing/connection'
import type { BufferPlatformId } from '@/lib/publishing/platform'
import {
  CalendarClock,
  ExternalLink,
  Globe,
  Layers,
  RefreshCw,
  Send,
  Unplug
} from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import {
  disconnectBufferAccount,
  disconnectPlatform,
  selectBufferChannel,
  syncBuffer
} from './actions'
import { AutoPublishSection } from './auto-publish-section'

/** Why a Buffer channel cannot be published to, or null when it can. */
function channelProblem(
  channel: Pick<BufferChannelSummary, 'isLocked' | 'isDisconnected'>
): string | null {
  if (channel.isDisconnected) return 'Reconnect it in Buffer'
  if (channel.isLocked) return 'Locked in Buffer'
  return null
}

/** A route, not a page: a full navigation that redirects to Buffer. */
export const BUFFER_CONNECT_URL = '/api/integrations/buffer/connect'

/** The card's id, for links to it. */
const BUFFER_SECTION_ID = 'buffer'

const STATUS = {
  connected: {
    label: 'Connected',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  },
  expired: {
    label: 'Needs reconnecting',
    className:
      'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
  },
  disconnected: {
    label: 'Not connected',
    className: 'border-border bg-surface-hover text-muted'
  }
} as const

/** Buffer's service names, as people know the networks. */
const SERVICE_NAMES: Record<string, string> = {
  twitter: 'X',
  x: 'X',
  threads: 'Threads',
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  googlebusiness: 'Google Business',
  startPage: 'Start Page'
}

export const serviceName = (service: string) =>
  SERVICE_NAMES[service] ?? service.charAt(0).toUpperCase() + service.slice(1)

/** The network's mark where the app has one; a globe otherwise. */
function ServiceMark({
  service,
  className
}: {
  service: string
  className: string
}) {
  const id = service === 'twitter' ? 'x' : service
  return isPlatformId(id) ? (
    <PlatformMark platform={id} colored className={className} />
  ) : (
    <Globe aria-hidden className={cn('text-muted', className)} />
  )
}

/** A "Connect Buffer" button; once clicked it stays disabled while Buffer loads. */
function ConnectBufferLink({
  label,
  variant
}: {
  label: string
  variant: 'primary' | 'secondary'
}) {
  const [leaving, setLeaving] = useState(false)
  return (
    <a
      href={BUFFER_CONNECT_URL}
      onClick={e => {
        // A second click would start a second flow and drop the first's state.
        if (leaving) e.preventDefault()
        setLeaving(true)
      }}
      aria-disabled={leaving}
      className={cn(
        buttonClassName({ variant, size: 'sm' }),
        leaving && 'pointer-events-none opacity-60'
      )}
    >
      {variant === 'primary' ? (
        <Layers aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <RefreshCw aria-hidden className="h-3.5 w-3.5" />
      )}
      {leaving ? 'Opening Buffer…' : label}
    </a>
  )
}

/**
 * Settings → Integrations: the user's Buffer account, connected once on
 * Buffer's consent screen, every channel in it, and everything about the
 * networks published through it: which channel LinkedIn, X, Threads, Facebook and
 * Instagram publish to (Publish here, Stop) and their auto-publishing.
 * Never shows a token: the summaries have none.
 */
export function BufferSection({
  configured,
  buffer,
  networks,
  enabledPlatforms,
  hasIdentity,
  notice
}: {
  /** A Buffer app client is set up on this server. */
  configured: boolean
  buffer: BufferSummary | null
  /** The active identity's connections to the networks published through Buffer. */
  networks: ConnectionSummary[]
  /** The networks publishing through Buffer is on for on this server. */
  enabledPlatforms: BufferPlatformId[]
  /** An identity is active, so networks can be set up for it. */
  hasIdentity: boolean
  notice: { variant: 'success' | 'error'; message: string } | null
}) {
  const mounted = useHasMounted()
  const titleId = useId()
  const [syncing, setSyncing] = useState(false)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // The callback's outcome is shown once; a reload should not repeat it.
  useEffect(() => {
    if (!notice) return
    const url = new URL(window.location.href)
    url.searchParams.delete('connection')
    url.searchParams.delete('platform')
    window.history.replaceState(null, '', url)
  }, [notice])

  const status = buffer?.status ?? 'disconnected'
  const connected = status === 'connected'

  const sync = async () => {
    setSyncing(true)
    const res = await syncBuffer().catch(() => ({
      success: false as const,
      error: 'Buffer could not be reached. Please try again.'
    }))
    setSyncing(false)
    if (!res.success) {
      showToast({ type: 'error', title: 'Not synced', message: res.error })
      return
    }
    showToast({
      type: 'success',
      title: res.synced ? 'Channels synced' : 'Channels are up to date',
      message: res.synced ? undefined : 'They were synced moments ago.'
    })
  }

  const confirmDisconnect = async () => {
    setDisconnecting(true)
    const res = await disconnectBufferAccount().catch(() => ({
      success: false as const,
      error: 'Buffer could not be disconnected. Please try again.'
    }))
    setDisconnecting(false)
    setConfirmingDisconnect(false)
    if (!res.success) {
      showToast({
        type: 'error',
        title: 'Buffer not disconnected',
        message: res.error
      })
      return
    }
    showToast({
      type: 'success',
      title: 'Buffer disconnected',
      message:
        res.cancelled > 0
          ? `${res.cancelled} scheduled ${res.cancelled === 1 ? 'post was' : 'posts were'} cancelled.`
          : 'TDC AI can no longer publish through your Buffer account.'
    })
  }

  return (
    <section
      id={BUFFER_SECTION_ID}
      aria-labelledby={titleId}
      className="border-border bg-surface scroll-mt-6 rounded-2xl border p-5 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-60">
          <h2
            id={titleId}
            className="text-foreground flex items-center gap-2.5 text-base font-semibold"
          >
            <span className="bg-accent/10 rounded-lg p-1.5">
              <Layers aria-hidden className="text-accent h-4 w-4" />
            </span>
            Buffer
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
            Publishes to LinkedIn, X, Threads, Facebook and Instagram through
            your own{' '}
            <a
              href="https://buffer.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Buffer
            </a>{' '}
            account. Connect it once; your Buffer password and tokens are never
            shown here.
          </p>
        </div>
        {configured && !connected && (
          <ConnectBufferLink
            label={status === 'expired' ? 'Reconnect Buffer' : 'Connect Buffer'}
            variant="primary"
          />
        )}
      </div>

      <div className="mt-5 space-y-4">
        {notice && (
          <FormAlert variant={notice.variant}>{notice.message}</FormAlert>
        )}

        {!configured ? (
          <FormAlert variant="info">
            Connecting Buffer is not set up on this server yet (see
            docs/BUFFER_OAUTH.md).
          </FormAlert>
        ) : !buffer || status === 'disconnected' ? (
          <div className="border-border rounded-xl border-2 border-dashed px-6 py-8 text-center">
            <p className="text-foreground text-sm font-medium">
              No Buffer account connected
            </p>
            <p className="text-muted mx-auto mt-1 max-w-md text-xs leading-relaxed">
              Add your social accounts in Buffer as channels, then connect
              Buffer here. You will be asked to allow TDC AI to read your
              channels and create posts. Nothing is posted until you approve and
              publish it.
            </p>
          </div>
        ) : (
          <>
            {status === 'expired' && (
              <FormAlert>
                {buffer.lastError ??
                  'Buffer no longer accepts this connection.'}{' '}
                Reconnect to keep publishing.
              </FormAlert>
            )}
            {connected && !buffer.canPublish && (
              <FormAlert>
                Buffer did not allow reading your channels and creating posts.
                Reconnect and allow both.
              </FormAlert>
            )}
            <div className="border-border flex flex-wrap items-center gap-3.5 rounded-xl border px-4 py-3.5">
              {buffer.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Buffer's CDN, not configured for next/image
                <img
                  src={buffer.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-11 w-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="bg-accent/10 text-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                >
                  {initialsOf(buffer.name ?? buffer.email ?? 'Buffer')}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {buffer.name ?? buffer.email ?? 'Buffer account'}
                  {buffer.name && buffer.email && (
                    <span className="text-muted font-normal">
                      {' '}
                      · {buffer.email}
                    </span>
                  )}
                </p>
                {/* Dates in the viewer's own format, so only after mount. */}
                <p className="text-muted mt-0.5 text-xs">
                  {mounted && (
                    <>
                      Connected {formatDate(buffer.connectedAt)}
                      {' · '}
                      {buffer.lastSyncedAt
                        ? `Synced ${formatRelativeDate(buffer.lastSyncedAt)}`
                        : 'Not synced yet'}
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {connected && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={syncing}
                    onClick={() => void sync()}
                    title="Read your channels from Buffer again"
                  >
                    {!syncing && (
                      <RefreshCw aria-hidden className="h-3.5 w-3.5" />
                    )}
                    Sync now
                  </Button>
                )}
                {connected && (
                  <ConnectBufferLink label="Reconnect" variant="secondary" />
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

            <ChannelList
              channels={buffer.channels}
              networks={networks}
              enabledPlatforms={enabledPlatforms}
              canPick={connected && hasIdentity}
            />
          </>
        )}

        <OtherConnections
          channels={buffer?.channels ?? []}
          networks={networks}
        />
        <AutoPublishing networks={networks} />
      </div>

      {confirmingDisconnect && (
        <ConfirmDialog
          title="Disconnect Buffer?"
          description={
            <>
              TDC AI stops publishing to LinkedIn, X, Threads, Facebook and
              Instagram through{' '}
              <span className="text-foreground font-medium">
                {buffer?.name ?? buffer?.email ?? 'your Buffer account'}
              </span>
              , for all your identities. Scheduled posts are cancelled and
              auto-publishing turns off. To revoke access in Buffer too, remove
              TDC AI from your Buffer account&apos;s connected apps.
            </>
          }
          confirmLabel="Yes, disconnect"
          pendingLabel="Disconnecting…"
          pending={disconnecting}
          onCancel={() => setConfirmingDisconnect(false)}
          onConfirm={confirmDisconnect}
        />
      )}
    </section>
  )
}

/** A network connection's card name, e.g. "X". */
const networkName = (platform: string) => getPlatform(platform).name

/** The active identity's connection publishing to this channel, if any. */
const networkOn = (
  channel: BufferChannelSummary,
  networks: ConnectionSummary[]
) =>
  networks.find(
    n =>
      n.viaBufferConnection &&
      n.memberId === channel.channelId &&
      n.platform === channel.platform &&
      n.status !== 'disconnected'
  )

/** A small status pill, in the card's colours. */
function Pill({
  tone,
  children
}: {
  tone: keyof typeof STATUS
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
        STATUS[tone].className
      )}
    >
      {children}
    </span>
  )
}

/** A channel's (or connection's) picture, with its network's mark on it. */
function ChannelAvatar({
  name,
  avatarUrl,
  service
}: {
  name: string
  avatarUrl: string | null
  service: string
}) {
  return (
    <span className="relative shrink-0">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Buffer's CDN, not configured for next/image
        <img
          src={avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="bg-surface-hover text-muted flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold"
        >
          {initialsOf(name)}
        </span>
      )}
      <span className="bg-surface absolute -right-1 -bottom-1 rounded-full p-0.5">
        <ServiceMark service={service} className="h-3.5 w-3.5" />
      </span>
    </span>
  )
}

/** Stops publishing to a network for the active identity, after asking. */
function useStopNetwork() {
  const [stopping, setStopping] = useState<{
    platform: string
    name: string | null
  } | null>(null)
  const [pending, setPending] = useState(false)
  const confirm = async () => {
    if (!stopping) return
    const network = networkName(stopping.platform)
    setPending(true)
    const res = await disconnectPlatform(stopping.platform).catch(() => ({
      success: false as const,
      error: `${network} could not be disconnected. Please try again.`
    }))
    setPending(false)
    setStopping(null)
    if (!res.success) {
      showToast({
        type: 'error',
        title: `${network} not stopped`,
        message: res.error
      })
      return
    }
    showToast({
      type: 'success',
      title: `Stopped publishing to ${network}`,
      message:
        res.cancelled > 0
          ? `${res.cancelled} scheduled ${res.cancelled === 1 ? 'post was' : 'posts were'} cancelled.`
          : 'Your Buffer account stays connected for the other networks.'
    })
  }
  const dialog = stopping && (
    <ConfirmDialog
      title={`Stop publishing to ${networkName(stopping.platform)}?`}
      description={
        <>
          TDC AI stops publishing to{' '}
          <span className="text-foreground font-medium">
            {stopping.name ?? `your ${networkName(stopping.platform)}`}
          </span>
          . Scheduled {networkName(stopping.platform)} posts are cancelled and
          auto-publishing turns off. Your Buffer account stays connected.
        </>
      }
      confirmLabel="Yes, stop"
      pendingLabel="Stopping…"
      pending={pending}
      onCancel={() => setStopping(null)}
      onConfirm={confirm}
    />
  )
  return { stop: setStopping, dialog }
}

/**
 * Every channel in the Buffer account. Each one a network here publishes
 * through shows whether the active identity publishes to it, with Publish
 * here (picking it for its network, replacing another only after asking) or
 * Stop.
 */
function ChannelList({
  channels,
  networks,
  enabledPlatforms,
  canPick
}: {
  channels: BufferChannelSummary[]
  networks: ConnectionSummary[]
  enabledPlatforms: BufferPlatformId[]
  /** Buffer is connected and an identity is active. */
  canPick: boolean
}) {
  const titleId = useId()
  const [busy, setBusy] = useState<string | null>(null)
  const [switching, setSwitching] = useState<{
    channel: BufferChannelSummary
    current: ConnectionSummary
  } | null>(null)
  const { stop, dialog: stopDialog } = useStopNetwork()

  const pick = async (channel: BufferChannelSummary) => {
    const network = networkName(channel.platform!)
    setBusy(channel.channelId)
    const res = await selectBufferChannel(
      channel.platform!,
      channel.channelId
    ).catch(() => ({
      success: false as const,
      error: 'The account could not be chosen. Please try again.'
    }))
    setBusy(null)
    setSwitching(null)
    if (!res.success) {
      showToast({
        type: 'error',
        title: `${network} not changed`,
        message: res.error
      })
      return
    }
    showToast({
      type: 'success',
      title: `Publishing to ${network} as ${res.name}`,
      message: 'Through your Buffer account.'
    })
  }

  if (channels.length === 0) {
    return (
      <div className="border-border rounded-xl border border-dashed px-4 py-5 text-center">
        <p className="text-foreground text-sm font-medium">
          No channels in this Buffer account
        </p>
        <p className="text-muted mt-1 text-xs">
          Add your social accounts in{' '}
          <a
            href="https://publish.buffer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Buffer
          </a>
          , then Sync now.
        </p>
      </div>
    )
  }
  return (
    <div role="group" aria-labelledby={titleId}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-foreground text-sm font-semibold">
          Your accounts
          <span className="text-muted ml-1.5 font-normal">
            ({channels.length})
          </span>
        </h3>
        <a
          href="https://publish.buffer.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent inline-flex items-center gap-1 text-xs hover:underline"
        >
          Add or manage in Buffer
          <ExternalLink aria-hidden className="h-3 w-3" />
        </a>
      </div>
      <ul className="border-border divide-border divide-y rounded-xl border">
        {channels.map(channel => {
          const problem = channelProblem(channel)
          const network = networkOn(channel, networks)
          const publishable =
            channel.platform !== null &&
            enabledPlatforms.includes(channel.platform)
          // What the network publishes to now, when it is another channel.
          const current =
            publishable && !network
              ? networks.find(
                  n =>
                    n.platform === channel.platform &&
                    n.status !== 'disconnected'
                )
              : undefined
          return (
            <li
              key={channel.channelId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
            >
              <ChannelAvatar
                name={channel.name}
                avatarUrl={channel.avatarUrl}
                service={channel.service}
              />
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-foreground truncate text-sm">
                  {channel.name}
                </p>
                <p className="text-muted truncate text-xs">
                  {serviceName(channel.service)}
                  {channel.handle &&
                    channel.handle !== channel.name &&
                    ` · ${channel.handle}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {network ? (
                  <>
                    {network.status === 'expired' ? (
                      <Pill tone="expired">Reconnect Buffer</Pill>
                    ) : problem ? (
                      <Pill tone="expired">{problem}</Pill>
                    ) : (
                      <Pill tone="connected">
                        Publishing {networkName(network.platform)}
                      </Pill>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        stop({ platform: network.platform, name: network.name })
                      }
                      aria-haspopup="dialog"
                      className="hover:text-rose-600 dark:hover:text-rose-400"
                    >
                      <Unplug aria-hidden className="h-3.5 w-3.5" />
                      Stop
                    </Button>
                  </>
                ) : !publishable ? (
                  <Pill tone="disconnected">Not used here</Pill>
                ) : problem ? (
                  <Pill tone="expired">{problem}</Pill>
                ) : canPick ? (
                  <Button
                    size="sm"
                    loading={busy === channel.channelId}
                    disabled={busy !== null}
                    onClick={() =>
                      current?.status === 'connected'
                        ? setSwitching({ channel, current })
                        : void pick(channel)
                    }
                    title={`Publish approved ${networkName(channel.platform!)} posts to this account`}
                  >
                    {busy !== channel.channelId && (
                      <Send aria-hidden className="h-3.5 w-3.5" />
                    )}
                    Publish here
                  </Button>
                ) : (
                  <Pill tone="disconnected">Available</Pill>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="text-muted mt-2 text-xs">
        One account per network. Other networks in Buffer are listed for
        reference.
      </p>

      {switching && (
        <ConfirmDialog
          title={`Publish ${networkName(switching.channel.platform!)} to ${switching.channel.name}?`}
          description={
            <>
              {networkName(switching.channel.platform!)} posts go to{' '}
              <span className="text-foreground font-medium">
                {switching.channel.name}
              </span>{' '}
              instead of {switching.current.name ?? 'the current account'}.
              Scheduled {networkName(switching.channel.platform!)} posts are
              cancelled and auto-publishing turns off.
            </>
          }
          confirmLabel="Yes, switch"
          pendingLabel="Switching…"
          pending={busy !== null}
          onCancel={() => setSwitching(null)}
          onConfirm={() => void pick(switching.channel)}
        />
      )}
      {stopDialog}
    </div>
  )
}

/**
 * The identity's network connections no channel row above shows: made the
 * old way (their own Buffer token or API key, still publishing), or on a
 * channel no longer in the Buffer account. Each can be stopped.
 */
function OtherConnections({
  channels,
  networks
}: {
  channels: BufferChannelSummary[]
  networks: ConnectionSummary[]
}) {
  const titleId = useId()
  const { stop, dialog } = useStopNetwork()
  const others = networks.filter(
    n =>
      n.status !== 'disconnected' &&
      !(n.viaBufferConnection && channels.some(c => c.channelId === n.memberId))
  )
  if (others.length === 0) return null
  return (
    <div role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-foreground mb-2 text-sm font-semibold">
        Other connections
      </h3>
      <ul className="border-border divide-border divide-y rounded-xl border">
        {others.map(n => (
          <li
            key={n.platform}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5"
          >
            <ChannelAvatar
              name={n.name ?? networkName(n.platform)}
              avatarUrl={n.pictureUrl}
              service={n.platform}
            />
            <div className="min-w-0 flex-1 basis-40">
              <p className="text-foreground truncate text-sm">
                {n.name ?? `${networkName(n.platform)} account`}
              </p>
              <p className="text-muted text-xs">
                {networkName(n.platform)} ·{' '}
                {n.viaBufferConnection
                  ? 'no longer in your Buffer account: publish another account above'
                  : n.platform === 'linkedin'
                    ? 'connected directly, which no longer publishes: choose a LinkedIn account above'
                    : 'older Buffer authorization, still publishing'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Pill
                tone={
                  n.status === 'expired' ||
                  n.viaBufferConnection ||
                  n.platform === 'linkedin'
                    ? 'expired'
                    : 'connected'
                }
              >
                {n.status === 'expired'
                  ? 'Expired'
                  : n.viaBufferConnection || n.platform === 'linkedin'
                    ? 'Unavailable'
                    : 'Connected'}
              </Pill>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => stop({ platform: n.platform, name: n.name })}
                aria-haspopup="dialog"
                className="hover:text-rose-600 dark:hover:text-rose-400"
              >
                <Unplug aria-hidden className="h-3.5 w-3.5" />
                Stop
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {dialog}
    </div>
  )
}

/** Auto-publishing, one row per network publishing through Buffer now. */
function AutoPublishing({ networks }: { networks: ConnectionSummary[] }) {
  const titleId = useId()
  const live = networks.filter(n => n.status === 'connected')
  if (live.length === 0) return null
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="border-border border-t pt-5"
    >
      <h3
        id={titleId}
        className="text-foreground flex items-center gap-2.5 text-sm font-semibold"
      >
        <span className="bg-accent/10 rounded-lg p-1.5">
          <CalendarClock aria-hidden className="text-accent h-4 w-4" />
        </span>
        Auto-publishing
      </h3>
      <p
        className="text-muted mt-1 text-xs leading-relaxed"
        title="Only approved posts are published. A post approved or planned for today after this time is not published automatically: publish it yourself."
      >
        Approved posts planned on the Schedule go out on their day at the time
        set for their network.
      </p>
      <div className="mt-4 space-y-2">
        {live.map(n => (
          <AutoPublishSection
            key={n.platform}
            platform={getPlatform(n.platform)}
            connection={n}
            compact
          />
        ))}
      </div>
    </div>
  )
}
