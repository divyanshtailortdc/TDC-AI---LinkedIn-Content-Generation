/**
 * Where a blog or article is published: a website or a CMS. These are
 * publishing destinations, not content types, and never social platforms.
 * Social posts go out on the platforms in src/lib/platforms, through
 * src/lib/publishing. The two lists stay apart. Published Content
 * (src/lib/published-content.ts) is the one place that shows both.
 *
 * Today a blog goes out by hand. The user pastes it into their site, then
 * marks it published here with where it went, its live URL and the date
 * (blogs.published_to, published_url and published_at). A direct integration
 * (WordPress's REST API, Webflow's CMS API, Shopify's Admin API) would be a
 * provider of its own beside this list. It would publish the blog, then
 * record the outcome through the same store function that marking by hand
 * uses (setBlogPublished in src/lib/blogs/store.ts), so every screen that
 * reads those three fields keeps working. To add a destination, add its id
 * here and to the blogs_published_to_check constraint (a migration).
 *
 * Plain data, so client components can import it.
 */

export const BLOG_DESTINATION_IDS = [
  'website',
  'wordpress',
  'webflow',
  'shopify',
  'other'
] as const
export type BlogDestinationId = (typeof BLOG_DESTINATION_IDS)[number]

export type BlogDestination = {
  id: BlogDestinationId
  /** As shown in the app. */
  name: string
  /** What a live page's address there looks like, for the URL field. */
  urlPlaceholder: string
}

export const BLOG_DESTINATIONS: Record<BlogDestinationId, BlogDestination> = {
  website: {
    id: 'website',
    name: 'Your website',
    urlPlaceholder: 'https://yourwebsite.com/blog/your-post'
  },
  wordpress: {
    id: 'wordpress',
    name: 'WordPress',
    urlPlaceholder: 'https://yoursite.com/your-post/'
  },
  webflow: {
    id: 'webflow',
    name: 'Webflow',
    urlPlaceholder: 'https://yoursite.webflow.io/blog/your-post'
  },
  shopify: {
    id: 'shopify',
    name: 'Shopify',
    urlPlaceholder: 'https://yourstore.com/blogs/news/your-post'
  },
  other: {
    id: 'other',
    name: 'Other',
    urlPlaceholder: 'https://example.com/your-post'
  }
}

/** Where a blog marked published without saying where is taken to be. */
export const DEFAULT_BLOG_DESTINATION: BlogDestinationId = 'website'

export function isBlogDestinationId(
  value: unknown
): value is BlogDestinationId {
  return (
    typeof value === 'string' &&
    (BLOG_DESTINATION_IDS as readonly string[]).includes(value)
  )
}

/**
 * A published blog's status, with where it went when that is known. Blogs
 * marked published before the app asked where have none.
 */
export function publishedOnLabel(id: BlogDestinationId | null): string {
  if (!id) return 'Published'
  if (id === 'website') return 'Published on your website'
  if (id === 'other') return 'Published elsewhere'
  return `Published on ${BLOG_DESTINATIONS[id].name}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A moment's day (YYYY-MM-DD) in the time zone this runs in: the browser's. */
export function localDay(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The moment to record for the day picked under "Published on": the moment
 * already recorded when its day did not change, the present moment for
 * today (or a cleared field), and otherwise noon that day, which is the same
 * day in every time zone within eleven hours of this one.
 */
export function publicationTimestamp(
  chosenDay: string,
  now: Date,
  original: string | null
): string {
  if (original && localDay(original) === chosenDay) return original
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(chosenDay)
  if (!match || chosenDay === localDay(now)) return now.toISOString()
  const [year, month, day] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3])
  ]
  const noon = new Date(year, month - 1, day, 12, 0, 0)
  // 2026-13-45 rolls over into another date: not a day that was picked.
  if (localDay(noon) !== chosenDay) return now.toISOString()
  return noon.toISOString()
}
