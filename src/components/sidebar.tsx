'use client'

import { useMobileNav } from '@/components/mobile-nav'
import { UserMenu } from '@/components/user-menu'
import logoDark from '@/img/tdccommercelogo-dark.webp'
import logoLight from '@/img/tdccommercelogo.webp'
import { cn } from '@/lib/cn'
import { IDENTITY_PATH } from '@/lib/identity-path'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/sidebar-pref'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Lightbulb,
  Play,
  Plus,
  Settings,
  X
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

const primaryNavItems = [
  { href: '/ideas', label: 'Ideas', icon: Lightbulb, badge: 'ideas' as const },
  { href: '/runs', label: 'Run Details', icon: Play },
  { href: '/posts', label: 'Posts', icon: FileText }
]

/** Heading above a group of nav links; a thin divider in the collapsed rail. */
function NavSection({
  label,
  collapsed
}: {
  label: string
  collapsed: boolean
}) {
  return collapsed ? (
    <div aria-hidden className="bg-sidebar-border mx-2 mt-4 mb-2 h-px" />
  ) : (
    <p className="text-muted mt-5 mb-1.5 px-3.5 text-[11px] font-semibold tracking-[0.14em] uppercase">
      {label}
    </p>
  )
}

const STORAGE_KEY = 'sidebar-collapsed'
function writeCollapsedCookie(collapsed: boolean) {
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${collapsed ? '1' : '0'}; path=/; max-age=31536000; samesite=lax`
}

function subscribeToCollapsedPref(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

function readCollapsedPref() {
  return window.localStorage.getItem(STORAGE_KEY) === '1'
}

// The sidebar is a slide-out drawer below `lg` (matches Tailwind's breakpoint);
// the collapsed rail only exists on screens wide enough to keep it visible.
const DESKTOP_QUERY = '(min-width: 1024px)'

function subscribeToDesktop(onChange: () => void) {
  const mql = window.matchMedia(DESKTOP_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true
  )
}

/**
 * Persisted collapse state for the sidebar rail, shared via localStorage.
 * `initialCollapsed` comes from a cookie the server reads, so the first paint
 * and hydration already match the stored choice instead of flashing open.
 */
function useSidebarCollapsed(initialCollapsed: boolean) {
  const collapsed = useSyncExternalStore(
    subscribeToCollapsedPref,
    readCollapsedPref,
    () => initialCollapsed
  )
  // A preference saved before the cookie existed: copy it over once, so the
  // next load renders collapsed on the server as well.
  useEffect(() => {
    if (readCollapsedPref() !== initialCollapsed)
      writeCollapsedCookie(readCollapsedPref())
  }, [initialCollapsed])
  const setCollapsed = useCallback((next: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
    writeCollapsedCookie(next)
    // storage events only fire in *other* tabs; dispatch here so this tab's
    // subscribers (this hook) re-read the value too.
    window.dispatchEvent(new Event('storage'))
  }, [])
  return [collapsed, setCollapsed] as const
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
  badge = 0
}: {
  href: string
  label: string
  icon: typeof LayoutDashboard
  active: boolean
  collapsed: boolean
  /** How many things are waiting here; shown as a count, and bolds the label. */
  badge?: number
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-11 items-center rounded-xl text-[15px] transition-colors',
        collapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5',
        badge > 0 ? 'font-semibold' : 'font-medium',
        active
          ? 'bg-brand/20 text-brand-strong'
          : 'text-foreground hover:bg-foreground/10 hover:shadow-xs'
      )}
    >
      {/* The active page's marker, flush against the sidebar's left edge. */}
      {active && (
        <span
          aria-hidden
          className="bg-brand absolute top-0 -left-3 h-full w-0.75 rounded-r-full"
        />
      )}
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge > 0 && (
        <span className="bg-brand/20 text-brand-strong ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {collapsed && badge > 0 && (
        <span
          aria-hidden
          className="bg-brand ring-sidebar absolute top-2 right-2.5 h-2.5 w-2.5 rounded-full ring-2"
        />
      )}

      {/* Tooltip shown only in collapsed rail mode */}
      {collapsed && (
        <span className="bg-foreground text-background pointer-events-none absolute left-full z-30 ml-3 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
          {label}
        </span>
      )}
    </Link>
  )
}

export function Sidebar({
  hasIdentity,
  ideasToReview = 0,
  initialCollapsed = false,
  user
}: {
  /** The signed-in user has set up their identity. */
  hasIdentity: boolean
  /** Ideas of the identity still waiting for approval. */
  ideasToReview?: number
  /** The collapse preference from its cookie, for the server render. */
  initialCollapsed?: boolean
  /** The signed-in user, shown at the foot with the account menu. */
  user: { name: string; email: string }
}) {
  const pathname = usePathname()
  const [collapsedPref, setCollapsed] = useSidebarCollapsed(initialCollapsed)
  const isDesktop = useIsDesktop()
  const { open, setOpen } = useMobileNav()
  // The drawer always shows the full sidebar; only the desktop rail collapses.
  const collapsed = collapsedPref && isDesktop
  const toggle = () => setCollapsed(!collapsedPref)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}
      <aside
        className={cn(
          'border-sidebar-border bg-sidebar fixed inset-y-0 left-0 z-50 flex h-full w-70 max-w-[85vw] shrink-0 -translate-x-full flex-col border-r shadow-xl transition-transform duration-200 ease-in-out',
          'lg:static lg:z-auto lg:max-w-none lg:translate-none lg:shadow-none lg:transition-[width]',
          open && 'translate-x-0',
          collapsedPref && 'lg:w-19'
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            'border-sidebar-border relative flex items-center border-b py-4',
            collapsed
              ? 'justify-center px-2'
              : 'flex-col justify-center gap-2 px-5'
          )}
        >
          {collapsed ? (
            <div className="bg-accent text-background flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold">
              TDC
            </div>
          ) : (
            <>
              {/* Both variants render; CSS picks one so the logo is correct during SSR
                and never flashes the wrong ink while next-themes hydrates. */}
              <Image
                src={logoLight}
                alt="TDC Commerce"
                priority
                className="h-8 w-auto self-start dark:hidden"
              />
              <Image
                src={logoDark}
                alt="TDC Commerce"
                priority
                className="hidden h-8 w-auto self-start dark:block"
              />
              <p className="text-muted pl-1 text-[11px] leading-none font-medium tracking-[0.14em] uppercase">
                LinkedIn Content Engine
              </p>
            </>
          )}

          {/* Close the drawer (below lg only) */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="border-sidebar-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-lg border transition-colors lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Collapse toggle (lg and up only) */}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'border-sidebar-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground absolute hidden items-center justify-center border transition-colors lg:flex',
              collapsed
                ? 'top-1/2 -right-3 h-6 w-6 -translate-y-1/2 rounded-full shadow-sm'
                : 'top-4 right-4 h-8 w-8 rounded-lg'
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1.5 overflow-x-visible overflow-y-auto px-3 py-5">
          <NavLink
            href="/"
            label="Dashboard"
            icon={LayoutDashboard}
            active={pathname === '/'}
            collapsed={collapsed}
          />

          <NavSection label="Primary" collapsed={collapsed} />
          {primaryNavItems.map(({ href, label, icon, ...rest }) => {
            const active = pathname.startsWith(href)
            return (
              <NavLink
                key={href}
                href={href}
                label={label}
                icon={icon}
                active={active}
                collapsed={collapsed}
                badge={'badge' in rest ? ideasToReview : 0}
              />
            )
          })}

          <NavSection label="Setup" collapsed={collapsed} />
          <NavLink
            href={IDENTITY_PATH}
            label={hasIdentity ? 'Account Setup' : 'Set up identity'}
            icon={hasIdentity ? Settings : Plus}
            active={pathname.startsWith(IDENTITY_PATH)}
            collapsed={collapsed}
          />
        </nav>

        <div
          className={cn(
            'border-sidebar-border border-t py-3',
            collapsed ? 'px-2' : 'px-3'
          )}
        >
          <UserMenu user={user} collapsed={collapsed} />
          {/* {!collapsed && (
          <p className="mt-2.5 px-1 text-xs text-muted">Phase 1 · v0.1</p>
        )} */}
        </div>
      </aside>
    </>
  )
}
