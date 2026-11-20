import 'server-only'

import { isWebSearchConfigured, searchImages, searchWeb } from '@/lib/research/web-search'
import { ArticleFetchError, scrapeArticle } from '@/lib/scraper'
import { readBodyCapped, safeFetch } from '@/lib/safe-url'
import type { ReferenceLink } from './link'
import { isFetchableThumbnail, oembedEndpoint, postFromXOembed, videoFromOembed } from './oembed'
import { readPostFromSearch } from './search-read'
import {
  REFERENCE_SOURCE_LABELS,
  REFERENCE_TEXT_MAX,
  REFERENCE_TEXT_MIN,
  type ReferencePost
} from './types'

/**
 * Reads a shared post from its link, by the routes the platforms allow:
 *
 * - X, YouTube and TikTok: their public embed APIs (oEmbed);
 * - Instagram, LinkedIn, Facebook and Threads: the search engine's copy,
 *   found by searching for the post's own address. Their pages are never
 *   loaded (their terms and robots rules forbid automated reading), so only
 *   what the index shows can be read, usually the opening;
 * - any other site: the page itself, as an article.
 *
 * What a video says out loud is never read: that would mean downloading it.
 * When too little can be read, ReferenceReadError says so and the user is
 * asked to paste the text.
 */

/** The link is fine, but its words could not be read: the user pastes them instead. */
export class ReferenceReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceReadError'
  }
}

const OEMBED_TIMEOUT_MS = 8000
const ARTICLE_TIMEOUT_MS = 12_000
const MAX_IMAGE_BYTES = 1_500_000
const IMAGE_TIMEOUT_MS = 8000

const cap = (text: string) =>
  text.length > REFERENCE_TEXT_MAX ? `${text.slice(0, REFERENCE_TEXT_MAX).trimEnd()}…` : text

async function fetchOembed(endpoint: string): Promise<unknown | null> {
  try {
    const res = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS)
    })
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) {
      await res.body?.cancel()
      return null
    }
    return await res.json()
  } catch {
    return null
  }
}

/** The search results for the post's own address, and its images when it is a visual platform's. */
async function searchFor(link: ReferenceLink, withImages: boolean) {
  const [results, images] = await Promise.all([
    searchWeb(link.url, { freshnessDays: 0, resultCount: 10 }),
    withImages ? searchImages(link.url, { resultCount: 10 }) : Promise.resolve([])
  ])
  return { results, images }
}

const notReadable = (link: ReferenceLink) =>
  new ReferenceReadError(
    `This ${REFERENCE_SOURCE_LABELS[link.source]} post’s words could not be read: it may be private, new, or not shown to search engines. Paste its text below and carry on.`
  )

async function readX(link: ReferenceLink): Promise<ReferencePost> {
  const post = postFromXOembed(await fetchOembed(oembedEndpoint('x', link.url)))
  if (!post) throw notReadable(link)
  return {
    url: link.url,
    source: 'x',
    kind: post.hasMedia ? 'photo' : 'post',
    ...(post.author ? { author: post.author } : {}),
    text: cap(post.text),
    partial: false,
    via: 'oembed'
  }
}

async function readVideo(link: ReferenceLink & { source: 'youtube' | 'tiktok' }): Promise<ReferencePost> {
  // A YouTube video's description, as far as the search engine shows it,
  // looked up alongside its embed.
  const searching =
    isWebSearchConfigured && link.source === 'youtube'
      ? searchFor(link, false)
      : Promise.resolve({ results: [] as Awaited<ReturnType<typeof searchWeb>> })
  const video = videoFromOembed(await fetchOembed(oembedEndpoint(link.source, link.url)))
  if (link.source === 'tiktok' && video) {
    // A TikTok's embed title is its caption.
    return {
      url: link.url,
      source: 'tiktok',
      kind: link.kind,
      ...(video.author ? { author: video.author } : {}),
      text: cap(video.title),
      partial: true,
      via: 'oembed',
      ...(video.imageUrl ? { imageUrl: video.imageUrl } : {})
    }
  }
  // A TikTok whose embed failed is looked for in the search engine too.
  const { results } =
    link.source === 'tiktok' && isWebSearchConfigured
      ? await searchFor(link, false)
      : await searching
  const id =
    link.source === 'youtube'
      ? new URL(link.url).searchParams.get('v') ?? /\/(?:shorts|live)\/([\w-]+)/.exec(link.url)?.[1]
      : /\/video\/(\d+)/.exec(link.url)?.[1]
  const own = results.find(r => id && r.url.includes(id))
  const description = own?.snippet.replace(/\s*(?:\.{3}|…)\s*$/, '').trim() ?? ''
  const title = video?.title ?? own?.title.replace(/\s*[-|]\s*(?:YouTube|TikTok)\s*$/i, '').trim() ?? ''
  if (!title && !description) throw notReadable(link)
  return {
    url: link.url,
    source: link.source,
    kind: link.kind,
    ...(video?.author ? { author: video.author } : {}),
    ...(title ? { title } : {}),
    text: cap(description || title),
    partial: true,
    via: video ? 'oembed' : 'search',
    ...(video?.imageUrl ? { imageUrl: video.imageUrl } : {})
  }
}

