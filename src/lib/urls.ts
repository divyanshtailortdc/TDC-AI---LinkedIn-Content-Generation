/**
 * URL helpers for comparing links people typed with links found elsewhere.
 * Client-safe: no network access.
 */

/** Query parameters that only record a click; the page is the same without them. */
const TRACKING_PARAM =
  /^(?:utm_[a-z]+|srsltid|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|igshid|trk)$/i

function dropTrackingParams(url: URL): boolean {
  const tracking = [...url.searchParams.keys()].filter(key =>
    TRACKING_PARAM.test(key)
  )
  for (const key of tracking) url.searchParams.delete(key)
  return tracking.length > 0
}

/**
 * `raw` without click-tracking parameters, otherwise exactly as written.
 * Google adds "?srsltid=…" to shop results, so a homepage came back as
 * "https://www.samsung.com/in/?srsltid=AU7gw…" and was saved that way.
 */
export function stripTrackingParams(raw: string): string {
  try {
    const url = new URL(raw)
    return dropTrackingParams(url) ? url.toString() : raw
  } catch {
    return raw
  }
}

/**
 * Lowercase host, no scheme, no "www.", no trailing slash, no click-tracking
 * parameters: "https://www.samsung.com/in/?srsltid=…" is samsung.com/in.
 */
export function normalizeUrlForCompare(raw: string): string {
  const trimmed = raw.trim()
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    )
    dropTrackingParams(url)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    return `${host}${path}${url.search}`
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '')
  }
}

/** A link found in someone's text. */
export type FoundLink = {

  url: string
  homepage: string
 
  explicit: boolean
}

/**
 * A link exactly as someone wrote it, with https:// added when the scheme is
 * missing, or null when it is not a web address. Nothing else changes: not
 * the host ("www." stays or stays off), not the path, not a trailing slash.
 */
export function toWebUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(absolute)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  // A name with a top-level domain, not "localhost" or an IP address.
  if (!/\.[a-z]{2,}$/i.test(url.hostname)) return null
  return absolute
}

/** True when `url` is the root of its site rather than a page on it. */
export function isSiteRoot(url: string): boolean {
  try {
    return new URL(url).pathname === '/'
  } catch {
    return false
  }
}

/** A path part naming a locale ("us", "en-gb", "global"), not a page. */
const LOCALE_SEGMENT = /^(?:[a-z]{2}(?:[-_][a-z]{2})?|global|intl)$/i
/** A section that lists stories rather than telling one. */
const INDEX_SEGMENT =
  /^(?:news(?:room)?|press(?:room|-?releases?)?|media(?:-?(?:centre|center|room))?|blogs?|stories|articles|updates|latest|home|index\.(?:html?|php))$/i

/** True for a site's root or a regional homepage ("/in/", "/en-gb/"). */
export function isHomepage(url: string): boolean {
  try {
    return new URL(url).pathname
      .split('/')
      .filter(Boolean)
      .every(part => LOCALE_SEGMENT.test(part))
  } catch {
    return false
  }
}

/**
 * True for a homepage, a regional homepage ("/us/", "/en-gb/"), a section
 * index ("/newsroom", "/global/news") or a site search ("/search?q=AI").
 * These change daily and describe the whole site, so they can never stand as
 * the source of one story.
 */
export function isGenericPage(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (
    /search/i.test(parts[parts.length - 1] ?? '') ||
    ['q', 's', 'query'].some(key => parsed.searchParams.has(key))
  ) {
    return true
  }
  let i = 0
  while (i < parts.length && LOCALE_SEGMENT.test(parts[i]!)) i++
  const rest = parts.slice(i)
  return rest.length === 0 || (rest.length === 1 && INDEX_SEGMENT.test(rest[0]!))
}

/**
 * Encyclopedias are dated by their last edit, which says nothing about when
 * anything they describe happened, so they are never recent news.
 */
export function isReferencePage(url: string): boolean {
  try {
    return /(^|\.)(?:wikipedia\.org|wikimedia\.org|britannica\.com)$/i.test(
      new URL(url).hostname
    )
  } catch {
    return false
  }
}

/**
 * Scheme, "www." and host. Not preceded by "@" (an email address) or a word
 * character, and the top-level domain may not run into more letters.
 */
const LINK_PATTERN =
  /(?<![@\w.\/-])(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![\w-]|\.[a-z0-9])(?::\d{2,5})?(?:[/?#][^\s<>"'`]*)?/gi

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** Drops sentence punctuation and closing brackets that belong to the text around a link. */
function trimLink(match: string): string {
  let link = match
  for (;;) {
    const last = link.at(-1) ?? ''
    if (/[.,;:!?*]/.test(last)) {
      link = link.slice(0, -1)
      continue
    }
    const opener = CLOSERS[last]
    if (opener && link.split(last).length > link.split(opener).length) {
      link = link.slice(0, -1)
      continue
    }
    return link
  }
}

/**
 * Links written in a piece of text, such as "see shopify.com/careers" in an
 * About section, in the order they appear and each once. Every link is an
 * absolute address, with https:// added where the writer left it off. This
 * only reads the text's shape; what each page is, and whose site it is on, is
 * for the reader (the AI) to judge.
 */
export function findLinks(text: string): FoundLink[] {
  const found = new Map<string, FoundLink>()
  for (const match of text.matchAll(LINK_PATTERN)) {
    const written = trimLink(match[0])
    const url = toWebUrl(written)
    if (!url) continue
    const key = normalizeUrlForCompare(url)
    if (found.has(key)) continue
    found.set(key, {
      url,
      homepage: new URL(url).origin,
      explicit: /^(?:https?:\/\/|www\.)/i.test(written) || /[/?#]/.test(written)
    })
  }
  return [...found.values()]
}

/** URLs written in the user's description, e.g. "see acme.com/case-study", as absolute addresses. */
export function extractUrls(textValue: string): string[] {
  return findLinks(textValue).map(link => link.url)
}
