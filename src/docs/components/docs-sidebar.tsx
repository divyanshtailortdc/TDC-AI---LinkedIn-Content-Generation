'use client'

import { useModifierKeyLabel } from '@/docs/components/docs-search'
import {
  DOCS_NAV,
  docHref,
  docSlugFromPathname,
  type DocNavItem,
  type DocNavSection
} from '@/docs/nav'
import { cn } from '@/lib/cn'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'

function containsSlug(item: DocNavItem, slug: string | null): boolean {
  if (slug === null) return false
  return (
    item.slug === slug ||
    (item.items ?? []).some(child => containsSlug(child, slug))
  )
}

/** A page link, or a group that folds its pages under it. */
function NavItem({
  item,
  slug,
  depth
}: {
  item: DocNavItem
  slug: string | null
  depth: number
}) {
  const panelId = useId()
  const linkRef = useRef<HTMLAnchorElement>(null)
  const active = item.slug !== undefined && item.slug === slug
  const containsActive = !active && containsSlug(item, slug)
  const [expanded, setExpanded] = useState(containsActive)
  // Coming into the group from another page opens it; adjusted while
  // rendering so it never paints closed first (as in the app's sidebar).
  const [wasActive, setWasActive] = useState(containsActive)
  if (containsActive !== wasActive) {
    setWasActive(containsActive)
    if (containsActive) setExpanded(true)
  }

  useEffect(() => {
    if (active) linkRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (item.items) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setExpanded(open => !open)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors',
            containsActive && !expanded
              ? 'text-brand-strong font-medium'
              : 'text-foreground/85 hover:bg-foreground/5 hover:text-foreground'
          )}
        >
          <span className="flex-1">{item.title}</span>
          <ChevronRight
            aria-hidden
            className={cn(
              'text-muted h-3.5 w-3.5 shrink-0 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        </button>
        <ul
          id={panelId}
          hidden={!expanded}
          className="border-sidebar-border mt-0.5 mb-1 ml-3 space-y-0.5 border-l pl-2"
        >
          {item.items.map(child => (
            <NavItem
              key={child.slug ?? child.title}
              item={child}
              slug={slug}
              depth={depth + 1}
            />
          ))}
        </ul>
      </li>
    )
  }

  return (
    <li className="relative">
      {active && depth === 0 && (
        <span
          aria-hidden
          className="bg-brand absolute top-1 bottom-1 -left-3 w-0.75 rounded-r-full"
        />
      )}
      <Link
        ref={linkRef}
        href={docHref(item.slug ?? '')}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block rounded-lg px-3 py-1.5 text-sm transition-colors',
          active
            ? 'bg-brand/15 text-brand-strong font-medium'
            : 'text-foreground/85 hover:bg-foreground/5 hover:text-foreground'
        )}
      >
        {item.title}
      </Link>
    </li>
  )
}

function NavSection({
  section,
  slug,
  collapsed,
  onToggle
}: {
  section: DocNavSection
  slug: string | null
  collapsed: boolean
  onToggle: () => void
}) {
  const panelId = useId()
  const hasActive = section.items.some(item => containsSlug(item, slug))
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        className={cn(
          'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase transition-colors',
          hasActive ? 'text-brand-strong' : 'text-muted hover:text-foreground'
        )}
      >
        {section.title}
        <ChevronDown
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-200',
            collapsed && '-rotate-90'
          )}
        />
      </button>
      <ul id={panelId} hidden={collapsed} className="mt-1 space-y-0.5">
        {section.items.map(item => (
          <NavItem
            key={item.slug ?? item.title}
            item={item}
            slug={slug}
            depth={0}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * The help pages, by section. Every section starts open; one the reader
 * folds stays folded until they open it or go to a page in it.
 */
export function DocsSidebar({
  pathname,
  open,
  onClose,
  onSearch
}: {
  pathname: string
  /** The drawer, below `lg`; from `lg` up the sidebar is always shown. */
  open: boolean
  onClose: () => void
  onSearch: () => void
}) {
  const slug = docSlugFromPathname(pathname)
  const modifier = useModifierKeyLabel()
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const activeSection = DOCS_NAV.find(section =>
    section.items.some(item => containsSlug(item, slug))
  )?.title
  // Going to a page in a folded section opens it.
  const [shownSection, setShownSection] = useState(activeSection)
  if (activeSection !== shownSection) {
    setShownSection(activeSection)
    if (activeSection && collapsed.has(activeSection)) {
      const next = new Set(collapsed)
      next.delete(activeSection)
      setCollapsed(next)
    }
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const toggle = (title: string) => {
    const next = new Set(collapsed)
    if (next.has(title)) next.delete(title)
    else next.add(title)
    setCollapsed(next)
  }

  return (
    <>
      {open && (
        <div
          aria-hidden
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}
      <aside
        aria-label="Documentation"
        className={cn(
          'border-sidebar-border bg-sidebar fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] -translate-x-full flex-col border-r shadow-xl transition-transform duration-200 ease-in-out',
          'lg:bg-background lg:sticky lg:top-16 lg:z-auto lg:h-[calc(100dvh-4rem)] lg:max-w-none lg:translate-none lg:shadow-none lg:transition-none',
          open && 'translate-x-0'
        )}
      >
        <div className="flex items-center justify-between px-4 pt-4 lg:hidden">
          <span className="text-foreground text-sm font-semibold">
            Documentation
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close documentation menu"
            className="border-sidebar-border bg-surface text-muted hover:bg-surface-hover hover:text-foreground flex h-8 w-8 items-center justify-center rounded-lg border transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-4 pb-2">
          <button
            type="button"
            onClick={onSearch}
            className="border-border bg-surface text-muted hover:border-brand/50 hover:text-foreground flex h-10 w-full items-center gap-2.5 rounded-xl border px-3 text-sm transition-colors"
          >
            <Search aria-hidden className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left">
              Search docs…
            </span>
            <kbd className="border-border bg-background hidden rounded-md border px-1.5 py-0.5 font-mono text-[11px] lg:inline">
              {modifier} K
            </kbd>
          </button>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-4 pt-2 pb-8">
          {DOCS_NAV.map(section => (
            <NavSection
              key={section.title}
              section={section}
              slug={slug}
              collapsed={collapsed.has(section.title)}
              onToggle={() => toggle(section.title)}
            />
          ))}
        </nav>
      </aside>
    </>
  )
}
