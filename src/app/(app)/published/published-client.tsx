'use client'

import { buttonClassName } from '@/components/button'
import { PageHeader } from '@/components/page-header'
import { Pagination } from '@/components/pagination'
import { PlatformMark } from '@/components/platform-mark'
import { EmptyState } from '@/components/ui/empty-state'
import {
  FilterChips,
  type FilterChipOption
} from '@/components/ui/filter-chips'
import { FOCUS_RING } from '@/components/ui/tone'
import { BLOG_DESTINATION_IDS } from '@/lib/blogs/destinations'
import { cn } from '@/lib/cn'
import { formatAbsoluteDate, formatAbsoluteDateTime } from '@/lib/format-date'
import { useHasMounted } from '@/lib/hooks/use-has-mounted'
import type { PageInfo } from '@/lib/pagination'
import { isPlatformId, PLATFORM_IDS } from '@/lib/platforms'
import {
  destinationLabel,
  destinationTypeOf,
  filteredEmptyState,
  PUBLISHED_TYPE_LABELS,
  publishedHref,
  UNRECORDED_DESTINATION,
  type PublishedDestination,
  type PublishedFilters,
  type PublishedItem,
  type PublishedType
} from '@/lib/published-content'
import {
  ArrowRight,
  BookOpenText,
  ExternalLink,
  Globe,
  MessageSquareText,
  Send
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { PublishedCounts } from './published-data'

type TypeChoice = PublishedType | 'all'
type DestinationChoice = PublishedDestination | 'all'

/** Destinations in a fixed order: platforms, then websites and CMSs. */
const DESTINATION_ORDER: PublishedDestination[] = [
  ...PLATFORM_IDS,
  ...BLOG_DESTINATION_IDS,
  UNRECORDED_DESTINATION
]

export function PublishedClient({
  identityName,
  items,
  pageInfo,
  counts,
  filters
}: {
  identityName: string
  items: PublishedItem[]
  pageInfo: PageInfo
  counts: PublishedCounts
  filters: PublishedFilters
}) {
  const router = useRouter()
  const go = (next: PublishedFilters) => router.push(publishedHref(next))

  const typeOptions: FilterChipOption<TypeChoice>[] = [
    { value: 'all', label: 'All', count: counts.all },
    {
      value: 'social',
      label: PUBLISHED_TYPE_LABELS.social,
      count: counts.social
    },
    { value: 'blog', label: PUBLISHED_TYPE_LABELS.blog, count: counts.blog }
  ]
  // Only destinations something went out to, and the one picked.
  const destinations = DESTINATION_ORDER.filter(
    d => (counts.byDestination[d] ?? 0) > 0 || d === filters.destination
  )
  const destinationOptions: FilterChipOption<DestinationChoice>[] = [
    { value: 'all', label: 'All destinations' },
    ...destinations.map(d => ({
      value: d,
      label: (
        <span className="flex items-center gap-1.5">
          <DestinationIcon destination={d} className="h-3.5 w-3.5" />
          {destinationLabel(d)}
        </span>
      ),
      count: counts.byDestination[d] ?? 0
    }))
  ]
  const filtered = Boolean(filters.type || filters.destination)
  // The pager's links keep the filters.
  const query: Record<string, string> = {}
  if (filters.type) query.type = filters.type
  if (filters.destination) query.destination = filters.destination

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Published Content"
        description={`Everything ${identityName} has published`}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {counts.all > 0 && (
            <div className="space-y-2">
              <FilterChips
                label="Show one content type"
                options={typeOptions}
                value={filters.type ?? 'all'}
                onChange={next => {
                  const type = next === 'all' ? null : next
                  go({
                    type,
                    // A destination of the other content type would show nothing.
                    destination:
                      filters.destination &&
                      (!type || destinationTypeOf(filters.destination) === type)
                        ? filters.destination
                        : null
                  })
                }}
              />
              {destinations.length > 0 && (
                <FilterChips
                  label="Show one destination"
                  options={destinationOptions}
                  value={filters.destination ?? 'all'}
                  onChange={next =>
                    go({
                      ...filters,
                      destination: next === 'all' ? null : next
                    })
                  }
                />
              )}
            </div>
          )}

          {items.length === 0 ? (
            filtered && counts.all > 0 ? (
              <EmptyState
                icon={Send}
                {...filteredEmptyState(filters)}
                action={
                  <Link
                    href={publishedHref({ type: null, destination: null })}
                    className={buttonClassName({
                      variant: 'secondary',
                      size: 'sm'
                    })}
                  >
                    Clear filters
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={Send}
                title="Nothing published yet"
                description="Posts appear here once they are published or marked as posted, and blogs and articles once they are marked as published."
                action={
                  <>
                    <Link
                      href="/posts"
                      className={buttonClassName({
                        variant: 'secondary',
                        size: 'sm'
                      })}
                    >
                      <MessageSquareText aria-hidden className="h-4 w-4" />
                      Social Media Posts
                    </Link>
                    <Link
                      href="/blogs"
                      className={buttonClassName({
                        variant: 'secondary',
                        size: 'sm'
                      })}
                    >
                      <BookOpenText aria-hidden className="h-4 w-4" />
                      Blogs &amp; Articles
                    </Link>
                  </>
                }
              />
            )
          ) : (
            <div className="border-border bg-surface overflow-hidden rounded-2xl border shadow-xs">
              <ul className="divide-border divide-y">
                {items.map(item => (
                  <PublishedRow key={item.key} item={item} />
                ))}
              </ul>
            </div>
          )}

          <Pagination {...pageInfo} noun="items" query={query} />
        </div>
      </div>
    </div>
  )
}

/** A platform's logo, or a globe for a website or CMS. */
function DestinationIcon({
  destination,
  className
}: {
  destination: PublishedDestination
  className: string
}) {
  return isPlatformId(destination) ? (
    <PlatformMark platform={destination} className={className} />
  ) : (
    <Globe aria-hidden className={cn('text-muted', className)} />
  )
}

function PublishedRow({ item }: { item: PublishedItem }) {
  const mounted = useHasMounted()
  const where =
    item.type === 'blog'
      ? item.destination === UNRECORDED_DESTINATION
        ? 'Destination not recorded'
        : destinationLabel(item.destination)
      : null
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
      <span
        aria-hidden
        className="border-border bg-background flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border"
      >
        <DestinationIcon
          destination={item.destination}
          className="h-4.5 w-4.5"
        />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={item.href}
          className={cn(
            'text-foreground hover:text-brand-strong block truncate rounded text-sm font-medium transition-colors',
            FOCUS_RING
          )}
        >
          {item.title}
        </Link>
        <p className="text-muted mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs">
          <span className="bg-surface-hover text-foreground rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase">
            {PUBLISHED_TYPE_LABELS[item.type]}
          </span>
          <span>{item.detail}</span>
          {where && (
            <>
              <span aria-hidden>·</span>
              <span>{where}</span>
            </>
          )}
          {mounted && (
            <>
              <span aria-hidden>·</span>
              <time
                dateTime={item.publishedAt}
                title={formatAbsoluteDateTime(item.publishedAt)}
              >
                {formatAbsoluteDate(item.publishedAt)}
              </time>
            </>
          )}
        </p>
      </div>
      {item.liveUrl && (
        <a
          href={item.liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({
            variant: 'secondary',
            size: 'sm',
            className: cn('shrink-0', FOCUS_RING)
          })}
        >
          <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          <span className="max-sm:sr-only">View live</span>
        </a>
      )}
      <Link
        href={item.href}
        aria-label={`Open: ${item.title}`}
        className={buttonClassName({
          variant: 'secondary',
          size: 'sm',
          className: cn('shrink-0', FOCUS_RING)
        })}
      >
        Open
        <ArrowRight aria-hidden className="h-3.5 w-3.5" />
      </Link>
    </li>
  )
}
