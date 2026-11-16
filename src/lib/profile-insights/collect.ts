import 'server-only'

import { db } from '@/db'
import { publicationsTable } from '@/db/schema'
import { PLATFORMS } from '@/lib/platforms'
import { listSentPosts } from '@/lib/publishing/buffer/api'
import { bufferConfig } from '@/lib/publishing/config'
import { getConnection, usableAccessToken } from '@/lib/publishing/connection'
import { isBufferPlatform } from '@/lib/publishing/platform'
import {
  isWebSearchConfigured,
  mapConcurrently,
  searchImages,
  searchWeb
} from '@/lib/research/web-search'
import { safeFetch } from '@/lib/safe-url'
import { and, eq, inArray } from 'drizzle-orm'
import {
  imageQuery,
  imagesForPosts,
  postKey,
  postQueries,
  postsFromResults,
  profileFromResults,
  profileQuery,
  type ProfileRef,
  type SearchResult
} from './public-posts'
import type { InsightPost, InsightSources } from './types'

/**
 * Everything the app may read about how an account posts on a platform, from
 * the two sources it is allowed to use:
 *
 * - the public posts a search engine has indexed (./public-posts.ts), through
 *   the search API research already uses (Serper);
 * - the posts Buffer sent on the identity's own connected channel, through
 *   Buffer's API and the connection the user authorized for publishing.
 *
 * Neither reads the platform itself. LinkedIn, too, publishes through
 * Buffer, so its sent posts are read the same way.
 */

/** More posts than this add cost to the analysis, not accuracy. */
const MAX_POSTS = 40
/** Images the analysis looks at: enough to see a look, few enough to stay cheap. */
const MAX_IMAGES = 6
const MAX_IMAGE_BYTES = 1_500_000
const IMAGE_TIMEOUT_MS = 8000
/** Serper's free plan takes at most 10 results a request, so a search reads two pages. */
const RESULTS_PER_PAGE = 10
const PAGES_PER_QUERY = 2
const BUFFER_POSTS = 30

export type CollectedPosts = {
  posts: InsightPost[]
  images: Array<{ data: Uint8Array; mediaType: string; postUrl: string }>
  displayName?: string
  bio?: string
  sources: InsightSources
  /** Whether each source could be asked at all, for saying why nothing was found. */
  searchConfigured: boolean
  bufferConnected: boolean
}

/** A Buffer post as one of the account's posts. */
function fromBuffer(
  platform: ProfileRef['platform'],
  post: Awaited<ReturnType<typeof listSentPosts>>[number]
): InsightPost {
  return {
    url: post.url ?? `buffer:${post.id}`,
    text: post.text,
    kind:
      post.imageUrls.length > 1
        ? 'carousel'
        : post.imageUrls.length === 1
          ? 'photo'
          : platform === 'x' || platform === 'threads'
            ? 'post'
            : 'text post',
    ...(post.sentAt ? { date: post.sentAt.toISOString().slice(0, 10) } : {}),
    source: 'buffer',
    partial: false
  }
}

/**
 * The posts Buffer sent on the identity's channel for this platform, less
 * the ones this app wrote and published: those are its own drafts, not the
 * account's existing style. Empty when the platform is not connected through
 * Buffer, or Buffer cannot be read.
 */
async function bufferPosts(
  accountId: string,
  platform: ProfileRef['platform']
): Promise<{
  connected: boolean
  posts: Array<{ post: InsightPost; imageUrls: string[] }>
}> {
  if (!isBufferPlatform(platform)) return { connected: false, posts: [] }
  const config = bufferConfig(platform)
  if (!config) return { connected: false, posts: [] }
  // Buffer is a bonus: a failure here never costs the search-index posts.
  let connection: Awaited<ReturnType<typeof getConnection>>
  try {
    connection = await getConnection(db, accountId, platform)
  } catch (err) {
    console.warn(`Looking up the ${platform} connection failed:`, err)
    return { connected: false, posts: [] }
  }
  if (
    !connection ||
    connection.status !== 'connected' ||
    // Its own token, or (since Buffer OAuth) its Buffer connection's.
    (!connection.accessToken && !connection.bufferConnectionId)
  ) {
    return { connected: false, posts: [] }
  }
  try {
    const apiKey = await usableAccessToken(db, config, connection)
    const sent = (
      await listSentPosts(
        {
          apiKey,
          apiUrl: config.apiUrl,
          platformName: PLATFORMS[platform].name
        },
        connection.memberId,
        BUFFER_POSTS
      )
    ).filter(p => p.text.length > 0)
    const ids = sent.map(p => p.id)
    const ours = ids.length
      ? await db
          .select({ id: publicationsTable.externalPostId })
          .from(publicationsTable)
          .where(
            and(
              eq(publicationsTable.accountId, accountId),
              eq(publicationsTable.platform, platform),
              inArray(publicationsTable.externalPostId, ids)
            )
          )
      : []
    const published = new Set(ours.map(r => r.id))
    return {
      connected: true,
      posts: sent
        .filter(p => !published.has(p.id))
        .map(p => ({ post: fromBuffer(platform, p), imageUrls: p.imageUrls }))
    }
  } catch (err) {
    console.warn(`Reading sent ${platform} posts from Buffer failed:`, err)
    return { connected: true, posts: [] }
  }
}

