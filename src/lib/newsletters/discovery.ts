import 'server-only'

import { db } from '@/db'
import { newslettersTable } from '@/db/schema'
import { loadGenerationContext } from '@/lib/ai/context'
import { interleave } from '@/lib/ai/pipeline/grounding-corpus'
import { inferRegion } from '@/lib/ai/region'
import {
  classifyNewsletters,
  planNewsletterSearches,
  type ClassifiedNewsletter,
  type VerifiedCandidate
} from '@/lib/ai/skills/newsletter-discovery'
import { newsletterIdentityKey } from '@/lib/ai/skills/newsletter-discovery/guard'
import {
  isWebSearchConfigured,
  mapConcurrently,
  searchWeb,
  type Finding
} from '@/lib/research/web-search'
import { safeFetch } from '@/lib/safe-url'
import { BROWSER_HEADERS } from '@/lib/scraper'
import { eq, sql } from 'drizzle-orm'
import {
  analyzePage,
  isExcludedHost,
  isNewsletterPath,
  isNewsletterPlatform,
  signupUrlKey,
  websiteOf,
  type FeedLink,
  type PageAnalysis
} from './candidates'

/**
 * Newsletter discovery for one identity: the model plans searches from the
 * profile, Serper runs them, each result's page is fetched to find where to
 * subscribe, the model judges and scores what was found, and the result is
 * saved. Subscribing is left to the user, on the publisher's page.
 */

/** A problem the user can act on; its message is safe to show as is. */
export class NewsletterDiscoveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewsletterDiscoveryError'
  }
}

export type DiscoverySummary = {
  /** Pages fetched and checked for a way to subscribe. */
  checked: number
  found: number
  added: number
  updated: number
}

const RESULTS_PER_QUERY = 10
const MAX_PER_HOST = 2
/** Pages fetched per discovery; each can take up to PAGE_TIMEOUT_MS. */
const MAX_CANDIDATES = 24
/** What the classifier is shown at once; keeps its answer inside the timeout. */
const MAX_CLASSIFIED = 18
const SEARCH_CONCURRENCY = 4
const FETCH_CONCURRENCY = 6
const PAGE_TIMEOUT_MS = 8_000
const FEED_TIMEOUT_MS = 5_000
const MAX_HTML_CHARS = 1_500_000

/** Search results worth fetching: one per page, a couple per site, each query in turn. */
function pickCandidates(perQuery: Finding[][]): string[] {
  const seen = new Set<string>()
  const perHost = new Map<string, number>()
  const urls: string[] = []
  for (const finding of interleave(perQuery)) {
    if (isExcludedHost(finding.url)) continue
    const key = signupUrlKey(finding.url)
    if (seen.has(key)) continue
    let host: string
    try {
      host = new URL(finding.url).hostname
    } catch {
      continue
    }
    const count = perHost.get(host) ?? 0
    if (count >= MAX_PER_HOST) continue
    seen.add(key)
    perHost.set(host, count + 1)
    urls.push(finding.url)
    if (urls.length >= MAX_CANDIDATES) break
  }
  return urls
}

/**
 * A page's HTML and where it ended up, or null when it is unreachable, not
 * HTML, or turns the request away. Every hop is checked by safeFetch, so a
 * search result cannot point the server at its own network.
 */
async function fetchHtml(
  url: string
): Promise<{ html: string; url: string } | null> {
  try {
    const response = await safeFetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
    })
    if (
      !response.ok ||
      !/html/i.test(response.headers.get('content-type') ?? '')
    ) {
      await response.body?.cancel()
      return null
    }
    const html = (await response.text()).slice(0, MAX_HTML_CHARS)
    return { html, url: response.url || url }
  } catch {
    return null
  }
}

function evidenceOf(
  page: PageAnalysis,
  url: string
): VerifiedCandidate['signupEvidence'] | null {
  if (page.hasSignupForm) return 'form'
  if (isNewsletterPlatform(url)) return 'platform'
  if (page.mentionsNewsletter && isNewsletterPath(url)) return 'page'
  return null
}

