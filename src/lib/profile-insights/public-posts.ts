import type { PlatformId } from '@/lib/formats'
import { canonicalProfileLink, platformOfLink } from '@/lib/profile-links'
import { isSearchRedirect } from '@/lib/research/search-redirect'
import type { InsightPost } from './types'

/**
 * An account's public posts, as a search engine's index shows them. The app
 * never loads Instagram, X, LinkedIn, Facebook or Threads pages itself (their
 * terms and robots rules forbid automated reading); it asks the search API it
 * already uses for the posts the platforms let search engines index, and
 * reads what the results say. Pure, so the rules below are tested against
 * real results (tests/profile-insights.test.ts).
 *
 * A search for an account also finds other people's posts about it, and a
 * result's snippet can be a reply or a comment rather than the post. So a
 * result counts only when the platform's own markings say the account wrote
 * it (the address names it, or the page's title or text does), and its text
 * is the part known to be the account's: usually only the opening.
 */

export type SearchResult = {
  url: string
  title: string
  snippet: string
  /** YYYY-MM-DD, when the search engine dates it. */
  publishedAt?: string
}

export type ImageResult = {
  /** The page the image is on. */
  pageUrl: string
  title: string
  /** The search engine's own small copy of the image. */
  thumbnailUrl: string
  width?: number
  height?: number
}

/** The account a profile link names. */
export type ProfileRef = {
  platform: PlatformId
  /** Its canonical address (canonicalProfileLink). */
  url: string
  /** Its handle, page name or vanity name, as the platform's addresses spell it, lower case. */
  handle: string
  /** The name it goes by, for searches that need one. */
  name: string
}

/** Why a profile link cannot be analyzed, in words for the user. */
export class UnanalyzableLinkError extends Error {}

/** The account a saved profile link names, or why it cannot be looked up. */
export function profileRefOf(
  platform: PlatformId,
  link: string,
  name: string
): ProfileRef {
  const url = canonicalProfileLink(platform, link)
  if (platform === 'youtube') {
    throw new UnanalyzableLinkError(
      'YouTube channels are not analyzed: their posts are videos.'
    )
  }
  if (!url) {
    throw new UnanalyzableLinkError(
      'This link does not name an account, so its posts cannot be looked up. Use the address of the profile itself.'
    )
  }
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  let handle: string | undefined
  switch (platform) {
    case 'linkedin':
      handle = parts[1]
      break
    case 'threads':
      handle = parts[0]?.replace(/^@/, '')
      break
    case 'facebook':
      if (parts[0] === 'profile.php') {
        throw new UnanalyzableLinkError(
          'This Facebook link names the profile by number, so its posts cannot be looked up. Use the address with the page name, like facebook.com/your-page.'
        )
      }
      handle = parts[0]
      break
    default:
      handle = parts[0]
  }
  if (!handle) {
    throw new UnanalyzableLinkError(
      'This link does not name an account. Use the address of the profile itself.'
    )
  }
  return {
    platform,
    url,
    handle: handle.toLowerCase(),
    name: name.trim() || handle
  }
}

/** Quotes for a search: a phrase in double quotes cannot hold one itself. */
const phrase = (value: string) => `"${value.replace(/"/g, '').trim()}"`

/**
 * The search that finds the profile itself (its name and bio), run before
 * the post searches. Only Instagram needs one: its posts are found through
 * the name the profile shows, which may not be the identity's.
 */
export function profileQuery(ref: ProfileRef): string | null {
  return ref.platform === 'instagram'
    ? `site:instagram.com ${phrase(`(@${ref.handle})`)}`
    : null
}

/**
 * The searches for the account's posts. Instagram's logged-out post pages say
 * "Join <name> on Instagram" for their author; LinkedIn's post addresses
 * start with the author's vanity name; X, Facebook and Threads put the
 * account in the post's address.
 */
export function postQueries(ref: ProfileRef, displayName?: string): string[] {
  const name = displayName?.trim() || ref.name
  switch (ref.platform) {
    case 'instagram':
      return [`site:instagram.com ${phrase(`Join ${name} on Instagram`)}`]
    case 'x':
      return [`site:x.com/${ref.handle}/status`, `site:x.com/${ref.handle}`]
    case 'linkedin':
      return [
        `${phrase(name)} site:linkedin.com/posts`,
        `${phrase(ref.handle)} site:linkedin.com/posts`
      ]
    case 'facebook':
      return [
        `site:facebook.com/${ref.handle}/posts`,
        `site:facebook.com/${ref.handle}`
      ]
    case 'threads':
      return [
        `site:threads.com/@${ref.handle}`,
        `site:threads.net/@${ref.handle}`
      ]
    default:
      return []
  }
}

