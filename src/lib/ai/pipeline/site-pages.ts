import type { SiteLink } from '@/lib/site-links'
import { normalizeUrlForCompare } from '@/lib/urls'
import type { SetupSource } from '../skills/profile-setup/prompt'

/**
 * Reading more of the business's own site than its homepage. A homepage often
 * names a product only in a menu or a card, and says what it is on the
 * product's own page, sometimes a separate site the business runs. Reading
 * just the homepage left whole products out of the suggested offerings.
 *
 * Which links lead to their offerings is the AI's call (see page-pick.ts),
 * made from the words the site uses for each link and the user's own
 * description. This only checks that every page it picks is one of the site's
 * own links, copied as the site writes it, then reads those pages.
 *
 * Picking and fetching are passed in, so these checks are the same in
 * production and in tests, and nothing here touches the network.
 */

/** What the AI is given to pick from. */
export type SitePagePickInput = {
  description: string
  site: { url: string; title?: string }
  /** The homepage's links, in the order found. */
  links: SiteLink[]
}

export type SitePagePick = { url: string; reason: string }

export type SitePageDeps = {
  /** The AI's pick of pages to read; null when it failed. */
  pickPages: (input: SitePagePickInput) => Promise<SitePagePick[] | null>
  fetchPage: (url: string) => Promise<SetupSource>
}

/** Pages read besides the homepage; each one costs a fetch and prompt space. */
export const MAX_SITE_PAGES = 6
/** The top of a product page says what it is and who it is for. */
const SITE_PAGE_CHARS = 3000

/**
 * The page without the lines it shares with the homepage: the site's header,
 * menus and footer, which the homepage already gave.
 */
function withoutSharedLines(content: string, home: string): string {
  const shared = new Set(
    home
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  )
  return content
    .split('\n')
    .filter(line => !shared.has(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function readSitePages(
  input: { description: string; home: SetupSource },
  deps: SitePageDeps
): Promise<SetupSource[]> {
  const { home } = input
  if (home.status.status !== 'fetched') return []
  const own = normalizeUrlForCompare(home.status.url)
  const links = (home.links ?? []).filter(link => {
    if (normalizeUrlForCompare(link.url) === own) return false
    // LinkedIn cannot be read signed out.
    try {
      return !/(^|\.)linkedin\.com$/i.test(new URL(link.url).hostname)
    } catch {
      return false
    }
  })
  if (links.length === 0) return []

  const picks = await deps.pickPages({
    description: input.description,
    site: { url: home.status.url, title: home.status.title },
    links
  })
  if (!picks) return []

  // Each page is read at the address the site gives, never one the AI wrote.
  const byKey = new Map(
    links.map(link => [normalizeUrlForCompare(link.url), link])
  )
  const chosen = new Map<string, SiteLink>()
  for (const pick of picks) {
    const key = normalizeUrlForCompare(pick.url)
    const link = byKey.get(key)
    if (link && !chosen.has(key)) chosen.set(key, link)
  }

  const pages = await Promise.all(
    [...chosen.values()]
      .slice(0, MAX_SITE_PAGES)
      .map(link => deps.fetchPage(link.url))
  )
  return pages.map(page => {
    const status = { ...page.status, kind: 'site' as const }
    if (status.status !== 'fetched' || !page.content) return { status }
    const content = withoutSharedLines(page.content, home.content ?? '')
    // A link that leads back to the homepage, or to a copy of it, adds nothing.
    return content
      ? { status, content: content.slice(0, SITE_PAGE_CHARS) }
      : {
          status: {
            ...status,
            status: 'unavailable' as const,
            reason: 'The page only repeated the homepage.'
          }
        }
  })
}
