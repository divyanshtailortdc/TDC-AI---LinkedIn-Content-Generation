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

/** URLs written in the user's description, e.g. "see acme.com/case-study". */
export function extractUrls(textValue: string): string[] {
  const matches =
    textValue.match(
      /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s)<>"']*)?/gi
    ) || []
  return matches
    .map(m => m.replace(/[.,;:!?]+$/, ''))
    .filter(
      m => m.includes('/') || /\.(com|io|ai|co|org|net|dev|app)\b/i.test(m)
    )
}
