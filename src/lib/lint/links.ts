/**
 * Links in a post's text, and whether each is one the post was given. A link
 * nobody gave the writer was invented, or planted in a source it read.
 */

/**
 * Endings of the bare domains looked for without "http" or "www." in front,
 * and only with a path after them ("acme.com/offer"): a domain alone is as
 * often a brand's name ("Booking.com"), and "Node.js/Deno" is not a link.
 */
const BARE_TLDS =
  'com|net|org|io|ai|co|app|dev|in|uk|us|eu|de|fr|au|ca|xyz|info|biz|me|ly|link|site|online|shop|store|tech|gg|tv|so|to|news|blog|page|gov|edu'

const LINK_PATTERN = new RegExp(
  [
    String.raw`(?:https?:\/\/|www\.)[^\s<>"'“”]+`,
    // Not part of an email address or a longer word.
    String.raw`(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:${BARE_TLDS})\/[^\s<>"'“”]*`
  ].join('|'),
  'gi'
)

/** Punctuation that ends the sentence around a link, not the link itself. */
const TRAILING = /[.,;:!?…)\]}'"’”]+$/

/** The links written in a text, as written, without the sentence's punctuation. */
export function findLinks(text: string): string[] {
  return Array.from(
    new Set((text.match(LINK_PATTERN) || []).map(l => l.replace(TRAILING, '')))
  ).filter(Boolean)
}

/**
 * A link reduced to what decides where it goes: no scheme, "www.", query,
 * fragment or trailing slash, in lower case.
 */
function normalizeLink(link: string): string {
  return link
    .trim()
    .replace(TRAILING, '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

/**
 * The links in `text` that are not among `allowed`. A link counts as given
 * when it goes to the same page as an allowed one (tracking parameters
 * aside), or to the home page of an allowed link's site; a made-up page on
 * a known site does not.
 */
export function unknownLinks(text: string, allowed: string[]): string[] {
  const pages = new Set(allowed.map(normalizeLink).filter(Boolean))
  const sites = new Set(Array.from(pages, p => p.split('/')[0]!))
  return findLinks(text).filter(link => {
    const page = normalizeLink(link)
    if (!page || pages.has(page)) return false
    return page.includes('/') || !sites.has(page)
  })
}
