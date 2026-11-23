import * as cheerio from 'cheerio'

/**
 * Reading the public embed APIs (oEmbed) that X, YouTube and TikTok offer
 * for showing a post on another site: no sign-in, no key, and meant for
 * exactly this. Pure: the answers are parsed here, fetched in ./read.ts.
 */

/** The endpoint that describes a post at `url`, for the platforms that have a public one. */
export function oembedEndpoint(
  source: 'x' | 'youtube' | 'tiktok',
  url: string
): string {
  const u = encodeURIComponent(url)
  switch (source) {
    case 'x':
      return `https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=${u}`
    case 'youtube':
      return `https://www.youtube.com/oembed?format=json&url=${u}`
    case 'tiktok':
      return `https://www.tiktok.com/oembed?url=${u}`
  }
}

const squash = (value: string) => value.replace(/[ \t]+/g, ' ').trim()

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/**
 * An X post from its embed: the post's own text is the blockquote's first
 * paragraph (its line breaks are <br>); the rest is "— name (@handle) date".
 */
export function postFromXOembed(
  json: unknown
): { text: string; author?: string; hasMedia: boolean } | null {
  const data = (json ?? {}) as Record<string, unknown>
  const html = str(data.html)
  if (!html) return null
  const $ = cheerio.load(html)
  const p = $('blockquote p').first()
  if (p.length === 0) return null
  p.find('br').replaceWith('\n')
  // Links in the text show as their text (t.co links show their target).
  const text = p
    .text()
    .split('\n')
    .map(squash)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) return null
  // A picture or video in the post shows as a pic.twitter.com link.
  const hasMedia = /\bpic\.(?:twitter|x)\.com\//i.test(text)
  const cleaned = text.replace(/\s*\bpic\.(?:twitter|x)\.com\/\w+/gi, '').trim()
  const name = str(data.author_name)
  const handle = /\/([A-Za-z0-9_]{1,15})\/?$/.exec(str(data.author_url))?.[1]
  const author = name && handle ? `${name} (@${handle})` : name || (handle ? `@${handle}` : '')
  return {
    text: cleaned || text,
    ...(author ? { author } : {}),
    hasMedia
  }
}

/** Only these hosts' thumbnails are fetched, for the model to look at. */
export function isFetchableThumbnail(url: string | undefined): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      (/^encrypted-tbn\d\.gstatic\.com$/.test(u.hostname) ||
        /^i\d?\.ytimg\.com$/.test(u.hostname) ||
        /(^|\.)tiktokcdn(?:-[a-z]+)?\.com$/.test(u.hostname))
    )
  } catch {
    return false
  }
}

/** A YouTube video or TikTok from its embed: its title (a TikTok's caption), author and cover. */
export function videoFromOembed(
  json: unknown
): { title: string; author?: string; imageUrl?: string } | null {
  const data = (json ?? {}) as Record<string, unknown>
  const title = squash(str(data.title))
  if (!title) return null
  const author = str(data.author_name)
  const thumb = str(data.thumbnail_url)
  return {
    title,
    ...(author ? { author } : {}),
    ...(isFetchableThumbnail(thumb) ? { imageUrl: thumb } : {})
  }
}