/**
 * Where this search result's newsletter is subscribed to. A page that is not
 * itself a signup page (an article with a form in its footer, a homepage) is
 * passed over for a subscribe link on it, when one leads to a form.
 */
async function inspectCandidate(
  url: string
): Promise<VerifiedCandidate | null> {
  const first = await fetchHtml(url)
  if (!first) return null
  const page = analyzePage(first.html, first.url)
  let chosen = { url: first.url, page, evidence: evidenceOf(page, first.url) }

  const dedicated =
    isNewsletterPlatform(first.url) || isNewsletterPath(first.url)
  if (!dedicated || !chosen.evidence) {
    for (const link of page.subscribeLinks.slice(0, 2)) {
      const next = await fetchHtml(link)
      if (!next) continue
      const linked = analyzePage(next.html, next.url)
      const evidence = evidenceOf(linked, next.url)
      if (evidence) {
        chosen = { url: next.url, page: linked, evidence }
        break
      }
    }
  }
  if (!chosen.evidence) return null

  const feeds: FeedLink[] = [...chosen.page.feeds, ...page.feeds]
  return {
    signupUrl: chosen.url,
    websiteUrl: websiteOf(chosen.url),
    title: chosen.page.title || page.title,
    siteName: chosen.page.siteName ?? page.siteName,
    description: chosen.page.description || page.description,
    excerpt: chosen.page.excerpt || page.excerpt,
    signupEvidence: chosen.evidence,
    feed: feeds[0] ?? null
  }
}

/** The feed is kept only when it answers with RSS or Atom. Not read beyond that. */
async function verifyFeed(feed: FeedLink | null): Promise<FeedLink | null> {
  if (!feed) return null
  try {
    const response = await safeFetch(feed.url, {
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
    })
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    const head = (await response.text()).slice(0, 2000)
    if (/<feed[\s>]/i.test(head)) return { url: feed.url, type: 'atom' }
    if (/<rss[\s>]|<rdf:RDF/i.test(head)) return { url: feed.url, type: 'rss' }
    return null
  } catch {
    return null
  }
}

/**
 * Upserts by signup page, so discovering again refreshes a newsletter's
 * details and score but never its status. A newsletter already saved under
 * another signup URL (same name on the same site) is not added twice.
 */
async function saveNewsletters(
  accountId: string,
  userId: string,
  newsletters: ClassifiedNewsletter[]
): Promise<{ added: number; updated: number }> {
  const existing = await db
    .select({
      name: newslettersTable.name,
      websiteUrl: newslettersTable.websiteUrl,
      signupUrlKey: newslettersTable.signupUrlKey
    })
    .from(newslettersTable)
    .where(eq(newslettersTable.accountId, accountId))
  const savedKeys = new Set(existing.map(row => row.signupUrlKey))
  const savedNames = new Set(existing.map(newsletterIdentityKey))
  const fresh = newsletters.filter(
    n =>
      savedKeys.has(n.signupUrlKey) || !savedNames.has(newsletterIdentityKey(n))
  )
  if (fresh.length === 0) return { added: 0, updated: 0 }

  const now = new Date()
  const rows = await db
    .insert(newslettersTable)
    .values(
      fresh.map(n => ({
        accountId,
        discoveredByUserId: userId,
        name: n.name,
        publisher: n.publisher,
        description: n.description,
        category: n.category,
        topics: n.topics,
        relevanceScore: n.relevanceScore,
        relevanceReason: n.reason || null,
        websiteUrl: n.websiteUrl,
        signupUrl: n.signupUrl,
        signupUrlKey: n.signupUrlKey,
        feedUrl: n.feed?.url ?? null,
        feedType: n.feed?.type ?? null,
        discoveredAt: now,
        lastDiscoveredAt: now
      }))
    )
    .onConflictDoUpdate({
      target: [newslettersTable.accountId, newslettersTable.signupUrlKey],
      set: {
        discoveredByUserId: sql`excluded.discovered_by_user_id`,
        name: sql`excluded.name`,
        publisher: sql`excluded.publisher`,
        description: sql`excluded.description`,
        category: sql`excluded.category`,
        topics: sql`excluded.topics`,
        relevanceScore: sql`excluded.relevance_score`,
        relevanceReason: sql`excluded.relevance_reason`,
        websiteUrl: sql`excluded.website_url`,
        signupUrl: sql`excluded.signup_url`,
        // A feed found once stays when a later visit misses it.
        feedUrl: sql`coalesce(excluded.feed_url, ${newslettersTable.feedUrl})`,
        feedType: sql`coalesce(excluded.feed_type, ${newslettersTable.feedType})`,
        lastDiscoveredAt: now,
        updatedAt: now
      }
    })
    // xmax is 0 only on a row this statement inserted.
    .returning({ inserted: sql<boolean>`(xmax = 0)` })

  const added = rows.filter(row => row.inserted).length
  return { added, updated: rows.length - added }
}

