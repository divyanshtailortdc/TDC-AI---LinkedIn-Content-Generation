/**
 * URL helpers for comparing links people typed with links found elsewhere.
 * Client-safe: no network access.
 */

/** Lowercase host, no scheme, no "www.", no trailing slash. */
export function normalizeUrlForCompare(raw: string): string {
  const trimmed = raw.trim()
  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    )
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
