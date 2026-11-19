import { adjacentDocPages, docHref, DOCS_PATH, type DocPage } from '@/docs/nav'
import { ArrowLeft, ArrowRight, ChevronRight, House } from 'lucide-react'
import Link from 'next/link'

/** Docs home › section › group › this page. */
export function DocsBreadcrumbs({ page }: { page: DocPage }) {
  if (!page.slug) return null
  return (
    <nav aria-label="Breadcrumb" className="mb-6">
      <ol className="text-muted flex flex-wrap items-center gap-1.5 text-sm">
        <li>
          <Link
            href={DOCS_PATH}
            aria-label="Documentation home"
            className="hover:text-foreground flex items-center transition-colors"
          >
            <House aria-hidden className="h-4 w-4" />
          </Link>
        </li>
        {page.trail.map(part => (
          <li key={part} className="flex items-center gap-1.5">
            <ChevronRight aria-hidden className="h-3.5 w-3.5 opacity-60" />
            <span>{part}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <ChevronRight aria-hidden className="h-3.5 w-3.5 opacity-60" />
          <span
            aria-current="page"
            className="bg-brand/12 text-brand-strong rounded-md px-2 py-0.5 font-medium"
          >
            {page.title}
          </span>
        </li>
      </ol>
    </nav>
  )
}

/** The pages before and after this one, in reading order. */
export function DocsPagination({ slug }: { slug: string }) {
  const { previous, next } = adjacentDocPages(slug)
  if (!previous && !next) return null
  const card =
    'group border-border bg-surface hover:border-brand/60 hover:bg-surface-hover flex min-w-0 flex-1 flex-col gap-1 rounded-xl border px-4 py-3 transition-colors sm:max-w-[48%]'
  return (
    <nav
      aria-label="Previous and next pages"
      className="border-border mt-14 flex flex-col gap-3 border-t pt-8 sm:flex-row sm:justify-between"
    >
      {previous ? (
        <Link href={docHref(previous.slug)} className={card}>
          <span className="text-muted flex items-center gap-1.5 text-xs">
            <ArrowLeft
              aria-hidden
              className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
            />
            Previous
          </span>
          <span className="text-foreground group-hover:text-brand-strong truncate font-semibold">
            {previous.title}
          </span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next && (
        <Link href={docHref(next.slug)} className={`${card} sm:items-end`}>
          <span className="text-muted flex items-center gap-1.5 text-xs">
            Next
            <ArrowRight
              aria-hidden
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            />
          </span>
          <span className="text-foreground group-hover:text-brand-strong truncate font-semibold">
            {next.title}
          </span>
        </Link>
      )}
    </nav>
  )
}