/** Has the profile anything to match newsletters against beyond a name? */
function hasProfileSubstance(
  ctx: Awaited<ReturnType<typeof loadGenerationContext>>
): boolean {
  return Boolean(
    ctx.account.industry?.trim() ||
    ctx.account.bio?.trim() ||
    ctx.offerings.length > 0 ||
    ctx.audiences.length > 0
  )
}

export async function discoverNewsletters(input: {
  accountId: string
  userId: string
}): Promise<DiscoverySummary> {
  if (!isWebSearchConfigured) {
    throw new NewsletterDiscoveryError(
      'Web search is not configured. Set SERPER_API_KEY to discover newsletters.'
    )
  }
  const startedAt = Date.now()
  const ctx = await loadGenerationContext(input.accountId)
  if (!hasProfileSubstance(ctx)) {
    throw new NewsletterDiscoveryError(
      'Add your industry, offerings or audience to your identity first, so discovery knows what to look for.'
    )
  }

  const region = inferRegion(ctx)
  const queries = await planNewsletterSearches(ctx, region?.name)
  if (queries.length === 0) {
    throw new NewsletterDiscoveryError(
      'No searches could be planned from your profile. Please try again.'
    )
  }

  const perQuery = await mapConcurrently(queries, SEARCH_CONCURRENCY, query =>
    searchWeb(query, {
      // Newsletters run for years; an old signup page is still the signup page.
      freshnessDays: 0,
      resultCount: RESULTS_PER_QUERY,
      country: region?.code
    })
  )
  const urls = pickCandidates(perQuery)
  if (urls.length === 0) {
    throw new NewsletterDiscoveryError(
      'The web search returned nothing to check. Please try again shortly.'
    )
  }

  const inspected = await mapConcurrently(
    urls,
    FETCH_CONCURRENCY,
    inspectCandidate
  )
  // Two results can lead to the same signup page.
  const seen = new Set<string>()
  const candidates = inspected.filter((c): c is VerifiedCandidate => {
    if (!c) return false
    const key = signupUrlKey(c.signupUrl)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const classified = await classifyNewsletters(
    ctx,
    candidates.slice(0, MAX_CLASSIFIED)
  )
  const feeds = await mapConcurrently(classified, FETCH_CONCURRENCY, n =>
    verifyFeed(n.feed)
  )
  const newsletters = classified.map((n, i) => ({
    ...n,
    feed: feeds[i] ?? null
  }))

  const { added, updated } = await saveNewsletters(
    input.accountId,
    input.userId,
    newsletters
  )

  console.info(
    `Newsletter discovery for ${input.accountId}: ${queries.length} searches, ${urls.length} pages, ${candidates.length} with signup, ${newsletters.length} kept (${added} new) in ${Date.now() - startedAt}ms`
  )
  return { checked: urls.length, found: newsletters.length, added, updated }
}
