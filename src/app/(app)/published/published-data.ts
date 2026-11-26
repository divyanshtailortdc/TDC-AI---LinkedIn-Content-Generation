import 'server-only'

import { blogsTable, postDraftsTable } from '@/db/schema'
import { isBlogDestinationId } from '@/lib/blogs/destinations'
import { BLOG_KIND_LABELS, type BlogKind } from '@/lib/blogs/types'
import { formatOf, FORMATS } from '@/lib/formats'
import { inKnownFormat } from '@/lib/known-formats'
import { loadPage, PAGE_SIZE, type PageInfo } from '@/lib/pagination'
import { isPlatformId, type PlatformId } from '@/lib/platforms'
import {
  destinationTypeOf,
  mergePublished,
  UNRECORDED_DESTINATION,
  type PublishedDestination,
  type PublishedFilters,
  type PublishedItem
} from '@/lib/published-content'
import {
  and,
  count,
  desc,
  eq,
  isNotNull,
  isNull,
  sql,
  type SQL
} from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

type PublishedDb = PgDatabase<PostgresJsQueryResultHKT, any, any>

export type PublishedCounts = {
  all: number
  social: number
  blog: number
  /**
   * Items per destination, for the content type picked (or both). The
   * destination picked does not narrow them, so every chip keeps its count.
   */
  byDestination: Partial<Record<PublishedDestination, number>>
}

/** What a post's row says when its hook is empty. */
const BODY_TITLE_CHARS = 120

const firstLine = (text: string) =>
  text
    .split('\n')
    .find(line => line.trim())
    ?.trim() ?? ''

/**
 * One page of everything the identity has published, newest first: social
 * posts that went out (posted_at is set by publishing and by marking a post
 * posted, and cleared by deleting it from its platform) and blogs marked
 * published. Every query is scoped to the identity. `liveUrls` gives the
 * posts' live pages (their publications), when publishing is set up.
 */
