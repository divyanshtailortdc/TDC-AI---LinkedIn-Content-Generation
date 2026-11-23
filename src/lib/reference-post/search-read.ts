import {
  isSearchThumbnail,
  postKey,
  postsFromResults,
  type ImageResult,
  type ProfileRef,
  type SearchResult
} from '@/lib/profile-insights/public-posts'
import type { PlatformId } from '@/lib/formats'
import type { ReferenceLink } from './link'
import type { ReferenceKind } from './types'

/**
 * One shared post, as the search engine's index shows it. Like the profile
 * insights (src/lib/profile-insights/public-posts.ts), the app never loads
 * Instagram, LinkedIn, Facebook or Threads pages: it searches for the post's
 * own address and reads what the results say. Pure, so the rules are tested
 * against real results (tests/reference-post.test.ts).
 *
 * The result is known to be the post (its address names the same post), but
 * a snippet can still be a comment under it. So the caption is read with the
 * profile insights' rules, which know where each platform puts the author's
 * own words, once the author is known from the address or the result.
 */

export type SearchRead = {
  text: string
  author?: string
  kind: ReferenceKind
  /** The search engine's thumbnail of its picture or cover, when one was found. */
  imageUrl?: string
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim()
const withoutEllipsis = (value: string) =>
  squash(value).replace(/\s*(?:\.{3}|…)\s*$/, '').trim()

/** The author's handle as the post's own address spells it, when it does. */
function handleInUrl(platform: PlatformId, url: string): string | null {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }
  const patterns: Partial<Record<PlatformId, RegExp>> = {
    x: /^\/(\w+)\/status\//i,
    linkedin: /^\/posts\/([^/_]+)_/i,
    threads: /^\/@([\w.]+)\/post\//i,
    instagram: /^\/([\w.]+)\/(?:p|reels?|tv)\//i,
    facebook: /^\/([^/]+)\/(?:posts|videos|photos|reels?)\//i
  }
  return patterns[platform]?.exec(path)?.[1]?.toLowerCase() ?? null
}

/**
 * The author, from how a platform titles a post's page: "… - Zomato
 * (@zomato)", "Zomato on Instagram: "…"", "… - zomato on March 22, 2022",
 * "Girish Sharma's Post", "… | Girish Sharma".
 */
function authorInResults(
  platform: PlatformId,
  results: readonly SearchResult[]
): { handle?: string; name?: string } {
  for (const r of results) {
    const title = squash(r.title)
    const snippet = squash(r.snippet)
    if (platform === 'instagram' || platform === 'threads') {
      const tagged = /(?:^|[-–|]\s*)([^-–|()]{1,60}?)\s*\(@([\w.]+)\)/.exec(title)
      if (tagged) return { name: tagged[1]!.trim(), handle: tagged[2]!.toLowerCase() }
      const dated = /(?:^|\s)-\s*@?([\w.]+) on [A-Z][a-z]+ \d{1,2}, \d{4}/.exec(snippet)
      if (dated) return { handle: dated[1]!.toLowerCase() }
      const said = /^(.{1,60}?) on Instagram:/i.exec(title)
      if (said) return { name: said[1]!.trim() }
    }
    if (platform === 'linkedin') {
      const own = /^(.+?)['’]s Post$/i.exec(title) ?? /\|\s*([^|]{2,60})$/.exec(title)
      if (own) return { name: own[1]!.trim() }
    }
  }
  return {}
}

/** A title that is only the platform's wrapper, with none of the post's words. */
function isGenericTitle(title: string): boolean {
  return (
    !title ||
    /^(?:instagram|facebook|threads|linkedin|x|twitter)$/i.test(title) ||
    /['’]s Post$/i.test(title) ||
    /^(?:photo|video|reel|post)s? (?:by|shared by)\b/i.test(title) ||
    // "Zomato (@zomato) on Threads": a name, and no caption before it.
    (/\(@[\w.]+\)\s*(?:on Threads|•\s*Instagram.*)?$/i.test(title) && !/ [-–|] /.test(title))
  )
}

/** The title without the platform's own wording around the caption. */
function titleText(title: string): string {
  return withoutEllipsis(
    squash(title)
      .replace(/\s*[-–|]\s*[^-–|]*\(@[\w.]+\)\s*$/i, '')
      .replace(/^.{1,60}? on (?:Instagram|X|Twitter|Threads):\s*["“](.*?)["”]?$/i, '$1')
      .replace(/\s*[|•-]\s*(?:Facebook|Threads|LinkedIn|Instagram)\s*$/i, '')
  )
}

/**
 * The post among the results for its address, or null when none of them is
 * it. `images` are an image search for the same address: its thumbnail, and
 * how many pictures it has (several on one Instagram post: a carousel).
 */
export function readPostFromSearch(
  link: ReferenceLink,
  results: readonly SearchResult[],
  images: readonly ImageResult[] = []
): SearchRead | null {
  const platform = link.source as PlatformId
  const same = (url: string) =>
    link.key ? postKey(platform, url) === link.key : url === link.url
  const own = results.filter(r => same(r.url))
  if (own.length === 0) return null
  // An image result's title often holds more of the caption: read like a result's.
  const imageTitles: SearchResult[] = images
    .filter(i => same(i.pageUrl) && i.title)
    .map(i => ({ url: i.pageUrl, title: i.title, snippet: '' }))

  const fromUrl = handleInUrl(platform, link.url) ?? own.map(r => handleInUrl(platform, r.url)).find(Boolean)
  const found = authorInResults(platform, own)
  const handle = fromUrl ?? found.handle ?? null
  const name = found.name ?? ''

  let text = ''
  if (handle || (platform === 'linkedin' && name)) {
    const ref: ProfileRef = {
      platform,
      url: link.url,
      handle: handle ?? '',
      name: name || handle || ''
    }
    // Every result is this post: each one's address is given as the shared
    // link, so the readers' authorship checks read the author from it.
    // postsFromResults keeps one post per address, so each is read alone.
    text =
      [...own, ...imageTitles]
        .flatMap(r => postsFromResults(ref, [r], name))
        .map(p => p.text)
        .sort((a, b) => b.length - a.length)[0] ?? ''
  }
  if (!text) {
    // No author to check the snippet against: the title alone, when it holds
    // the post's words (the snippet may be a comment).
    const title = own.map(r => squash(r.title)).find(t => !isGenericTitle(t))
    text = title ? titleText(title) : ''
  }
  if (!text) return null

  const thumbnails = [
    ...new Set(
      images
        .filter(i => same(i.pageUrl) && isSearchThumbnail(i.thumbnailUrl))
        .map(i => i.thumbnailUrl)
    )
  ]
  const kind: ReferenceKind =
    link.kind === 'post' && platform === 'instagram' && thumbnails.length >= 2
      ? 'carousel'
      : link.kind
  const author = handle
    ? platform === 'linkedin' || platform === 'facebook'
      ? name || handle
      : name
        ? `${name} (@${handle})`
        : `@${handle}`
    : name || undefined
  return {
    text,
    ...(author ? { author } : {}),
    kind,
    ...(thumbnails[0] ? { imageUrl: thumbnails[0] } : {})
  }
}
