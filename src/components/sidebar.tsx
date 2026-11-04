'use client'

import { useMobileNav } from '@/components/mobile-nav'
import { UserMenu } from '@/components/user-menu'
import logoDark from '@/img/tdccommercelogo-dark.webp'
import logoLight from '@/img/tdccommercelogo.webp'
import { BRAND_THEME_PATH } from '@/lib/brand/theme-path'
import { cn } from '@/lib/cn'
import { IDENTITY_PATH } from '@/lib/identity-path'
import { useIdeasToReview } from '@/lib/ideas-badge'
import { INBOX_PATH } from '@/lib/inbox-path'
import { LIBRARY_PATH } from '@/lib/library-path'
import { NEWSLETTERS_PATH } from '@/lib/newsletters-path'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/sidebar-pref'
import {
  BookOpen,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  Newspaper,
  Palette,
  Play,
  Plus,
  Search,
  Settings,
  Target,
  UserRound,
  X
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore
} from 'react'

type SubNavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboard
  /** Active only on this exact path, not the paths under it. */
  exact?: boolean
  /** How many things are waiting here, as on NavLink. */
  badge?: number
}

function isSubNavActive(pathname: string, { href, exact }: SubNavItem) {
  return exact ? pathname === href : pathname.startsWith(href)
}

// In the order the work moves: find newsletters and subscribe, read what
// arrives, then keep the stories worth saving to the Knowledge base.
// Discover is the section's own path, which the other two start with.
const newsletterNavItems: SubNavItem[] = [
  { href: NEWSLETTERS_PATH, label: 'Discover', icon: Search, exact: true },
  { href: INBOX_PATH, label: 'Inbox', icon: Inbox },
  { href: LIBRARY_PATH, label: 'Library', icon: BookOpen }
]

