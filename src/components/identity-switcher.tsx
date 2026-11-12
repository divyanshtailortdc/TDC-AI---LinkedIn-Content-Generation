'use client'

import { switchIdentity } from '@/app/(app)/identity/actions'
import { markDataChanged } from '@/components/refresh-on-back'
import { showToast } from '@/components/toast-notification'
import { cn } from '@/lib/cn'
import { NEW_IDENTITY_PATH } from '@/lib/identity-path'
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition } from 'react'

/** An identity as the switcher lists it. */
export type SwitcherIdentity = {
  id: string
  name: string
  handle: string
  accountType: string
}

const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)'

/** Up to two initials, e.g. "Priya Rao" → "PR". */
function initialsOf(name: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
  return (initials || '?').toUpperCase()
}

/**
 * Pages that show one identity's item (a post, a run): after a switch they
 * would show "not found", so the list they belong to opens instead.
 */
function pathAfterSwitch(pathname: string): string | null {
  const match = /^\/(posts|runs|ideas)\/[^/]+/.exec(pathname)
  return match ? `/${match[1]}` : null
}

/**
 * Which identity the app is working on, at the top of the sidebar, and the
 * way to switch to another or create one. Everything (goals, ideas, posts,
 * connections) is the active identity's.
 */
export function IdentitySwitcher({
  identities,
  activeId,
  collapsed = false
}: {
  identities: SwitcherIdentity[]
  activeId: string | null
  collapsed?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [switchingTo, setSwitchingTo] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const active = identities.find(i => i.id === activeId) ?? identities[0]

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  if (!active) return null

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const choose = (id: string) => {
    if (id === active.id) {
      close()
      return
    }
    setSwitchingTo(id)
    startTransition(async () => {
      const res = await switchIdentity(id)
      setSwitchingTo(null)
      if (!res.success) {
        showToast({ type: 'error', title: 'Could not switch', message: res.error })
        return
      }
      setOpen(false)
      markDataChanged()
      const next = pathAfterSwitch(pathname)
      if (next) router.push(next)
      router.refresh()
    })
  }

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

  const avatar = (identity: SwitcherIdentity, size = 'h-8 w-8') => (
    <span
      aria-hidden
      className={cn(
        'bg-accent/15 text-accent flex shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
        size
      )}
    >
      {initialsOf(identity.name)}
    </span>
  )

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
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
        title={collapsed ? `Working on ${active.name}` : undefined}
        aria-label={collapsed ? `Identity: ${active.name}. Switch identity` : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={cn(
          'hover:bg-foreground/10 focus-visible:ring-foreground/30 flex cursor-pointer items-center rounded-xl text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
          collapsed
            ? 'h-11 w-11 justify-center'
            : 'border-sidebar-border w-full gap-3 border px-2 py-2',
          open && 'bg-foreground/10'
        )}
      >
        {avatar(active)}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="text-muted block text-[10px] font-semibold tracking-wider uppercase">
                Identity
              </span>
              <span className="text-foreground block truncate text-[13px] font-medium">
                {active.name}
              </span>
            </span>
            <ChevronsUpDown aria-hidden className="text-muted h-4 w-4 shrink-0" />
          </>
        )}
      </button>

      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="Switch identity"
        tabIndex={-1}
        inert={!open}
        className={cn(
          'border-border bg-surface absolute z-50 rounded-xl border p-1.5 shadow-lg duration-150 ease-out focus:outline-none',
          collapsed
            ? 'top-0 left-full ml-3 w-64 origin-top-left'
            : 'inset-x-0 top-full mt-2 origin-top',
          open
            ? 'visible scale-100 opacity-100 motion-safe:transition-[opacity,scale]'
            : 'invisible scale-95 opacity-0 motion-safe:transition-[opacity,scale,visibility]'
        )}
      >
        <p className="text-muted px-2.5 pt-1 pb-1.5 text-[11px] font-medium">
          Your identities
        </p>
        <div className="max-h-64 overflow-y-auto">
          {identities.map(identity => {
            const current = identity.id === active.id
            return (
              <button
                key={identity.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                disabled={pending}
                onClick={() => choose(identity.id)}
                className="hover:bg-foreground/10 focus-visible:bg-foreground/10 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none disabled:opacity-60"
              >
                {avatar(identity, 'h-7 w-7')}
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-[13px] font-medium">
                    {identity.name}
                  </span>
                  <span className="text-muted block truncate text-[11px]">
                    {identity.accountType === 'company' ? 'Brand' : 'Person'} · @{identity.handle}
                  </span>
                </span>
                {switchingTo === identity.id ? (
                  <Loader2 aria-hidden className="text-muted h-4 w-4 animate-spin" />
                ) : current ? (
                  <Check aria-hidden className="text-accent h-4 w-4" />
                ) : null}
              </button>
            )
          })}
        </div>
        <div role="separator" className="bg-border mx-1 my-1.5 h-px" />
        <Link
          href={NEW_IDENTITY_PATH}
          role="menuitem"
          onClick={close}
          className="text-foreground hover:bg-foreground/10 focus-visible:bg-foreground/10 flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none"
        >
          <Plus aria-hidden className="text-muted h-4 w-4" />
          New identity
        </Link>
      </div>
    </div>
  )
}
