'use client'

import { AuthLogo } from '@/components/auth/auth-logo'
import { ThemeToggle } from '@/components/theme-toggle'
import { ArrowRight, Menu, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { SITE_NAV } from './site-nav'

/**
 * The website's top bar: logo, sections, sign-in (or the way into the app
 * for someone signed in), and a folding menu on phones.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false)
  const start = signedIn
    ? { href: '/', label: 'Open the app' }
    : { href: '/login', label: 'Get started' }

  return (
    <header className="border-border/70 bg-surface/85 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <AuthLogo className="h-7 w-auto shrink-0" />
          <span aria-hidden className="text-border text-lg">
            /
          </span>
          <span className="text-foreground truncate text-[15px] font-medium">
            Content Engine
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-7 lg:flex">
          {SITE_NAV.map(item => (
            <a
              key={item.href}
              href={item.href}
              className="text-muted hover:text-foreground text-[15px] transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-4">
          <ThemeToggle />
          {!signedIn && (
            <Link
              href="/login"
              className="text-muted hover:text-foreground hidden text-[15px] transition-colors sm:block"
            >
              Sign in
            </Link>
          )}
          <Link
            href={start.href}
            className="bg-cta text-cta-text hover:bg-cta-hover hidden items-center gap-1.5 rounded-lg px-4 py-2 text-[15px] font-medium shadow-sm transition-colors sm:inline-flex"
          >
            {start.label}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(value => !value)}
            aria-expanded={open}
            aria-controls="site-menu"
            className="border-border text-muted hover:bg-surface-hover hover:text-foreground inline-flex h-8 w-8 items-center justify-center rounded-lg border lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="site-menu"
          aria-label="Main"
          className="border-border bg-surface border-t px-4 pt-2 pb-5 lg:hidden"
        >
          <ul className="flex flex-col">
            {SITE_NAV.map(item => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="text-foreground block py-3 text-base"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div
            className={`mt-3 grid gap-3 ${signedIn ? 'grid-cols-1' : 'grid-cols-2'}`}
          >
            {!signedIn && (
              <Link
                href="/login"
                className="border-border text-foreground rounded-lg border px-4 py-2.5 text-center text-[15px] font-medium"
              >
                Sign in
              </Link>
            )}
            <Link
              href={start.href}
              className="bg-cta text-cta-text rounded-lg px-4 py-2.5 text-center text-[15px] font-medium"
            >
              {start.label}
            </Link>
          </div>
        </nav>
      )}
    </header>
  )
}
