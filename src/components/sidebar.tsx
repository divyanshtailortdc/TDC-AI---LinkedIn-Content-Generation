'use client'

import { useCallback, useSyncExternalStore } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Lightbulb,
  FileText,
  Play,
  Settings,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { AccountSwitcher, type SwitchableAccount } from '@/components/account-switcher'
import { cn } from '@/lib/cn'
import logoLight from '@/img/tdccommercelogo.webp'
import logoDark from '@/img/tdccommercelogo-dark.webp'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb },
  { href: '/posts', label: 'Posts', icon: FileText },
  { href: '/runs', label: 'Run Details', icon: Play },
]

const STORAGE_KEY = 'sidebar-collapsed'

function subscribeToCollapsedPref(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}

function readCollapsedPref() {
  return window.localStorage.getItem(STORAGE_KEY) === '1'
}

// SSR/first paint has no localStorage, so the rail always starts expanded
// there; the client re-syncs to the stored preference right after.
function readCollapsedPrefServer() {
  return false
}

/** Persisted collapse state for the sidebar rail, shared via localStorage. */
function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(
    subscribeToCollapsedPref,
    readCollapsedPref,
    readCollapsedPrefServer
  )
  const setCollapsed = useCallback((next: boolean) => {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
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
  collapsed
}: {
  href: string
  label: string
  icon: typeof LayoutDashboard
  active: boolean
  collapsed: boolean
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        'group relative flex items-center rounded-2xl text-sm font-medium transition-colors',
        collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3.5 py-2.5',
        active
          ? 'bg-accent/10 text-accent'
          : 'text-muted hover:bg-surface-hover hover:text-foreground'
      )}
    >
      <Icon className="h-4.5 w-4.5 shrink-0" strokeWidth={2} />
      {!collapsed && <span className="truncate">{label}</span>}

      {/* Tooltip shown only in collapsed rail mode */}
      {collapsed && (
        <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 z-30">
          {label}
        </span>
      )}
    </Link>
  )
}

export function Sidebar({
  accounts,
  activeAccount
}: {
  accounts: SwitchableAccount[]
  activeAccount: SwitchableAccount | null
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useSidebarCollapsed()
  const toggle = () => setCollapsed(!collapsed)

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-19' : 'w-70'
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'relative flex items-center border-b border-sidebar-border py-4',
          collapsed ? 'justify-center px-2' : 'flex-col justify-center gap-2 px-5'
        )}
      >
        {collapsed ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-background text-xs font-bold">
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
              className="h-8 w-auto self-start hidden dark:block"
            />
            <p className="pl-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted/80 leading-none">
              LinkedIn Content Engine
            </p>
          </>
        )}

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-1/2 -right-3 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full border border-sidebar-border bg-surface text-muted shadow-sm transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav
        className={cn(
          'flex-1 overflow-y-auto overflow-x-visible py-4 space-y-1',
          collapsed ? 'px-3' : 'px-3'
        )}
      >
        {navItems.map(({ href, label, icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <NavLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={active}
              collapsed={collapsed}
            />
          )
        })}

        {/* Account settings targets the active identity, so its href is dynamic
            rather than part of the static navItems list. */}
        {activeAccount && (
          <NavLink
            href={`/accounts/${activeAccount.id}`}
            label="Account Settings"
            icon={Settings}
            active={pathname.startsWith('/accounts')}
            collapsed={collapsed}
          />
        )}
      </nav>

      {/* Active identity switcher */}
      <div className={cn('border-t border-sidebar-border py-3', collapsed ? 'px-2' : 'px-3')}>
        <AccountSwitcher
          accounts={accounts}
          activeAccount={activeAccount}
          collapsed={collapsed}
        />
        {/* {!collapsed && (
          <p className="mt-2.5 px-1 text-xs text-muted">Phase 1 · v0.1</p>
        )} */}
      </div>
    </aside>
  )
}
