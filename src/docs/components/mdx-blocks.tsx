import { docHref, findDocPage, siblingDocPages, type DocPage } from '@/docs/nav'
import { cn } from '@/lib/cn'
import {
  ArrowRight,
  ChevronRight,
  CircleAlert,
  Info,
  Lightbulb,
  ShieldAlert,
  Star,
  Tag,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react'
import Link from 'next/link'
import { Children, isValidElement, type ReactNode } from 'react'

/**
 * The components help pages can use besides markdown (see
 * src/docs/components/mdx-components.tsx). The names follow
 * potential-adventure's docs, so a page written for one reads the same in
 * the other.
 */

/** The text of rendered children, e.g. a heading's, for its anchor. */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children)
  return ''
}

type TagType =
  'note' | 'tip' | 'info' | 'warning' | 'caution' | 'important' | 'default'

const TAG_STYLES: Record<
  TagType,
  { icon: LucideIcon; label: string; box: string; icon_: string; title: string }
> = {
  note: {
    icon: CircleAlert,
    label: 'Note',
    box: 'border-sky-500/70 bg-sky-50 dark:bg-sky-500/10',
    icon_: 'text-sky-600 dark:text-sky-400',
    title: 'text-sky-800 dark:text-sky-300'
  },
  info: {
    icon: Info,
    label: 'Info',
    box: 'border-sky-500/70 bg-sky-50 dark:bg-sky-500/10',
    icon_: 'text-sky-600 dark:text-sky-400',
    title: 'text-sky-800 dark:text-sky-300'
  },
  tip: {
    icon: Lightbulb,
    label: 'Tip',
    box: 'border-emerald-500/70 bg-emerald-50 dark:bg-emerald-500/10',
    icon_: 'text-emerald-600 dark:text-emerald-400',
    title: 'text-emerald-800 dark:text-emerald-300'
  },
  warning: {
    icon: TriangleAlert,
    label: 'Warning',
    box: 'border-amber-500/70 bg-amber-50 dark:bg-amber-500/10',
    icon_: 'text-amber-600 dark:text-amber-400',
    title: 'text-amber-800 dark:text-amber-300'
  },
  caution: {
    icon: ShieldAlert,
    label: 'Caution',
    box: 'border-red-500/70 bg-red-50 dark:bg-red-500/10',
    icon_: 'text-red-600 dark:text-red-400',
    title: 'text-red-800 dark:text-red-300'
  },
  important: {
    icon: Star,
    label: 'Important',
    box: 'border-violet-500/70 bg-violet-50 dark:bg-violet-500/10',
    icon_: 'text-violet-600 dark:text-violet-400',
    title: 'text-violet-800 dark:text-violet-300'
  },
  default: {
    icon: Tag,
    label: 'Note',
    box: 'border-border bg-surface',
    icon_: 'text-muted',
    title: 'text-foreground'
  }
}

/** A callout: a note, tip or warning set apart from the text around it. */
export function Tags({
  type = 'default',
  label,
  children
}: {
  type?: TagType
  label?: string
  children?: ReactNode
}) {
  const style = TAG_STYLES[type] ?? TAG_STYLES.default
  const Icon = style.icon
  return (
    <aside
      className={cn(
        'my-6 flex gap-3 rounded-xl border border-l-4 px-4 py-3',
        style.box
      )}
    >
      <Icon
        aria-hidden
        className={cn('mt-0.5 h-4.5 w-4.5 shrink-0', style.icon_)}
      />
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold', style.title)}>
          {label ?? style.label}
        </p>
        <div className="text-foreground/90 mt-1 text-[15px] leading-relaxed [&_ol]:my-2 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2">
          {children}
        </div>
      </div>
    </aside>
  )
}

type NextStepLink = { title: string; description?: string; href: string }

/**
 * Cards to the pages a reader goes to next: the ones given, or else the
 * other pages beside this one in the navigation. `slug` is filled in by the
 * docs page, which knows which page it is rendering.
 */