/** The image search whose results are matched to the posts found. */
export function imageQuery(
  ref: ProfileRef,
  displayName?: string
): string | null {
  return postQueries(ref, displayName)[0] ?? null
}

// ---------------------------------------------------------------------------
// Reading results
// ---------------------------------------------------------------------------

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const squash = (value: string) => value.replace(/\s+/g, ' ').trim()
/** Letters and digits only, lower case: for comparing text that was cut or reformatted. */
const letters = (value: string) =>
  value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '')
const withoutEllipsis = (value: string) =>
  squash(value)
    .replace(/\s*(?:\.{3}|…)\s*$/, '')
    .trim()

/**
 * Whether `longer` is `shorter` with more after it, ignoring punctuation,
 * emoji and case: a snippet that only starts the same way and then runs into
 * a reply does not count.
 */
function continues(longer: string, shorter: string): boolean {
  const head = letters(shorter)
  return head.length >= 8 && letters(longer).startsWith(head)
}

function pathOf(url: string): { path: string; params: URLSearchParams } | null {
  try {
    const parsed = new URL(url)
    return { path: parsed.pathname, params: parsed.searchParams }
  } catch {
    return null
  }
}

/**
 * The same post found twice (another host, query or path suffix) has one
 * key: the platform's own id for it.
 */
export function postKey(platform: PlatformId, url: string): string | null {
  const parts = pathOf(url)
  if (!parts) return null
  const path = parts.path
  const patterns: Partial<Record<PlatformId, RegExp>> = {
    instagram: /\/(?:p|reels?|tv)\/([\w-]+)/i,
    x: /\/status\/(\d+)/i,
    linkedin: /-activity-(\d+)/i,
    threads: /\/post\/([\w-]+)/i,
    facebook: /^\/[^/]+\/((?:posts|videos|photos|reels?)\/.+?)\/?$/i
  }
  const match = patterns[platform]?.exec(path)
  return match ? `${platform}:${match[1]!.toLowerCase()}` : null
}

type Reader = (
  result: SearchResult,
  ref: ProfileRef,
  displayName: string
) => Pick<InsightPost, 'text' | 'kind' | 'wordsOnly'> | null

/**
 * The caption in an Instagram post page's title, without what Instagram
 * puts around it: "… - Zomato (@zomato)", "zomato - …", "… - zomato",
 * "Zomato on Instagram: "…"". Empty for a title with no caption ("Photo by
 * Zomato (@zomato) · March 8, 2021").
 */
function instagramCaption(title: string, handleText: string): string {
  const handle = escapeRe(handleText)
  const text = squash(title)
    .replace(new RegExp(`\\s*[-–|]\\s*[^-–|]*\\(@${handle}\\)\\s*$`, 'i'), '')
    .replace(
      new RegExp(`^${handle}\\s+[-–]\\s+|\\s+[-–]\\s*${handle}$`, 'i'),
      ''
    )
    .replace(/^.{1,60}? on Instagram:\s*["“](.*?)["”]?$/i, '$1')
  if (
    /^(?:photo|video|reel|post)s? (?:by|shared by)\b/i.test(text) ||
    /•\s*Instagram/i.test(text)
  ) {
    return ''
  }
  return withoutEllipsis(text)
}

