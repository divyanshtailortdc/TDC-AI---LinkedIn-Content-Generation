'use client'

import { ThemeToggle } from '@/components/theme-toggle'
import {
  DocsSearchDialog,
  useModifierKeyLabel
} from '@/docs/components/docs-search'
import { DocsSidebar } from '@/docs/components/docs-sidebar'
import { DOCS_PATH } from '@/docs/nav'
import logoDark from '@/img/tdccommercelogo-dark.webp'
import logoLight from '@/img/tdccommercelogo.webp'
import { ArrowLeft, Menu, Search } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

/**
 * The frame of every help page: a header with search and the way back to the
 * app, the pages' navigation (a drawer below `lg`), and the search dialog,
 * opened with ⌘K / Ctrl+K or `/` anywhere in the docs.
 */
export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  // Remembered with the page it was opened on, so following a link in the
  // drawer closes it without an effect.
  const [navOpenedOn, setNavOpenedOn] = useState<string | null>(null)
  const navOpen = navOpenedOn === pathname
  const [searchOpen, setSearchOpen] = useState(false)
  const modifier = useModifierKeyLabel()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(open => !open)
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openSearch = () => {
    setNavOpenedOn(null)
    setSearchOpen(true)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border bg-background/85 sticky top-0 z-40 h-16 border-b backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[96rem] items-center gap-2 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setNavOpenedOn(pathname)}
            aria-label="Open documentation menu"
            className="text-muted hover:bg-surface-hover hover:text-foreground -ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg transition-colors lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Link
            href={DOCS_PATH}
            className="flex min-w-0 items-center gap-3"
            aria-label="Documentation home"
          >
            {/* Both render; CSS picks one, so the right ink shows before
                next-themes hydrates (as in the app's sidebar). */}
            <Image
              src={logoLight}
              alt="TDC Commerce"
              priority
              className="h-7 w-auto dark:hidden"
            />
            <Image
              src={logoDark}
              alt="TDC Commerce"
              priority
              className="hidden h-7 w-auto dark:block"
            />
            <span className="border-border hidden items-baseline gap-1.5 border-l pl-3 sm:flex">
              <span className="text-muted text-sm font-medium">
                Content Engine
              </span>
              <span className="text-brand-strong text-sm font-semibold">
                Docs
              </span>
            </span>
          </Link>

          {/* The search box in the middle of the bar, from lg up. */}
          <button
            type="button"
            onClick={openSearch}
            className="border-border bg-surface text-muted hover:border-brand/50 hover:text-foreground mx-auto hidden h-10 w-full max-w-md items-center gap-2.5 rounded-xl border px-3 text-sm transition-colors lg:flex"
          >
            <Search aria-hidden className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Search documentation…</span>
            <kbd className="border-border bg-background rounded-md border px-1.5 py-0.5 font-mono text-[11px]">
              {modifier} K
            </kbd>
          </button>

          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <button
              type="button"
              onClick={openSearch}
              aria-label="Search documentation"
              className="text-muted hover:bg-surface-hover hover:text-foreground flex h-9 w-9 items-center justify-center rounded-lg transition-colors lg:hidden"
            >
              <Search className="h-4.5 w-4.5" />
            </button>
            <ThemeToggle />
            <Link
              href="/"
              className="border-border bg-surface text-foreground hover:bg-surface-hover inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors"
            >
              <ArrowLeft aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">Back to app</span>
              <span className="sm:hidden">App</span>
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[96rem] flex-1">
        <DocsSidebar
          pathname={pathname}
          open={navOpen}
          onClose={() => setNavOpenedOn(null)}
          onSearch={openSearch}
        />
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <footer className="border-border text-muted border-t px-4 py-6 text-center text-sm">
        TDC Content Engine · Created by The Developer Company
      </footer>

      {/* Mounted only while open, so it starts empty each time. */}
      {searchOpen && <DocsSearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
