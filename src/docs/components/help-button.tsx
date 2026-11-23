'use client'

import { buttonClassName } from '@/components/button'
import { DOCS_PATH, docHref } from '@/docs/nav'
import { docForAppPath } from '@/docs/route-docs'
import { cn } from '@/lib/cn'
import { FileText, X, type LucideIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'

type HelpAction = {
  key: string
  /** Its tooltip. */
  label: string
  /** For screen readers, when the tooltip alone does not say enough. */
  description: string
  href: string
  icon: LucideIcon
}

/** A bold question mark, as on the ERP's help button (Ionicons "help", MIT). */
function HelpGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={className}>
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={56}
        d="M160 164s1.44-33 33.54-59.46C212.6 88.83 235.49 84.28 256 84c18.73-.23 35.47 2.94 45.48 7.82C318.59 100.2 352 120.6 352 164c0 45.67-29.18 66.37-62.35 89.18S248 298.36 248 324"
      />
      <circle cx="248" cy="399.99" r="40" fill="currentColor" />
    </svg>
  )
}

/** antd's float button shadow, as the ERP shows it. */
const FLOAT_SHADOW =
  'shadow-[0_6px_16px_0_rgb(0_0_0/0.08),0_3px_6px_-4px_rgb(0_0_0/0.12),0_9px_28px_8px_rgb(0_0_0/0.05)]'

/**
 * The help button in the corner of every app page, as on the ERP
 * (potential-adventure's SupportButton): a round "?" in the primary colour
 * that opens a row of round buttons to its left, each named by a tooltip.
 * Documentation opens the help page for the screen you are on (the docs
 * home when none is specific to it) in a new tab, so the work here stays.
 * The ERP's chat, support ticket and copilot buttons have no counterpart in
 * this app yet; another action is one more entry in `actions`.
 */
export function HelpButton() {
  const pathname = usePathname()
  // Remembered with the page it was opened on, so it closes on navigation.
  const [openedOn, setOpenedOn] = useState<string | null>(null)
  const open = openedOn === pathname
  const doc = helpHrefFor(pathname)
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const actions: HelpAction[] = [
    {
      key: 'docs',
      label: 'Documentation',
      description: doc.title
        ? `Documentation: ${doc.title} (opens in a new tab)`
        : 'Documentation (opens in a new tab)',
      href: doc.href,
      icon: FileText
    }
  ]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpenedOn(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenedOn(null)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div
      ref={containerRef}
      className="fixed right-4 bottom-6 z-30 flex items-center gap-4"
    >
      <ul
        id={listId}
        aria-label="Help"
        inert={!open}
        className={cn(
          'flex items-center gap-4 motion-safe:transition-[opacity,translate] motion-safe:duration-200',
          open
            ? 'translate-x-0 opacity-100'
            : 'pointer-events-none translate-x-3 opacity-0'
        )}
      >
        {actions.map(({ key, label, description, href, icon: Icon }) => (
          <li key={key} className="group relative">
            <a
              href={href}
              target="_blank"
              rel="noopener"
              aria-label={description}
              onClick={() => setOpenedOn(null)}
              className={cn(
                'bg-surface text-accent hover:bg-surface-hover focus-visible:ring-brand/50 flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-black/5 transition-colors focus-visible:ring-4 focus-visible:outline-none dark:ring-white/10',
                FLOAT_SHADOW
              )}
            >
              <Icon aria-hidden className="h-4.5 w-4.5" />
            </a>
            <span
              role="tooltip"
              className="bg-foreground text-background pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              {label}
            </span>
          </li>
        ))}
      </ul>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpenedOn(open ? null : pathname)}
        aria-label={open ? 'Close help' : 'Help'}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          'bg-accent text-background hover:bg-accent-hover focus-visible:ring-brand/50 flex h-10 w-10 items-center justify-center rounded-full transition-colors focus-visible:ring-4 focus-visible:outline-none',
          FLOAT_SHADOW
        )}
      >
        {open ? (
          <X aria-hidden className="h-4.5 w-4.5" />
        ) : (
          <HelpGlyph className="h-5 w-5" />
        )}
      </button>
    </div>
  )
}

/** The help page for an app pathname, or the docs home when none is specific to it. */
function helpHrefFor(pathname: string) {
  const doc = docForAppPath(pathname)
  return { href: doc ? docHref(doc.slug) : DOCS_PATH, title: doc?.title }
}

/**
 * The "Help" button in the top bar of every page, as in the ERP's header: it
 * opens the help page for the screen you are on in a new tab. Hidden on
 * narrow screens, where the round help button in the corner does the same.
 */
export function HeaderHelpLink() {
  const { href, title } = helpHrefFor(usePathname())
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      title={title ? `Help: ${title}` : 'Help'}
      aria-label={
        title
          ? `Help: ${title} (opens in a new tab)`
          : 'Help (opens in a new tab)'
      }
      className={buttonClassName({
        variant: 'secondary',
        size: 'sm',
        className:
          'text-brand-strong hover:text-brand-strong hidden sm:inline-flex'
      })}
    >
      Help
    </a>
  )
}