/** "… - Zomato (@zomato)", "Photo by Zomato (@zomato) · March 8, 2021": the account's own post page. */
const readInstagram: Reader = (result, ref, displayName) => {
  const parts = pathOf(result.url)
  // A result Google wrapped in a redirect link (see search-redirect.ts) has
  // no address to read: only its title and snippet say whose post it is.
  const wrapped = isSearchRedirect(result.url)
  const match = wrapped
    ? ([result.url, undefined, 'p'] as const)
    : parts && /^\/(?:([\w.]+)\/)?(p|reels?|tv)\/[\w-]+/i.exec(parts.path)
  if (!match) return null
  if (match[1] && match[1].toLowerCase() !== ref.handle) return null
  const handle = escapeRe(ref.handle)
  const title = squash(result.title)
  const snippet = squash(result.snippet)
  // Instagram's own description of a post: "12 likes, 3 comments - zomato on March 22, 2022: "caption"",
  // or, cut short, "caption - @zomato on March 22, 2022."
  const described =
    new RegExp(
      `(?:^|\\s)-\\s*@?${handle} on [A-Z][a-z]+ \\d{1,2}, \\d{4}:\\s*["“](.+?)["”]?\\.?$`,
      'i'
    ).exec(snippet)?.[1] ??
    new RegExp(
      `^(.+?)\\s+-\\s*@?${handle} on [A-Z][a-z]+ \\d{1,2}, \\d{4}\\.?$`,
      'i'
    ).exec(snippet)?.[1]
  const owned =
    Boolean(match[1]) ||
    Boolean(described) ||
    new RegExp(`\\(@${handle}\\)\\s*(?:·.*)?$`, 'i').test(title) ||
    new RegExp(`^${handle}\\s+[-–]\\s+|\\s[-–]\\s*${handle}$`, 'i').test(
      title
    ) ||
    (displayName !== '' &&
      new RegExp(`\\bJoin ${escapeRe(displayName)} on Instagram\\b`, 'i').test(
        snippet
      ))
  if (!owned) return null

  let text = instagramCaption(title, ref.handle)
  if (
    described &&
    (!text || continues(described, text) || described.length > text.length)
  ) {
    text = withoutEllipsis(described)
  }
  return { text, kind: /^p$/i.test(match[2]!) ? 'post' : 'reel' }
}

/** A post's own page on X: zomato on X: "…", or the text in quotes. */
const readX: Reader = (result, ref) => {
  const parts = pathOf(result.url)
  const match = parts && /^\/(\w+)\/status\/\d+/i.exec(parts.path)
  if (!match || match[1]!.toLowerCase() !== ref.handle) return null
  const title = squash(result.title)
  const handle = escapeRe(ref.handle)
  // The title is the post's own text; the snippet is often a reply under it.
  let text =
    /^.+? on (?:X|Twitter):\s*["“](.*?)["”]?\s*(?:\/\s*(?:X|Twitter))?$/i.exec(
      title
    )?.[1] ??
    /^["“](.+?)["”]?\s*(?:\/\s*(?:X|Twitter))?$/.exec(title)?.[1] ??
    new RegExp(`^${handle}\\s+[-–]\\s+(.+)$`, 'i').exec(title)?.[1] ??
    ''
  text = withoutEllipsis(text)
  if (!text) return null
  const snippet = squash(result.snippet)
  if (snippet.length > text.length && continues(snippet, text))
    text = withoutEllipsis(snippet)
  return { text, kind: 'post' }
}

/**
 * A LinkedIn post's address is /posts/<author>_<its-first-words>-activity-<id>:
 * the author, and the opening, from the address itself. Its title is the
 * first line only when it ends "| <author's name>" (otherwise LinkedIn wrote
 * a headline of its own), and its snippet is often a comment.
 */
const readLinkedIn: Reader = (result, ref) => {
  const parts = pathOf(result.url)
  const match =
    parts && /^\/posts\/([^/_]+)_([^/]*?)-activity-\d+/i.exec(parts.path)
  if (!match || match[1]!.toLowerCase() !== ref.handle) return null
  // A machine translation of the post (?tl=ko), not its own words.
  if (parts.params.has('tl')) return null
  let opening = ''
  try {
    opening = squash(decodeURIComponent(match[2]!).replace(/-/g, ' '))
  } catch {
    opening = squash(match[2]!.replace(/-/g, ' '))
  }
  if (opening.split(' ').length < 3) opening = ''
  const title = squash(result.title)
  const name = escapeRe(ref.name)
  const firstLine =
    new RegExp(`^(.+?)\\s*\\|\\s*${name}\\s*$`, 'i').exec(title)?.[1] ?? ''
  const line = /'s Post$/i.test(firstLine) ? '' : withoutEllipsis(firstLine)
  const snippet = withoutEllipsis(
    squash(result.snippet).replace(new RegExp(`^${name}\\s+`, 'i'), '')
  )
  const known = line || opening
  if (known && snippet.length > known.length && continues(snippet, known)) {
    return { text: snippet, kind: 'post' }
  }
  if (line) return { text: line, kind: 'post' }
  // The address keeps the words, lower case, without punctuation.
  return opening ? { text: opening, kind: 'post', wordsOnly: true } : null
}

