'use client'

import { AddPasskeyButton } from '@/components/add-passkey-button'
import { SignOutButton } from '@/components/sign-out-button'
import { cn } from '@/lib/cn'
import { SECURITY_SETTINGS_PATH } from '@/lib/settings-path'
import { ChevronsUpDown, UserCog } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

type User = { name: string; email: string }

/** Up to two initials for the avatar, e.g. "Divyansh Tailor" → "DT". */
function initialsOf({ name, email }: User) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
  return (initials || email[0] || '?').toUpperCase()
}

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)'

/**
 * The signed-in user at the foot of the sidebar. Clicking it opens a menu
 * with the account actions (settings, add a passkey, sign out). In the collapsed rail
 * only the avatar shows, and the menu opens beside it with the name and email.
 */
export function UserMenu({
  user,
  collapsed = false
}: {
  user: User
  collapsed?: boolean
}) {
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'Escape') {
      // Kept from the window, so the mobile drawer stays open behind it.
      e.stopPropagation()
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

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      // Tabbing past the last item closes the menu.
      onBlur={e => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          setOpen(false)
      }}
      className={cn('relative', collapsed && 'flex justify-center')}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        title={collapsed ? user.name : undefined}
        aria-label={collapsed ? `Account menu for ${user.name}` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={cn(
          'hover:bg-foreground/10 focus-visible:ring-foreground/30 flex cursor-pointer items-center rounded-xl text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
          collapsed ? 'h-11 w-11 justify-center' : 'w-full gap-3 px-2 py-2',
          open && 'bg-foreground/10'
        )}
      >
        <span
          aria-hidden
          className="bg-brand/20 text-brand-strong flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        >
          {initialsOf(user)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="text-foreground block truncate text-[13px] font-medium">
                {user.name}
              </span>
              <span className="text-muted block truncate text-xs">
                {user.email}
              </span>
            </span>
            <ChevronsUpDown
              aria-hidden
              className="text-muted h-4 w-4 shrink-0"
            />
          </>
        )}
      </button>

      {/* Always mounted, so a sign-out confirmation or a passkey prompt
          started from it outlives the menu closing. */}
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="Account"
        tabIndex={-1}
        inert={!open}
        className={cn(
          'border-border bg-surface absolute z-50 rounded-xl border p-1.5 shadow-lg duration-150 ease-out focus:outline-none',
          collapsed
            ? 'bottom-0 left-full ml-3 w-60 origin-bottom-left'
            : 'inset-x-0 bottom-full mb-2 origin-bottom',
          // Visibility only transitions on close, so the items are
          // focusable the moment the menu opens.
          open
            ? 'visible scale-100 opacity-100 motion-safe:transition-[opacity,scale]'
            : 'invisible scale-95 opacity-0 motion-safe:transition-[opacity,scale,visibility]'
        )}
      >
        {collapsed && (
          <div className="border-border mb-1.5 border-b px-2.5 pt-1 pb-2.5">
            <p className="text-foreground truncate text-[13px] font-medium">
              {user.name}
            </p>
            <p className="text-muted truncate text-xs">{user.email}</p>
          </div>
        )}
        <Link
          href={SECURITY_SETTINGS_PATH}
          role="menuitem"
          onClick={close}
          className="text-foreground hover:bg-foreground/10 focus-visible:bg-foreground/10 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none"
        >
          <UserCog aria-hidden className="text-muted h-4 w-4" />
          Settings
        </Link>
        <AddPasskeyButton onSelect={close} />
        <div role="separator" className="bg-border mx-1 my-1.5 h-px" />
        <SignOutButton onSelect={close} returnFocusRef={triggerRef} />
      </div>
    </div>
  )
}
