'use client'

import { Button } from '@/components/button'
import { FormAlert } from '@/components/form-alert'
import { showToast } from '@/components/toast-notification'
import { initialsOf } from '@/lib/initials'
import { Users } from 'lucide-react'
import { useId, useState } from 'react'
import {
  connectWithBuffer,
  listBufferAccounts,
  switchBufferAccount
} from './actions'

type Channel = { id: string; name: string; avatar: string | null }

/**
 * Connecting X, Facebook or Instagram through Buffer: the user pastes a
 * Buffer API key, the server checks it by listing the platform's accounts
 * connected in that Buffer account, and saves it (encrypted) with the one
 * picked. The key is only ever sent to the server, never shown again.
 */
export function BufferConnectForm({
  platform,
  platformName,
  onDone
}: {
  platform: string
  platformName: string
  onDone: () => void
}) {
  const keyId = useId()
  const [apiKey, setApiKey] = useState('')
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [channelId, setChannelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    setError(null)
    const res = await connectWithBuffer(platform, {
      apiKey,
      channelId: channelId ?? undefined
    }).catch(() => ({
      success: false as const,
      error: `${platformName} could not be connected. Please try again.`,
      channels: undefined
    }))
    setSaving(false)
    if (res.success) {
      setApiKey('')
      showToast({
        type: 'success',
        title: `${platformName} is connected`,
        message: `Approved ${platformName} posts publish as ${res.name}, through Buffer.`
      })
      onDone()
      return
    }
    if (res.channels) {
      setChannels(res.channels)
      setChannelId(current =>
        res.channels!.some(c => c.id === current) ? current : null
      )
    }
    setError(res.error)
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        void submit()
      }}
      className="border-border space-y-3 rounded-xl border p-4"
    >
      <ol className="text-muted list-decimal space-y-1 pl-4 text-xs leading-relaxed">
        <li>
          In{' '}
          <a
            href="https://publish.buffer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Buffer
          </a>
          , connect your {platformName} account as a channel.
        </li>
        <li>
          Create an API key in Buffer under{' '}
          <a
            href="https://publish.buffer.com/settings/api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Settings → API
          </a>
          .
        </li>
        <li>Paste it here. It is stored encrypted and never shown again.</li>
      </ol>

      <div className="space-y-1.5">
        <label htmlFor={keyId} className="text-foreground text-xs font-medium">
          Buffer API key
        </label>
        <input
          id={keyId}
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          value={apiKey}
          onChange={e => {
            setApiKey(e.target.value)
            // Another key may have other accounts.
            setChannels(null)
            setChannelId(null)
          }}
          className="border-border bg-surface-hover text-foreground h-9 w-full rounded-lg border px-3 font-mono text-sm"
        />
      </div>

      {channels && channels.length > 0 && (
        <ChannelOptions
          channels={channels}
          value={channelId}
          onChange={setChannelId}
        />
      )}

      {error && <FormAlert>{error}</FormAlert>}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          loading={saving}
          disabled={!apiKey.trim() || (channels !== null && !channelId)}
        >
          {channels ? 'Connect this account' : 'Check key and connect'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** A platform's accounts in a Buffer account, to pick the one to publish as. */
function ChannelOptions({
  channels,
  value,
  onChange
}: {
  channels: Channel[]
  value: string | null
  onChange: (id: string) => void
}) {
  const name = useId()
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-foreground text-xs font-medium">Publish as</legend>
      {channels.map(channel => (
        <label
          key={channel.id}
          className="border-border hover:bg-surface-hover flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2"
        >
          <input
            type="radio"
            name={name}
            value={channel.id}
            checked={value === channel.id}
            onChange={() => onChange(channel.id)}
            className="accent-accent"
          />
          {channel.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- Buffer's CDN, not configured for next/image
            <img
              src={channel.avatar}
              alt=""
              referrerPolicy="no-referrer"
              className="h-6 w-6 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="bg-platform/10 text-platform-text flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold"
            >
              {initialsOf(channel.name)}
            </span>
          )}
          <span className="text-foreground text-sm">{channel.name}</span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * Connected through Buffer's consent screen: switch to another account of
 * the same platform in the same Buffer account, without connecting again.
 * Lists them only when opened (each look is a Buffer request).
 */
export function BufferAccountSwitch({
  platform,
  platformName
}: {
  platform: string
  platformName: string
}) {
  const [open, setOpen] = useState(false)
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [channelId, setChannelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const openList = async () => {
    setOpen(true)
    setBusy(true)
    setError(null)
    const res = await listBufferAccounts(platform).catch(() => ({
      success: false as const,
      error: 'Buffer could not be reached. Please try again.'
    }))
    setBusy(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setChannels(res.channels)
    setChannelId(res.currentId)
  }

  const save = async () => {
    if (!channelId) return
    setBusy(true)
    const res = await switchBufferAccount(platform, channelId).catch(() => ({
      success: false as const,
      error: 'The account could not be changed. Please try again.'
    }))
    setBusy(false)
    if (!res.success) {
      setError(res.error)
      return
    }
    setOpen(false)
    showToast({
      type: 'success',
      title: `Publishing to ${platformName} as ${res.name}`
    })
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => void openList()}>
        <Users aria-hidden className="h-3.5 w-3.5" />
        Change account
      </Button>
    )
  }
  return (
    <div className="border-border basis-full space-y-3 rounded-xl border p-3">
      {channels && channels.length > 0 && (
        <ChannelOptions
          channels={channels}
          value={channelId}
          onChange={setChannelId}
        />
      )}
      {channels && channels.length === 0 && (
        <p className="text-muted text-xs">
          No {platformName} account is connected in your Buffer account.
        </p>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={!channelId}
          onClick={() => void save()}
        >
          Publish as this account
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