/** What Facebook adds around a post in a result: likes, "Recent posts", page updates. */
const FACEBOOK_NOISE =
  /\s*(?:\d+\s*·\s*)?(?:Like|Comment|Share)\.?(?=\s|$)|\s*Recent posts\.?|\s*[^.]*updated their (?:cover|profile) photo\.?[^.]*\.?|\s*No photo description available\.?/gi

/** A post under the page's own address: /<page>/posts/…, /videos/…, /photos/…, /reels/…. */
const readFacebook: Reader = (result, ref) => {
  const parts = pathOf(result.url)
  const match =
    parts && /^\/([^/]+)\/(posts|videos|photos|reels?)\//i.exec(parts.path)
  if (!match || match[1]!.toLowerCase() !== ref.handle) return null
  const title = squash(result.title).replace(/\s*[|-]\s*Facebook\s*$/i, '')
  // A template the page never filled in ({{product.brand}}), or only the page's name.
  if (/\{\{.*\}\}/.test(title)) return null
  const named =
    letters(title) === letters(ref.name) ||
    letters(title) === letters(ref.handle)
  let text = named ? '' : withoutEllipsis(title)
  const snippet = withoutEllipsis(
    squash(result.snippet.replace(FACEBOOK_NOISE, ' '))
  )
  if (text && snippet.length > text.length && continues(snippet, text))
    text = snippet
  if (!text) return null
  const kind = {
    posts: 'post',
    videos: 'video',
    photos: 'photo',
    reel: 'reel',
    reels: 'reel'
  }[match[2]!.toLowerCase()]!
  return { text, kind }
}

/** A post under /@<handle>/post/…; its title is usually only "<name> (@handle) on Threads". */
const readThreads: Reader = (result, ref) => {
  const parts = pathOf(result.url)
  const match = parts && /^\/@([\w.]+)\/post\/[\w-]+/i.exec(parts.path)
  if (!match || match[1]!.toLowerCase() !== ref.handle) return null
  const title = squash(result.title)
  const generic =
    /\(@[\w.]+\)\s*on Threads\s*$/i.test(title) || /^Threads$/i.test(title)
  const text = withoutEllipsis(
    generic ? result.snippet : title.replace(/\s*[|•-]\s*Threads\s*$/i, '')
  )
  return text ? { text, kind: 'post' } : null
}

const READERS: Partial<Record<PlatformId, Reader>> = {
  instagram: readInstagram,
  x: readX,
  linkedin: readLinkedIn,
  facebook: readFacebook,
  threads: readThreads
}

/**
 * The account's own posts among search results, once each, in the order
 * found. Results that are someone else's, or that show none of the post's
 * own words, are left out.
 */
export function postsFromResults(
  ref: ProfileRef,
  results: readonly SearchResult[],
  displayName = ''
): InsightPost[] {
  const read = READERS[ref.platform]
  if (!read) return []
  const posts: InsightPost[] = []
  const keys = new Set<string>()
  for (const result of results) {
    const wrapped = ref.platform === 'instagram' && isSearchRedirect(result.url)
    if (!wrapped && platformOfLink(result.url) !== ref.platform) continue
    const post = read(result, ref, displayName)
    if (!post) continue
    const key = postKey(ref.platform, result.url) ?? result.url
    if (keys.has(key)) continue
    // A page's ads run the same text under many addresses, some cut shorter:
    // one post, with the most of its text that was found.
    const same = posts.find(
      p => continues(p.text, post.text) || continues(post.text, p.text)
    )
    if (same) {
      if (
        post.text.length > same.text.length ||
        (same.wordsOnly && !post.wordsOnly)
      ) {
        same.text = post.text
        if (post.wordsOnly) same.wordsOnly = true
        else delete same.wordsOnly
      }
      continue
    }
    keys.add(key)
    posts.push({
      url: result.url,
      text: post.text,
      kind: post.kind,
      ...(post.wordsOnly ? { wordsOnly: true } : {}),
      ...(result.publishedAt ? { date: result.publishedAt } : {}),
      source: 'search',
      partial: true
    })
  }
  return posts
}

