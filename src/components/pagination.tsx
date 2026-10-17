'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/cn'
import { pageNumbers, type PageInfo } from '@/lib/pagination'

/**
 * Previous, page numbers and Next for a list of more than one page.
 *
 * A list paged on the server (see loadPage) gets ?page= links, kept alongside
 * `query`: the other params it was loaded with, such as its filter. A list
 * paged in the browser (see paginate) passes `onPageChange` and gets buttons.
 */
export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  noun,
  query = {},
  onPageChange,
  scrollTarget
}: PageInfo & {
  /** What the list holds, in the plural: "runs", "ideas". */
  noun: string
  query?: Record<string, string>
  onPageChange?: (page: number) => void
  /**
   * Brought into view on a page change, for a list that sits below other
   * content. Otherwise the panel the list scrolls in goes back to its top.
   */
  scrollTarget?: RefObject<HTMLElement | null>
}) {
  const pathname = usePathname()
  if (pageCount <= 1) return null

  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  // The list's panel keeps its scroll position across a page change, so the
  // next page would otherwise open scrolled down to these controls.
  const scroll = (event: MouseEvent<HTMLElement>) => {
    if (scrollTarget?.current) {
      scrollTarget.current.scrollIntoView({ block: 'start' })
      return
    }
    for (let el = event.currentTarget.parentElement; el; el = el.parentElement) {
      if (el.scrollTop > 0) {
        el.scrollTo({ top: 0 })
        return
      }
    }
  }

  const goTo = (
    target: number,
    label: string,
    className: string,
    content: ReactNode
  ) => {
    if (onPageChange) {
      return (
        <button
          type="button"
          aria-label={label}
          onClick={event => {
            scroll(event)
            onPageChange(target)
          }}
          className={cn(className, 'cursor-pointer')}
        >
          {content}
        </button>
      )
    }
    const params = new URLSearchParams(query)
    if (target > 1) params.set('page', String(target))
    const search = params.toString()
    return (
      <Link
        href={search ? `${pathname}?${search}` : pathname}
        aria-label={label}
        onClick={event => {
          // A new tab or window leaves this list where it is.
          if (event.metaKey || event.ctrlKey || event.shiftKey) return
          scroll(event)
        }}
        className={className}
      >
        {content}
      </Link>
    )
  }

  // The words Previous and Next show only where there is room for them
  // beside the numbers: not on phones, or in the Posts queue rail.
  const step = (target: number, label: 'Previous' | 'Next') => {
    const icon =
      label === 'Previous' ? (
        <ChevronLeft className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      )
    const content = (
      <>
        {label === 'Previous' && icon}
        <span className="hidden @sm:inline">{label}</span>
        {label === 'Next' && icon}
      </>
    )
    if (target < 1 || target > pageCount) {
      return (
        <span aria-disabled className={cn(STEP_CLASS, 'opacity-50')}>
          {content}
        </span>
      )
    }
    return goTo(target, label, cn(STEP_CLASS, 'hover:bg-surface-hover'), content)
  }

  return (
    <nav
      aria-label="Pagination"
      className="@container flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
    >
      <p className="text-muted text-xs tabular-nums">
        {first === last ? first : `${first}–${last}`} of {total} {noun}
      </p>
      <div className="flex items-center gap-1">
        {step(page - 1, 'Previous')}
        {pageNumbers(page, pageCount).map((n, i) => (
          <Fragment key={n ?? `gap-${i}`}>
            {n === null ? (
              <span aria-hidden className="text-muted w-5 text-center text-xs">
                …
              </span>
            ) : n === page ? (
              <span
                aria-current="page"
                className={cn(NUMBER_CLASS, 'bg-accent text-background')}
              >
                {n}
              </span>
            ) : (
              goTo(
                n,
                `Page ${n}`,
                cn(
                  NUMBER_CLASS,
                  'text-muted hover:bg-surface-hover hover:text-foreground'
                ),
                n
              )
            )}
          </Fragment>
        ))}
        {step(page + 1, 'Next')}
      </div>
    </nav>
  )
}

const STEP_CLASS =
  'border-border text-foreground inline-flex h-7 items-center gap-1 rounded-lg border px-1.5 text-xs font-medium transition-colors @sm:px-2.5'

const NUMBER_CLASS =
  'inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-xs font-medium tabular-nums transition-colors'
