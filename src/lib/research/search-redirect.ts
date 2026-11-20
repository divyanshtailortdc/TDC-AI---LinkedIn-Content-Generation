/**
 * Google (through Serper) returns some results as a redirect through
 * google.com/goto?url=<opaque token> instead of the result's own address.
 * Seen 2026-11-20 for Instagram: 7 of 10 results of a site:instagram.com
 * search, so profile insights found 1 post of an account with 3,000.
 *
 * The token cannot be decoded, and Google answers all but the first of a
 * burst of requests for these links with a bot check, so they are not
 * resolved. Research leaves them out: a google.com link says nothing about
 * where a fact came from. Profile insights keeps them, since an Instagram
 * result's title and snippet hold the caption and who posted it.
 */
export function isSearchRedirect(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      /^(?:www\.)?google\.com$/i.test(url.hostname) &&
      url.pathname === '/goto' &&
      url.searchParams.has('url')
    )
  } catch {
    return false
  }
}