/** An image to show the model, or null when it is not a small, ordinary picture. */
async function downloadImage(
  url: string,
  signal?: AbortSignal
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  try {
    const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS)
    const res = await safeFetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    if (!res.ok) return null
    const mediaType = res.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase()
    if (!mediaType || !/^image\/(?:jpeg|png|webp|gif)$/.test(mediaType))
      return null
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_IMAGE_BYTES) return null
    const data = new Uint8Array(await res.arrayBuffer())
    if (data.byteLength > MAX_IMAGE_BYTES || data.byteLength < 500) return null
    return { data, mediaType }
  } catch {
    return null
  }
}

const dateOrder = (a: InsightPost, b: InsightPost) =>
  (b.date ?? '').localeCompare(a.date ?? '')

/** What can be read about the account's posts, newest first, with a few of their images. */
export async function collectProfilePosts(options: {
  accountId: string
  ref: ProfileRef
  signal?: AbortSignal
}): Promise<CollectedPosts> {
  const { ref, signal } = options

  const searching = (async () => {
    if (!isWebSearchConfigured) return null
    const search = (q: string, page = 1) =>
      searchWeb(q, { freshnessDays: 0, resultCount: RESULTS_PER_PAGE, page })
    // Instagram's posts are found by the name its profile shows.
    const first = profileQuery(ref)
    const profileResults: SearchResult[] = first ? await search(first) : []
    const named = profileFromResults(ref, profileResults)
    const requests = postQueries(ref, named.displayName).flatMap(q =>
      Array.from({ length: PAGES_PER_QUERY }, (_, i) => ({ q, page: i + 1 }))
    )
    const imageSearch = imageQuery(ref, named.displayName)
    const [postResults, imageResults] = await Promise.all([
      mapConcurrently(requests, 3, r => search(r.q, r.page)).then(r =>
        r.flat()
      ),
      imageSearch
        ? searchImages(imageSearch, { resultCount: RESULTS_PER_PAGE })
        : []
    ])
    const results = [...profileResults, ...postResults]
    const profile = { ...profileFromResults(ref, postResults), ...named }
    const posts = postsFromResults(ref, results, profile.displayName ?? '')
    return { posts, imageResults, profile }
  })()

  const [buffer, found] = await Promise.all([
    bufferPosts(options.accountId, ref.platform),
    searching
  ])

  // A post Buffer sent may be indexed too: Buffer's copy has the whole text.
  const fromBufferKeys = new Set(
    buffer.posts
      .map(({ post }) => postKey(ref.platform, post.url))
      .filter(Boolean)
  )
  const searchPosts = (found?.posts ?? []).filter(
    p => !fromBufferKeys.has(postKey(ref.platform, p.url))
  )
  const posts = [
    ...buffer.posts.map(b => b.post).sort(dateOrder),
    ...searchPosts.sort(dateOrder)
  ].slice(0, MAX_POSTS)
  const kept = new Set(posts.map(p => p.url))

  // Images: Buffer's own thumbnails first, then the search engine's of indexed posts.
  const candidates = [
    ...buffer.posts
      .filter(b => kept.has(b.post.url))
      .flatMap(b =>
        b.imageUrls.slice(0, 1).map(url => ({ postUrl: b.post.url, url }))
      ),
    ...(found
      ? imagesForPosts(
          ref,
          searchPosts.filter(p => kept.has(p.url)),
          found.imageResults
        ).map(i => ({
          postUrl: i.postUrl,
          url: i.thumbnailUrl
        }))
      : [])
  ].slice(0, MAX_IMAGES * 2)
  const downloaded = await mapConcurrently(candidates, 3, async c => {
    const image = await downloadImage(c.url, signal)
    return image ? { ...image, postUrl: c.postUrl } : null
  })
  const images = downloaded
    .filter((i): i is NonNullable<typeof i> => i !== null)
    .slice(0, MAX_IMAGES)

  return {
    posts,
    images,
    ...(found?.profile.displayName
      ? { displayName: found.profile.displayName }
      : {}),
    ...(found?.profile.bio ? { bio: found.profile.bio } : {}),
    sources: {
      search: posts.filter(p => p.source === 'search').length,
      buffer: posts.filter(p => p.source === 'buffer').length,
      images: images.length
    },
    searchConfigured: isWebSearchConfigured,
    bufferConnected: buffer.connected
  }
}