// In the order work moves: the newsletters that come in, the runs and posts
// they produce, then when each post goes out. Goals and Ideas sit under
// Account Setup.
const primaryNavItems = [
  {
    href: NEWSLETTERS_PATH,
    label: 'Newsletters',
    icon: Newspaper,
    items: newsletterNavItems
  },
  { href: '/runs', label: 'Run Details', icon: Play },
  { href: '/posts', label: 'Posts', icon: FileText },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays }
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
  badge = 0,
  nested = false
}: {
  href: string
  label: string
  icon: typeof LayoutDashboard
  active: boolean
  collapsed: boolean
  /** How many things are waiting here; shown as a count, and bolds the label. */
  badge?: number
  /** A page inside an expanded NavGroup: smaller, under its group's label. */
  nested?: boolean
}) {
  // Prefetched once the pointer or focus reaches the link, not as soon as it
  // is on screen: every page is rendered on the server, so prefetching all of
  // them sent a request per link, again after each navigation or action.
  const [intent, setIntent] = useState(false)
  const showIntent = () => setIntent(true)
  return (
    <Link
      href={href}
      prefetch={intent ? null : false}
      onMouseEnter={showIntent}
      onFocus={showIntent}
      onTouchStart={showIntent}
      title={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center rounded-xl transition-colors',
        nested ? 'h-10 gap-3 px-3 text-sm' : 'h-11 text-[15px]',
        !nested && (collapsed ? 'justify-center px-0' : 'gap-3.5 px-3.5'),
        badge > 0 ? 'font-semibold' : 'font-medium',
        active
          ? 'bg-brand/20 text-brand-strong'
          : 'text-foreground hover:bg-foreground/10 hover:shadow-xs'
      )}
    >
      {/* The active page's marker, flush against the sidebar's left edge. */}
      {active && !nested && (
        <span
          aria-hidden
          className="bg-brand absolute top-0 -left-3 h-full w-0.75 rounded-r-full"
        />
      )}
      <Icon
        className={cn('shrink-0', nested ? 'h-4 w-4' : 'h-5 w-5')}
        strokeWidth={1.75}
      />
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

/**
 * A nav entry whose pages fold under it, joined by a branch line. It opens
 * on its own when one of its pages becomes the current one, so that page is
 * never hidden; otherwise the user's toggle decides. The collapsed rail has
 * no room for labels, so there it lists the pages as icons instead.
 */
function NavGroup({
  label,
  icon: Icon,
  items,
  pathname,
  collapsed
}: {
  label: string
  icon: typeof LayoutDashboard
  items: SubNavItem[]
  pathname: string
  collapsed: boolean
}) {
  const panelId = useId()
  const containsActive = items.some(item => isSubNavActive(pathname, item))
  const [expanded, setExpanded] = useState(containsActive)
  // Coming into the group from another page opens it; adjusted while
  // rendering rather than in an effect, so it never paints closed first.
  const [wasActive, setWasActive] = useState(containsActive)
  if (containsActive !== wasActive) {
    setWasActive(containsActive)
    if (containsActive) setExpanded(true)
  }
  // Folded away, the group shows what is waiting in its pages.
  const badge = items.reduce((sum, item) => sum + (item.badge ?? 0), 0)
  const showBadge = badge > 0 && !expanded

  if (collapsed) {
    return items.map(item => (
      <NavLink
        key={item.href}
        href={item.href}
        label={item.label}
        icon={item.icon}
        active={isSubNavActive(pathname, item)}
        collapsed
        badge={item.badge}
      />
    ))
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(open => !open)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className={cn(
          'relative flex h-11 w-full items-center gap-3.5 rounded-xl px-3.5 text-[15px] transition-colors',
          showBadge ? 'font-semibold' : 'font-medium',
          // Folded away, the group itself shows that the current page is in it.
          containsActive && !expanded
            ? 'bg-brand/20 text-brand-strong'
            : 'text-foreground hover:bg-foreground/10 hover:shadow-xs'
        )}
      >
        {containsActive && !expanded && (
          <span
            aria-hidden
            className="bg-brand absolute top-0 -left-3 h-full w-0.75 rounded-r-full"
          />
        )}
        <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{label}</span>
        {showBadge && (
          <span className="bg-brand/20 text-brand-strong ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        <ChevronDown
          aria-hidden
          className={cn(
            'text-muted h-4 w-4 shrink-0 transition-transform duration-200',
            !showBadge && 'ml-auto',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {/* Rows animate from 0fr to 1fr, so the panel opens to its own height. */}
      <div
        id={panelId}
        inert={!expanded}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <ul className="overflow-hidden pt-1">
          {items.map((item, index) => (
            <li key={item.href} className="relative pb-1 pl-10">
              {/* The branch into this page, from the line under the group's icon. */}
              <span
                aria-hidden
                className="border-sidebar-border absolute -top-1 left-6 h-[calc(50%+0.125rem)] w-3 rounded-bl-lg border-b border-l"
              />
              {/* The line carried on down to the next page. */}
              {index < items.length - 1 && (
                <span
                  aria-hidden
                  className="bg-sidebar-border absolute top-1/2 bottom-0 left-6 w-px"
                />
              )}
              <NavLink
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isSubNavActive(pathname, item)}
                collapsed={false}
                badge={item.badge}
                nested
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
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
  const ideasBadge = useIdeasToReview(ideasToReview)
  const [collapsedPref, setCollapsed] = useSidebarCollapsed(initialCollapsed)
  const isDesktop = useIsDesktop()
  const { open, setOpen } = useMobileNav()
  // The drawer always shows the full sidebar; only the desktop rail collapses.
  const collapsed = collapsedPref && isDesktop
  // Brand Theme styles the identity's posts, so it waits for one.
  const accountSetupItems: SubNavItem[] = [
    {
      href: IDENTITY_PATH,
      label: hasIdentity ? 'Identity Setup' : 'Set up identity',
      icon: hasIdentity ? UserRound : Plus
    },
    { href: '/goals', label: 'Goals', icon: Target },
    { href: '/ideas', label: 'Ideas', icon: Lightbulb, badge: ideasBadge },
    ...(hasIdentity
      ? [{ href: BRAND_THEME_PATH, label: 'Brand Theme', icon: Palette }]
      : [])
  ]
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

          <NavSection label="Workspace" collapsed={collapsed} />
          <NavGroup
            label="Account Setup"
            icon={Settings}
            items={accountSetupItems}
            pathname={pathname}
            collapsed={collapsed}
          />

          <NavSection label="Publishing" collapsed={collapsed} />
          {primaryNavItems.map(({ href, label, icon, ...rest }) => {
            if (rest.items)
              return (
                <NavGroup
                  key={href}
                  label={label}
                  icon={icon}
                  items={rest.items}
                  pathname={pathname}
                  collapsed={collapsed}
                />
              )
            return (
              <NavLink
                key={href}
                href={href}
                label={label}
                icon={icon}
                active={pathname.startsWith(href)}
                collapsed={collapsed}
              />
            )
          })}
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
