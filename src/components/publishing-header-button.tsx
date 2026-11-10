'use client'

import {
  FacebookMark,
  InstagramMark,
  PlatformMark,
  XMark
} from '@/components/platform-mark'
import { cn } from '@/lib/cn'
import type { PlatformSpec } from '@/lib/platforms'
import type { ConnectionStatus } from '@/lib/publishing/status'
import { INTEGRATIONS_SETTINGS_PATH } from '@/lib/settings-path'
import { ChevronDown, Settings } from 'lucide-react'
import Link from 'next/link'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'

/** The signed-in user's publishing connection, as the header shows it. */
export type PublishingHeaderStatus = {
  /** The platform posts are published to. */
  platform: PlatformSpec
  /** The server has a publishing app set up. */
  configured: boolean
  status: ConnectionStatus | null
  name: string | null
}

const PublishingStatusContext = createContext<PublishingHeaderStatus | null>(null)

/** Set once by the app layout, so every page's header can show it. */
export function PublishingStatusProvider({
  value,
  children
}: {
  value: PublishingHeaderStatus
  children: ReactNode
}) {
  return (
    <PublishingStatusContext.Provider value={value}>
      {children}
    </PublishingStatusContext.Provider>
  )
}

/** The user's publishing status, as the layout loaded it (null outside it). */
export const usePublishingStatus = () => useContext(PublishingStatusContext)

/**
 * Listed in the dropdown as coming soon: not in the platform registry
 * (src/lib/platforms) and without a publishing provider. One that gets both
 * leaves this list.
 */
const COMING_SOON: Array<{
  name: string
  Mark: (props: { className: string }) => ReactElement
}> = [
  { name: 'X', Mark: XMark },
  { name: 'Facebook', Mark: FacebookMark },
  { name: 'Instagram', Mark: InstagramMark }
]

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])'
const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors focus-visible:outline-none'
const ACTIVE_ITEM = 'hover:bg-foreground/10 focus-visible:bg-foreground/10'

/**
 * Publishing in the header, beside the theme button: a dropdown of the
 * platforms posts can be published to. The publishing platform shows its
 * state (connected, expired, not connected) on the button and in its row,
 * which connects (straight to the platform's consent screen) or opens
 * Settings → Integrations; the rest are listed as coming soon. Nothing when
 * publishing is not set up on this server.
 */
export function PublishingHeaderButton() {
  const publishing = usePublishingStatus()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!publishing?.configured) return null
  const { platform, status } = publishing

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    // Keys pressed in the menu must not reach the page's shortcuts (on Posts,
    // A approves and J/K change post), which listen on the window.
    e.stopPropagation()
    if (e.key === 'Escape') {
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = [
        ...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
      ]
      const step = e.key === 'ArrowDown' ? 1 : -1
      const index = items.indexOf(document.activeElement as HTMLElement)
      items[(index + step + items.length) % items.length]?.focus()
    }
  }

  // Disconnected counts as not connected.
  const state =
    status === 'connected' || status === 'expired' ? status : 'not_connected'
  const row = {
    connected: {
      detail: `as ${publishing.name ?? 'your account'}`,
      action: 'Connected',
      tone: 'text-emerald-700 dark:text-emerald-400',
      dot: 'bg-emerald-500'
    },
    expired: {
      detail: 'Connection expired',
      action: 'Reconnect',
      tone: 'text-amber-700 dark:text-amber-400',
      dot: 'bg-amber-500'
    },
    not_connected: {
      detail: 'Not connected',
      action: 'Connect',
      tone: 'text-platform-text',
      dot: null
    }
  }[state]
  // Shown on the button too, unless all is well.
  const buttonLabel =
    state === 'connected' ? null : `${row.action} ${platform.name}`

  const rowContent = (
    <>
      <PlatformMark
        platform={platform.id}
        className="text-platform-text h-4 w-4 shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block font-medium">
          {platform.name}
        </span>
        <span className="text-muted block truncate text-xs">{row.detail}</span>
      </span>
      <span className={cn('shrink-0 text-xs font-semibold', row.tone)}>
        {row.action}
      </span>
    </>
  )

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      // Tabbing past the last item closes the menu.
      onBlur={e => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          setOpen(false)
      }}
      className="relative shrink-0"
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Publishing connections"
        aria-label={
          buttonLabel
            ? undefined
            : `Publishing connections: ${platform.name} connected ${row.detail}`
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={cn(
          'border-border hover:bg-surface-hover inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium transition-colors',
          state === 'expired' ? row.tone : 'text-platform-text',
          open && 'bg-surface-hover'
        )}
      >
        <span className="relative">
          <PlatformMark platform={platform.id} className="h-4 w-4" />
          {row.dot && (
            <span
              aria-hidden
              className={cn(
                'border-surface absolute -right-1 -bottom-1 h-2.5 w-2.5 rounded-full border-2',
                row.dot
              )}
            />
          )}
        </span>
        {buttonLabel}
        <ChevronDown
          aria-hidden
          className={cn(
            'text-muted h-3.5 w-3.5 transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>

      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="Publishing connections"
        tabIndex={-1}
        inert={!open}
        className={cn(
          'border-border bg-surface absolute top-full right-0 z-50 mt-2 w-64 origin-top-right rounded-xl border p-1.5 shadow-lg duration-150 ease-out focus:outline-none',
          // Visibility only transitions on close, so the items are
          // focusable the moment the menu opens.
          open
            ? 'visible scale-100 opacity-100 motion-safe:transition-[opacity,scale]'
            : 'invisible scale-95 opacity-0 motion-safe:transition-[opacity,scale,visibility]'
        )}
      >
        <p className="text-muted px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide uppercase">
          Publish to
        </p>
        {state === 'not_connected' ? (
          // A plain link: the route redirects to the platform.
          <a
            href={`/api/integrations/${platform.id}/connect`}
            role="menuitem"
            onClick={close}
            title={`Connect the ${platform.name} account approved posts are published to`}
            className={cn(ITEM, ACTIVE_ITEM)}
          >
            {rowContent}
          </a>
        ) : (
          <Link
            href={INTEGRATIONS_SETTINGS_PATH}
            role="menuitem"
            onClick={close}
            className={cn(ITEM, ACTIVE_ITEM)}
          >
            {rowContent}
          </Link>
        )}
        {COMING_SOON.map(({ name, Mark }) => (
          <div
            key={name}
            role="menuitem"
            aria-disabled="true"
            className={cn(ITEM, 'text-muted cursor-default')}
          >
            <Mark className="h-4 w-4 shrink-0" />
            <span className="flex-1 font-medium">{name}</span>
            <span className="bg-surface-hover shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold">
              Coming soon
            </span>
          </div>
        ))}
        <div role="separator" className="bg-border mx-1 my-1.5 h-px" />
        <Link
          href={INTEGRATIONS_SETTINGS_PATH}
          role="menuitem"
          onClick={close}
          className={cn(ITEM, ACTIVE_ITEM, 'text-foreground font-medium')}
        >
          <Settings aria-hidden className="text-muted h-4 w-4" />
          Manage connections
        </Link>
      </div>
    </div>
  )
}