/**
 * The name and bio the profile shows, from its own page among the results:
 * "Zomato (@zomato) • Instagram photos and videos", "Zomato (@zomato) / X".
 */
export function profileFromResults(
  ref: ProfileRef,
  results: readonly SearchResult[]
): { displayName?: string; bio?: string } {
  const own = results.find(
    r =>
      platformOfLink(r.url) === ref.platform &&
      canonicalProfileLink(ref.platform, r.url) === ref.url &&
      // The profile's own page, not one of its posts.
      (pathOf(r.url)?.path.split('/').filter(Boolean).length ?? 0) <=
        (ref.platform === 'linkedin' ? 2 : 1)
  )
  if (!own) return {}
  const displayName = new RegExp(
    `^(.*?)\\s*\\(@${escapeRe(ref.handle)}\\)`,
    'i'
  )
    .exec(squash(own.title))?.[1]
    ?.trim()
  const bio = squash(own.snippet)
    .replace(/\s*See Instagram photos and videos from .*$/i, '')
    .trim()
  return {
    ...(displayName ? { displayName } : {}),
    ...(bio ? { bio: bio.slice(0, 500) } : {})
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const SHAPES: Array<[string, number]> = [
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['9:16', 9 / 16],
  ['2:3', 2 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['1.91:1', 1.91],
  ['4:3', 4 / 3]
]

/** "4:5" for a 1080×1350 image; null when the size is unknown or unusual. */
export function aspectOf(width?: number, height?: number): string | null {
  if (!width || !height) return null
  const ratio = width / height
  const [name, value] = SHAPES.reduce((best, shape) =>
    Math.abs(shape[1] - ratio) < Math.abs(best[1] - ratio) ? shape : best
  )
  return Math.abs(value - ratio) / value <= 0.06 ? name : null
}

/** The search engine's own thumbnails; a platform's image servers are never fetched. */
export const isSearchThumbnail = (url: string) => {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      /^encrypted-tbn\d\.gstatic\.com$/.test(parsed.hostname)
    )
  } catch {
    return false
  }
}

/**
 * Image results that belong to the account's posts: an image search does
 * not check who posted, so an image counts only on a post already known to
 * be the account's, or on a page the platform's own markings give to it
 * (the post's address names the account, or its title does: "… (@zomato)"),
 * read by the same rules as the posts. A known post gets its image's shape.
 */
export function imagesForPosts(
  ref: ProfileRef,
  posts: InsightPost[],
  images: readonly ImageResult[],
  displayName = ''
): Array<{ postUrl: string; thumbnailUrl: string }> {
  const byKey = new Map(
    posts.map(p => [postKey(ref.platform, p.url) ?? p.url, p])
  )
  const read = READERS[ref.platform]
  const out: Array<{ postUrl: string; thumbnailUrl: string }> = []
  const used = new Set<string>()
  for (const image of images) {
    const key = postKey(ref.platform, image.pageUrl) ?? image.pageUrl
    if (used.has(key) || !isSearchThumbnail(image.thumbnailUrl)) continue
    const post = byKey.get(key)
    if (!post) {
      // A post the text searches did not find: kept only when its own page
      // says it is the account's, and never through a redirect link.
      const owned =
        !isSearchRedirect(image.pageUrl) &&
        postKey(ref.platform, image.pageUrl) !== null &&
        read?.(
          { url: image.pageUrl, title: image.title, snippet: '' },
          ref,
          displayName
        )
      if (!owned) continue
      used.add(key)
      out.push({ postUrl: image.pageUrl, thumbnailUrl: image.thumbnailUrl })
      continue
    }
    used.add(key)
    const aspect = aspectOf(image.width, image.height)
    if (aspect) post.aspect = aspect
    // An image result's title often holds more of the caption.
    const caption =
      ref.platform === 'instagram'
        ? instagramCaption(image.title, ref.handle)
        : withoutEllipsis(squash(image.title))
    if (
      post.text &&
      caption.length > post.text.length &&
      continues(caption, post.text)
    ) {
      post.text = caption
    }
    out.push({ postUrl: post.url, thumbnailUrl: image.thumbnailUrl })
  }
  return out
}