export async function loadPublishedContent(
  database: PublishedDb,
  accountId: string,
  filters: PublishedFilters,
  page: number,
  options: {
    liveUrls?: (postIds: string[]) => Promise<Map<string, string>>
  } = {}
): Promise<{
  items: PublishedItem[]
  pageInfo: PageInfo
  counts: PublishedCounts
}> {
  const { type, destination } = filters
  const wantSocial =
    type !== 'blog' &&
    (!destination || destinationTypeOf(destination) === 'social')
  const wantBlogs =
    type !== 'social' &&
    (!destination || destinationTypeOf(destination) === 'blog')

  const postsOut = and(
    eq(postDraftsTable.accountId, accountId),
    inKnownFormat(),
    isNotNull(postDraftsTable.postedAt)
  )
  const blogsOut = and(
    eq(blogsTable.accountId, accountId),
    eq(blogsTable.status, 'published')
  )
  const postsTo: SQL | undefined = isPlatformId(destination)
    ? eq(postDraftsTable.platform, destination)
    : undefined
  const blogsTo: SQL | undefined =
    destination === UNRECORDED_DESTINATION
      ? isNull(blogsTable.publishedTo)
      : isBlogDestinationId(destination)
        ? eq(blogsTable.publishedTo, destination)
        : undefined

  const [postGroups, blogGroups] = await Promise.all([
    database
      .select({ platform: postDraftsTable.platform, n: count() })
      .from(postDraftsTable)
      .where(postsOut)
      .groupBy(postDraftsTable.platform),
    database
      .select({ to: blogsTable.publishedTo, n: count() })
      .from(blogsTable)
      .where(blogsOut)
      .groupBy(blogsTable.publishedTo)
  ])

  const socialBy = new Map<PublishedDestination, number>()
  for (const { platform, n } of postGroups) {
    if (isPlatformId(platform))
      socialBy.set(platform, (socialBy.get(platform) ?? 0) + n)
  }
  const blogBy = new Map<PublishedDestination, number>()
  for (const { to, n } of blogGroups) {
    const key = isBlogDestinationId(to) ? to : UNRECORDED_DESTINATION
    blogBy.set(key, (blogBy.get(key) ?? 0) + n)
  }
  const sum = (map: Map<PublishedDestination, number>) =>
    [...map.values()].reduce((total, n) => total + n, 0)
  const counts: PublishedCounts = {
    social: sum(socialBy),
    blog: sum(blogBy),
    all: sum(socialBy) + sum(blogBy),
    byDestination: Object.fromEntries([
      ...(type !== 'blog' ? socialBy : []),
      ...(type !== 'social' ? blogBy : [])
    ])
  }
  const total = destination
    ? ((wantSocial ? socialBy.get(destination) : blogBy.get(destination)) ?? 0)
    : (wantSocial ? counts.social : 0) + (wantBlogs ? counts.blog : 0)

  const rows = async (
    offset: number,
    limit: number
  ): Promise<PublishedItem[]> => {
    const take = offset + limit
    const [posts, blogs] = await Promise.all([
      wantSocial
        ? database
            .select({
              id: postDraftsTable.id,
              platform: postDraftsTable.platform,
              formatId: postDraftsTable.formatId,
              hook: postDraftsTable.hook,
              body: postDraftsTable.body,
              postedAt: postDraftsTable.postedAt
            })
            .from(postDraftsTable)
            .where(and(postsOut, postsTo))
            .orderBy(desc(postDraftsTable.postedAt), desc(postDraftsTable.id))
            .limit(take)
        : [],
      wantBlogs
        ? database
            .select({
              id: blogsTable.id,
              kind: blogsTable.kind,
              title: blogsTable.title,
              topic: sql<string>`${blogsTable.brief}->>'topic'`,
              publishedTo: blogsTable.publishedTo,
              publishedUrl: blogsTable.publishedUrl,
              publishedAt:
                sql<Date>`coalesce(${blogsTable.publishedAt}, ${blogsTable.updatedAt})`.mapWith(
                  blogsTable.publishedAt
                )
            })
            .from(blogsTable)
            .where(and(blogsOut, blogsTo))
            .orderBy(
              desc(
                sql`coalesce(${blogsTable.publishedAt}, ${blogsTable.updatedAt})`
              ),
              desc(blogsTable.id)
            )
            .limit(take)
        : []
    ])
    const postItems = posts.map((post): PublishedItem => ({
      key: `social:${post.id}`,
      type: 'social',
      id: post.id,
      destination: post.platform as PlatformId,
      title:
        firstLine(post.hook) || firstLine(post.body).slice(0, BODY_TITLE_CHARS),
      detail: FORMATS[formatOf(post.formatId)].label,
      publishedAt: post.postedAt!.toISOString(),
      liveUrl: null,
      href: `/posts/${post.id}`
    }))
    const blogItems = blogs.map((blog): PublishedItem => ({
      key: `blog:${blog.id}`,
      type: 'blog',
      id: blog.id,
      destination: isBlogDestinationId(blog.publishedTo)
        ? blog.publishedTo
        : UNRECORDED_DESTINATION,
      title: blog.title || blog.topic || 'Untitled',
      detail: BLOG_KIND_LABELS[blog.kind as BlogKind],
      publishedAt: blog.publishedAt.toISOString(),
      liveUrl: blog.publishedUrl,
      href: `/blogs/${blog.id}`
    }))
    const items = mergePublished([postItems, blogItems], offset, limit)
    const postIds = items
      .filter(item => item.type === 'social')
      .map(item => item.id)
    if (!options.liveUrls || postIds.length === 0) return items
    const live = await options.liveUrls(postIds)
    return items.map(item =>
      item.type === 'social'
        ? { ...item, liveUrl: live.get(item.id) ?? null }
        : item
    )
  }

  const { rows: items, pageInfo } = await loadPage({
    page,
    pageSize: PAGE_SIZE,
    count: async () => total,
    rows
  })
  return { items, pageInfo, counts }
}
