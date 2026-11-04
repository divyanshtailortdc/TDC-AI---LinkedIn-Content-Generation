import 'server-only'

import { safeFetch } from '../safe-url'
import { BROWSER_HEADERS } from '../scraper'
import { EXTRACTION_SETTINGS } from './settings'

/**
 * Where a newsletter link leads. Click trackers (Substack, beehiiv,
 * Mailchimp…) redirect, often over several hops, before the article: each hop
 * is followed with GET, as a browser would, and checked (safeFetch). The page
 * itself is not downloaded. Null when the link cannot be followed.
 *
 * Only for links that passed isFollowableLink: unsubscribe, confirm and
 * account links are never followed, as a GET on some of them acts.
 */
export async function resolveLink(raw: string): Promise<string | null> {
  try {
    const response = await safeFetch(
      raw,
      {
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(EXTRACTION_SETTINGS.requestTimeoutMs)
      },
      EXTRACTION_SETTINGS.maxRedirects
    )
    await response.body?.cancel()
    return response.url || null
  } catch {
    return null
  }
}
