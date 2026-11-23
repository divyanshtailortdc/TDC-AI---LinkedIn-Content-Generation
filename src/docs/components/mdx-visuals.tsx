import { DOC_ICONS, isDocIconName } from '@/docs/doc-icons'
import { screenshotSize, screenshotSrc } from '@/docs/screenshots'
import { ArrowRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

/*
 * The docs' picture blocks, after tia.tdccommerce.com/docs: the home page's
 * hero, cards with icons, and screenshots of the app with the control a step
 * is about boxed in red. The screenshots are made by `pnpm docs:screenshots`
 * (scripts/docs-screenshots), which writes public/docs/screenshots/<name>.webp
 * and their sizes to src/docs/screenshots.json.
 */

/**
 * A screenshot of the app. Clicking it opens the full-size image, so the
 * boxed control can be read on a small screen.
 */
export function Screenshot({
  name,
  alt,
  caption
}: {
  name: string
  alt: string
  caption?: string
}) {
  const size = screenshotSize(name)
  if (!size) return null
  const src = screenshotSrc(name)
  return (
    <figure className="my-6">
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="border-border bg-surface block overflow-hidden rounded-xl border shadow-[0_14px_36px_-20px_rgb(15_40_80/0.4)]"
      >
        {/* Plain files with known sizes; next/image would re-encode them. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          width={size.width}
          height={size.height}
          loading="lazy"
          decoding="async"
          className="block h-auto w-full"
        />
      </a>
      {caption && (
        <figcaption className="text-muted mt-2.5 text-center text-sm">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

/**
 * A small label above a section's heading, with a link to that part of the
 * app: "IDEAS ........ Open in the app ↗".
 */
export function Eyebrow({
  children,
  href
}: {
  children: ReactNode
  /** The app page the section is about. */
  href?: string
}) {
  return (
    <div
      data-eyebrow
      className="mt-12 flex items-center justify-between gap-4 text-[12px] font-semibold tracking-[0.14em] uppercase"
    >
      <span className="text-brand-strong">{children}</span>
      {href && (
        <Link
          href={href}
          className="text-brand-strong inline-flex items-center gap-1 text-[13px] font-medium tracking-normal normal-case hover:underline"
        >
          Open in the app
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

/** The docs home page's opening: its # title and lead, with two buttons. */
export function DocsHero({
  actions = [],
  children
}: {
  actions?: { label: string; href: string }[]
  children?: ReactNode
}) {
  return (
    <div className="relative mb-14 sm:pl-12">
      {/* A step line down the left, as on the reference docs. */}
      <div aria-hidden className="absolute top-3 bottom-4 left-2.5 hidden sm:block">
        <span className="bg-border absolute top-0 bottom-0 left-1/2 w-px -translate-x-1/2" />
        <span className="border-brand bg-surface absolute top-0 left-1/2 flex h-3.5 w-3.5 -translate-x-1/2 items-center justify-center rounded-full border-2">
          <span className="bg-brand h-1.5 w-1.5 rounded-full" />
        </span>
        <span className="border-border bg-surface absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2" />
        <span className="border-border bg-surface absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border-2" />
      </div>
      <div className="[&_h1]:mb-5 [&_h1]:text-4xl [&_h1]:leading-[1.08] [&_h1]:font-semibold sm:[&_h1]:text-5xl [&_p]:text-muted [&_p]:text-lg [&_p]:leading-relaxed">
        {children}
      </div>
      {actions.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-3">
          {actions.map((action, index) => (
            <Link
              key={action.href}
              href={action.href}
              className={
                index === 0
                  ? 'bg-cta text-cta-text hover:bg-cta-hover inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[15px] font-medium no-underline shadow-sm transition-colors'
                  : 'border-brand/40 text-brand-strong hover:bg-brand/5 inline-flex items-center gap-2 rounded-xl border px-5 py-3 text-[15px] font-medium no-underline transition-colors'
              }
            >
              {action.label}
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A card to a guide with an icon, title and line, and "Read guide →":
 * three to a row inside <Grid columns={3}>.
 */
export function Guide({
  title,
  description,
  href,
  icon
}: {
  title: string
  description?: string
  href: string
  icon?: string
}) {
  const Icon = isDocIconName(icon) ? DOC_ICONS[icon] : null
  return (
    <Link
      href={href}
      className="group border-border bg-surface hover:border-brand/60 flex flex-col rounded-xl border p-5 no-underline transition-colors"
    >
      {Icon && <Icon aria-hidden className="text-brand-strong h-5 w-5" />}
      <span className="text-foreground mt-4 block font-semibold">{title}</span>
      {description && (
        <span className="text-muted mt-1 block flex-1 text-sm leading-snug">
          {description}
        </span>
      )}
      <span className="text-brand-strong mt-4 inline-flex items-center gap-1 text-sm font-medium">
        Read guide
        <ArrowRight
          aria-hidden
          className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
        />
      </span>
    </Link>
  )
}
