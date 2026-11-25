/**
 * Published Content: everything an identity has put out, of both content
 * types, in one list. A social post's destination is its platform
 * (src/lib/platforms). A blog's is a website or CMS
 * (src/lib/blogs/destinations.ts), or 'unrecorded' when it was marked
 * published before the app asked where. The ids of the two lists never
 * collide, so one ?destination= param covers both.
 *
 * Pure and client-safe: the page's loader (src/app/(app)/published) and its
 * client component both use it.
 */
import {
  BLOG_DESTINATIONS,
  isBlogDestinationId,
  type BlogDestinationId
} from '@/lib/blogs/destinations'
import { isPlatformId, PLATFORMS, type PlatformId } from '@/lib/platforms'

export const PUBLISHED_PATH = '/published'

/** The content types: what is made, apart from where it goes. */
export const PUBLISHED_TYPES = ['social', 'blog'] as const
export type PublishedType = (typeof PUBLISHED_TYPES)[number]

export const PUBLISHED_TYPE_LABELS: Record<PublishedType, string> = {
  social: 'Social Media',
  blog: 'Blogs & Articles'
}

/** A blog marked published before the app asked where. */
export const UNRECORDED_DESTINATION = 'unrecorded'

export type PublishedDestination =
  PlatformId | BlogDestinationId | typeof UNRECORDED_DESTINATION

export function isPublishedDestination(
  value: unknown
): value is PublishedDestination {
  return (
    isPlatformId(value) ||
    isBlogDestinationId(value) ||
    value === UNRECORDED_DESTINATION
  )
}

/** The content type that goes out to a destination. */
export function destinationTypeOf(
  destination: PublishedDestination
): PublishedType {
  return isPlatformId(destination) ? 'social' : 'blog'
}

export function destinationLabel(destination: PublishedDestination): string {
  if (isPlatformId(destination)) return PLATFORMS[destination].name
  if (isBlogDestinationId(destination))
    return BLOG_DESTINATIONS[destination].name
  return 'Not recorded'
}

export type PublishedFilters = {
  type: PublishedType | null
  destination: PublishedDestination | null
}

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value

/**
 * The filters a /published URL asks for. Values it does not know are
 * ignored. So is a destination of the other content type
 * (?type=social&destination=wordpress), which could only show nothing.
 */
export function parsePublishedFilters(params: {
  type?: string | string[]
  destination?: string | string[]
}): PublishedFilters {
  const rawType = first(params.type)
  const rawDestination = first(params.destination)
  const type = (PUBLISHED_TYPES as readonly string[]).includes(rawType ?? '')
    ? (rawType as PublishedType)
    : null
  const destination = isPublishedDestination(rawDestination)
    ? rawDestination
    : null
  return {
    type,
    destination:
      destination && (!type || destinationTypeOf(destination) === type)
        ? destination
        : null
  }
}

/** One row of the list: a post that went out, or a published blog. */
export type PublishedItem = {
  /** Unique across both content types: `${type}:${id}`. */
  key: string
  type: PublishedType
  id: string
  destination: PublishedDestination
  /** A post's hook, a blog's title. */
  title: string
  /** What it is: "LinkedIn post", "X thread", "Blog post", "Article". */
  detail: string
  /** When it went out, as an ISO timestamp. */
  publishedAt: string
  /** The live page, when known. */
  liveUrl: string | null
  /** Its page in the app. */
  href: string
}

/** Newest first; the same moment falls back to the id, so pages never overlap. */
export function comparePublished(a: PublishedItem, b: PublishedItem): number {
  const byDate = Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  if (byDate !== 0) return byDate
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * One page of several lists that are each sorted newest first. Each source
 * gives its first `offset + limit` rows, so every row of the page is among
 * them.
 */
export function mergePublished(
  sources: PublishedItem[][],
  offset: number,
  limit: number
): PublishedItem[] {
  return sources
    .flat()
    .sort(comparePublished)
    .slice(offset, offset + limit)
}

/**
 * What an empty list says when filters are on: what was asked for, in the
 * user's terms (a content type, or a destination), and how it fills up.
 */
export function filteredEmptyState(filters: PublishedFilters): {
  title: string
  description: string
} {
  const { type, destination } = filters
  if (destination === UNRECORDED_DESTINATION) {
    return {
      title: 'No blogs without a recorded destination',
      description:
        'Blogs marked published before the app asked where they went are listed here.'
    }
  }
  if (destination) {
    return {
      title: `Nothing published to ${destinationLabel(destination)} yet`,
      description:
        destinationTypeOf(destination) === 'social'
          ? 'Posts appear here once they are published there or marked as posted.'
          : 'Blogs and articles appear here once they are marked as published there.'
    }
  }
  return type === 'blog'
    ? {
        title: 'No blogs or articles published yet',
        description:
          'Blogs and articles appear here once they are marked as published.'
      }
    : {
        title: 'No social media posts published yet',
        description:
          'Posts appear here once they are published or marked as posted.'
      }
}

/** The /published URL for these filters and page. */
export function publishedHref(filters: PublishedFilters, page = 1): string {
  const params = new URLSearchParams()
  if (filters.type) params.set('type', filters.type)
  if (filters.destination) params.set('destination', filters.destination)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `${PUBLISHED_PATH}?${query}` : PUBLISHED_PATH
}