export function NextSteps({
  links,
  slug
}: {
  links?: NextStepLink[]
  slug?: string
}) {
  const cards: NextStepLink[] =
    links && links.length > 0
      ? links.map(link => ({
          ...link,
          description: link.description ?? describedPage(link.href)?.description
        }))
      : slug !== undefined
        ? siblingDocPages(slug)
            .slice(0, 4)
            .map(page => ({
              title: page.title,
              description: page.description,
              href: docHref(page.slug)
            }))
        : []
  if (cards.length === 0) return null
  return (
    <div className="my-8 grid gap-3 sm:grid-cols-2">
      {cards.map(card => (
        <Link
          key={card.href}
          href={card.href}
          className="group border-border bg-surface hover:border-brand/60 hover:bg-surface-hover flex flex-col rounded-xl border p-4 no-underline transition-colors"
        >
          <span className="text-foreground group-hover:text-brand-strong flex items-center justify-between gap-2 font-semibold">
            {card.title}
            <ArrowRight
              aria-hidden
              className="text-muted group-hover:text-brand-strong h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
            />
          </span>
          {card.description && (
            <span className="text-muted mt-1 text-sm leading-snug">
              {card.description}
            </span>
          )}
        </Link>
      ))}
    </div>
  )
}

/** The docs page a link points at, for a card that gives no description. */
function describedPage(href: string): DocPage | undefined {
  const match = href.match(/^\/docs\/?([^#?]*)/)
  return match ? findDocPage(match[1]!.replace(/\/$/, '')) : undefined
}

/** Cards side by side, two to a row on wider screens. */
export function Grid({ children }: { children?: ReactNode }) {
  return <div className="my-8 grid gap-3 sm:grid-cols-2">{children}</div>
}

export function Card({
  title,
  description,
  href,
  icon
}: {
  title: string
  description?: string
  href: string
  /** A short emoji or symbol shown above the title. */
  icon?: string
}) {
  return (
    <Link
      href={href}
      className="group border-border bg-surface hover:border-brand/60 hover:bg-surface-hover block rounded-xl border p-5 no-underline transition-colors"
    >
      {icon && (
        <span aria-hidden className="mb-2 block text-2xl">
          {icon}
        </span>
      )}
      <span className="text-foreground group-hover:text-brand-strong block font-semibold">
        {title}
      </span>
      {description && (
        <span className="text-muted mt-1 block text-sm leading-snug">
          {description}
        </span>
      )}
    </Link>
  )
}

/**
 * A question or aside folded away until opened. The summary is the
 * `summary` prop, or a <summary> written inside, as in potential-adventure.
 */
export function Details({
  summary,
  children
}: {
  summary?: string
  children?: ReactNode
}) {
  let title: ReactNode = summary
  const body: ReactNode[] = []
  Children.forEach(children, child => {
    if (
      title === undefined &&
      isValidElement<{ children?: ReactNode }>(child) &&
      child.type === 'summary'
    ) {
      title = child.props.children
    } else {
      body.push(child)
    }
  })
  return (
    <details className="group border-border bg-surface my-4 rounded-xl border [&[open]>summary>svg]:rotate-90">
      <summary className="text-foreground hover:bg-surface-hover flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="text-muted h-4 w-4 shrink-0 transition-transform"
        />
        {title ?? 'Details'}
      </summary>
      <div className="text-foreground/90 border-border border-t px-4 pt-1 pb-3 text-[15px] leading-relaxed [&_p]:my-2">
        {body}
      </div>
    </details>
  )
}

/** A key on the keyboard: <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>. */
export function Kbd({ children }: { children?: ReactNode }) {
  return (
    <kbd className="border-border bg-surface text-foreground rounded-md border border-b-2 px-1.5 py-0.5 font-mono text-[0.8em]">
      {children}
    </kbd>
  )
}
