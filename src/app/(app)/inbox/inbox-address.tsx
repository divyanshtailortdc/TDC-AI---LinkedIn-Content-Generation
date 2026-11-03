'use client'

import { Button } from '@/components/button'
import { showToast } from '@/components/toast-notification'
import { Copy, Pencil } from 'lucide-react'
import { useState, useTransition } from 'react'
import {
  LOCAL_PART_MAX,
  localPartError,
  normalizeLocalPart
} from '~/lib/mail/local-part'
import { changeInboxAddress } from './actions'

const ICON_BUTTON =
  'text-muted hover:bg-foreground/10 hover:text-foreground flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors'

/**
 * The identity's address under the Inbox title, with Copy, and Change to pick
 * another name at the domain. Without an address yet (none could be made from
 * the owner's name, or every one was taken) the form shows at once.
 */
export function InboxAddress({
  address,
  domain,
  earlierAddresses
}: {
  address: string | null
  domain: string
  /** Replaced addresses, which still deliver here. */
  earlierAddresses: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSaving] = useTransition()

  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      showToast({ type: 'success', title: 'Address copied', message: address })
    } catch {
      showToast({ type: 'error', title: 'Could not copy the address' })
    }
  }

  if (address && !editing) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-muted shrink-0">Your address</span>
        <code className="text-foreground truncate font-medium">{address}</code>
        <button
          type="button"
          onClick={copyAddress}
          aria-label="Copy the address"
          title="Copy"
          className={ICON_BUTTON}
        >
          <Copy aria-hidden className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setEditing(true)
          }}
          aria-label="Change the address"
          title="Change"
          className={ICON_BUTTON}
        >
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  const save = (value: string) => {
    const localPart = normalizeLocalPart(value, domain)
    const invalid = localPartError(localPart)
    if (invalid) {
      setError(invalid)
      return
    }
    startSaving(async () => {
      const res = await changeInboxAddress(localPart).catch(() => null)
      if (!res?.success) {
        setError(res?.error ?? 'Could not change the address.')
        return
      }
      setError(null)
      setEditing(false)
      showToast({
        type: 'success',
        title: 'Address changed',
        message: res.address
      })
    })
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        save(String(new FormData(e.currentTarget).get('localPart') ?? ''))
      }}
      className="space-y-2 text-sm"
    >
      <label htmlFor="inbox-local-part" className="text-muted block">
        {address
          ? 'Choose your new address'
          : 'Choose the address you subscribe to newsletters with'}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="border-border bg-surface-hover focus-within:ring-foreground/30 flex h-8 max-w-full min-w-0 items-center rounded-lg border focus-within:ring-2">
          <input
            id="inbox-local-part"
            name="localPart"
            defaultValue={address ? address.slice(0, address.indexOf('@')) : ''}
            maxLength={LOCAL_PART_MAX + domain.length + 1}
            placeholder="your.name"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'inbox-local-part-error' : undefined}
            className="text-foreground placeholder:text-muted h-full w-40 min-w-0 bg-transparent pl-3 font-mono text-[13px] focus:outline-none"
          />
          <span className="text-muted shrink-0 pr-3 font-mono text-[13px]">
            @{domain}
          </span>
        </div>
        <Button type="submit" size="sm" loading={saving}>
          Save
        </Button>
        {address && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <p
          id="inbox-local-part-error"
          role="alert"
          className="text-xs text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      )}
      <p className="text-muted text-xs">
        {address
          ? `${address} keeps delivering here, so newsletters already sent to it still arrive.`
          : 'Letters and numbers, with dots, hyphens or underscores between them.'}
        {earlierAddresses.length > 0 &&
          ` Earlier addresses that still deliver here: ${earlierAddresses.join(', ')}.`}
      </p>
    </form>
  )
}