async function readIndexed(link: ReferenceLink): Promise<ReferencePost> {
  if (!isWebSearchConfigured) {
    throw new ReferenceReadError(
      `${REFERENCE_SOURCE_LABELS[link.source]} posts are read through web search, which is not set up here. Paste the post’s text below and carry on.`
    )
  }
  const visual = link.source !== 'linkedin'
  const { results, images } = await searchFor(link, visual)
  const post = readPostFromSearch(link, results, images)
  if (!post) throw notReadable(link)
  return {
    url: link.url,
    source: link.source,
    kind: post.kind,
    ...(post.author ? { author: post.author } : {}),
    text: cap(post.text),
    partial: true,
    via: 'search',
    ...(post.imageUrl ? { imageUrl: post.imageUrl } : {})
  }
}

async function readArticle(link: ReferenceLink): Promise<ReferencePost> {
  try {
    const article = await scrapeArticle(link.url, {
      minWords: 30,
      maxRedirects: 3,
      timeoutMs: ARTICLE_TIMEOUT_MS
    })
    return {
      url: link.url,
      source: 'web',
      kind: 'article',
      ...(article.author || article.siteName
        ? { author: article.author || article.siteName! }
        : {}),
      ...(article.title ? { title: article.title } : {}),
      text: cap(article.content),
      partial: article.content.length > REFERENCE_TEXT_MAX,
      via: 'page'
    }
  } catch (err) {
    const reason = err instanceof ArticleFetchError ? ` (${err.message.replace(/\.$/, '')})` : ''
    throw new ReferenceReadError(
      `This page could not be read${reason}. Paste its text below and carry on.`
    )
  }
}

/** What the shared link's post says, or ReferenceReadError when it cannot be read. */
export async function readReference(link: ReferenceLink): Promise<ReferencePost> {
  let post: ReferencePost
  switch (link.source) {
    case 'x':
      post = await readX(link)
      break
    case 'youtube':
    case 'tiktok':
      post = await readVideo(link as ReferenceLink & { source: 'youtube' | 'tiktok' })
      break
    case 'web':
      post = await readArticle(link)
      break
    default:
      post = await readIndexed(link)
  }
  if (post.text.trim().length < REFERENCE_TEXT_MIN && !post.title) throw notReadable(link)
  return post
}

/**
 * The post's picture for the model to look at, or null when it has none
 * that may be fetched (see isFetchableThumbnail) or it is not an ordinary
 * small image.
 */
export async function downloadReferenceImage(
  url: string | undefined
): Promise<{ data: Uint8Array; mediaType: string } | null> {
  if (!url || !isFetchableThumbnail(url)) return null
  try {
    const res = await safeFetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
    if (!res.ok) {
      await res.body?.cancel()
      return null
    }
    const mediaType = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!mediaType || !/^image\/(?:jpeg|png|webp|gif)$/.test(mediaType)) {
      await res.body?.cancel()
      return null
    }
    const { bytes, truncated } = await readBodyCapped(res, MAX_IMAGE_BYTES)
    if (truncated || bytes.byteLength < 500) return null
    return { data: bytes, mediaType }
  } catch {
    return null
  }
}
