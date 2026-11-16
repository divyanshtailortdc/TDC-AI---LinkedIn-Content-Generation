'use client'

import { PlatformMark } from '@/components/platform-mark'
import { Button } from '@/components/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import type { PlatformSpec } from '@/lib/platforms'
import type { ConnectionSummary } from '@/lib/publishing/connection'
import { CalendarClock } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { saveAutoPublish } from './actions'

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
 * Opt-in auto-publishing to one network: approved posts planned for a day go
 * out that day. The Buffer card shows one, compact, per network.
 */
export function AutoPublishSection({
  platform,
  connection,
  compact = false
}: {
  platform: PlatformSpec
  connection: ConnectionSummary
  /**
   * One boxed row named by its network, without the heading and description
   * (the Buffer card lists one per network under a heading of its own).
   */
  compact?: boolean
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
    <div
      role="group"
      aria-labelledby={titleId}
      className={compact ? undefined : 'border-border mt-5 border-t pt-5'}
    >
      {compact && (
        <span id={titleId} className="sr-only">
          Auto-publishing to {platform.name}
        </span>
      )}
      {!compact && (
      <>
      <h3
        id={titleId}
        className="text-foreground flex flex-wrap items-center gap-2.5 text-sm font-semibold"
      >
        <span className="bg-accent/10 rounded-lg p-1.5">
          <CalendarClock aria-hidden className="text-accent h-4 w-4" />
        </span>
        Auto-publishing
        {/* What is saved, so the schedule reads at a glance. */}
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            connection.autoPublish
              ? STATUS.connected.className
              : STATUS.disconnected.className
          )}
        >
          {connection.autoPublish
            ? `On · daily at ${connection.autoPublishTime}`
            : 'Off'}
        </span>
      </h3>
      {/* The rules for posts approved late, or for a time already past, are
          in the hover text; the line says only what it does. */}
      <p
        className="text-muted mt-1 text-xs leading-relaxed"
        title="Only approved posts are published. A post approved or planned for today after this time is not published automatically: publish it yourself."
      >
        Approved posts planned on the{' '}
        <Link href="/schedule" className="text-accent hover:underline">
          Schedule
        </Link>{' '}
        go out on their day at this time.
      </p>
      </>
      )}

      {/* Boxed like the account row above, Save lined up with its buttons. */}
      <div
        className={cn(
          'border-border flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3.5',
          !compact && 'mt-4'
        )}
      >
        {compact && (
          <span className="text-foreground flex w-28 shrink-0 items-center gap-2 text-sm font-medium">
            <PlatformMark platform={platform.id} colored className="h-4 w-4" />
            {platform.name}
          </span>
        )}
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
            Publish automatically
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
          className="ml-auto"
        >
          Save
        </Button>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Turn on auto-publishing?"
          description={
            <>
              Approved posts planned on the Schedule go out to {platform.name}{' '}
              at {time} ({zone}) on their day. You can turn this off any time.
            </>
          }
          confirmLabel="Yes, turn it on"
          pendingLabel="Saving…"
          pending={saving}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      )}
    </div>
  )
}
