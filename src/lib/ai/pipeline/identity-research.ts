import { isSiteRoot, normalizeUrlForCompare, toWebUrl } from '@/lib/urls'
import type { SetupSource } from '../skills/profile-setup/prompt'
import {
  canonicalLinkedinUrl,
  hostnameOf,
  type Entity,
  type SearchHit,
  type VerifiedLink
} from '../skills/profile-setup/research'

/**
 * The web research that runs before the AI sees an identity: find the
 * person's or company's real website and LinkedIn page, and read a couple of
 * pages about them.
 *
 * Which search results are theirs is the AI's call (see link-pick.ts): it
 * reads each result's address, title and snippet against the user's own
 * description, so it can tell the main site from a newsroom, a namesake from
 * the right business, and a profile from a directory listing. This only
 * checks that every link it picks was copied from a result, then reads the
 * pages.
 *
 * Search, page fetching and the AI's pick are passed in, so these checks are
 * the same in production and in tests, and nothing here touches the network.
 */

/** What the AI is given to pick from. */
export type LinkPickInput = {
  description: string
  entity: Entity
  /** Each search result once, in the order found. */
  hits: SearchHit[]
  /** False for a link the user already gave. */
  need: { website: boolean; linkedin: boolean }
}

type Pick = { url: string; reason: string; confidence: 'high' | 'medium' }

/** The AI's pick; an empty url means nothing fitted, and reason says why. */
export type LinkPicks = {
  website: Pick
  linkedin: Pick
  background: Array<{ url: string; reason: string }>
}

export type ResearchDeps = {
  /** Web search; returns no hits, rather than throwing, when it fails. */
  search: (query: string) => Promise<SearchHit[]>
  fetchPage: (url: string) => Promise<SetupSource>
  /** The AI's pick of their links from the results; null when it failed. */
  pickLinks: (input: LinkPickInput) => Promise<LinkPicks | null>
  /** False when no search key is set. */
  searchConfigured: boolean
}

export type ResearchResult = {
  /** Pages found by search that were picked as being about this entity and read. */
  sources: SetupSource[]
  verified: { websiteUrl?: VerifiedLink; linkedinUrl?: VerifiedLink }
  /** Things that could not be verified, worded for the person reading them. */
  notes: string[]
}

const MAX_BACKGROUND_PAGES = 2

const sameUrl = (a: string, b: string) =>
  normalizeUrlForCompare(a) === normalizeUrlForCompare(b)

/** Exactly the same host: www.samsung.com is neither samsung.com nor news.samsung.com. */
const sameHost = (a: string, b: string) =>
  new URL(a).hostname.toLowerCase() === new URL(b).hostname.toLowerCase()

/** The AI's own words on a link, shortened for a note. */
const evidenceOf = (reason: string) =>
  reason.trim().slice(0, 300) || 'Picked from the search results.'

export async function researchIdentity(
  input: {
    description: string
    entity: Entity | null
    provided: { linkedinUrl?: string; websiteUrl?: string }
  },
  deps: ResearchDeps
): Promise<ResearchResult> {
  const { description, entity, provided } = input
  const result: ResearchResult = {
    sources: [],
    verified: {},
    notes: []
  }

  if (!deps.searchConfigured) {
    result.notes.push(
      'Web search is not set up (SERPER_API_KEY), so only your details and the links you gave were used.'
    )
    return result
  }
  if (!entity) {
    result.notes.push(
      'Could not tell which person or company to look up, so nothing was searched. Mention the name in your details.'
    )
    return result
  }

  if (entity.kind === 'person' && entity.name.trim().split(/\s+/).length < 2) {
    result.notes.push(
      `Only a first name (${entity.name}) was given, so nothing was searched. Add your full name or your business name.`
    )
    return result
  }

  const needWebsite = !provided.websiteUrl
  const needLinkedin = !provided.linkedinUrl
  const place = entity.location ?? ''
  const linkedinKind = entity.kind === 'company' ? 'company page' : 'profile'

  const searches = await Promise.all([
    needWebsite
      ? deps.search(
          `${entity.name} ${place} official website`.replace(/\s+/g, ' ').trim()
        )
      : Promise.resolve([] as SearchHit[]),
    needLinkedin
      ? deps.search(
          `site:linkedin.com/${entity.kind === 'company' ? 'company' : 'in'} "${entity.name}"`
        )
      : Promise.resolve([] as SearchHit[]),
    deps.search(
      `"${entity.name}" ${entity.hint ?? ''} ${place}`
        .replace(/\s+/g, ' ')
        .trim()
    )
  ])
  const hits = [
    ...new Map(
      searches.flat().map(hit => [normalizeUrlForCompare(hit.url), hit])
    ).values()
  ]

  const picks =
    hits.length > 0
      ? await deps.pickLinks({
          description,
          entity,
          hits,
          need: { website: needWebsite, linkedin: needLinkedin }
        })
      : null
  if (hits.length > 0 && !picks) {
    result.notes.push(
      'Web research could not be completed, so only your details and the links you gave were used.'
    )
    return result
  }

  // Every link must be copied from a result; any other address the AI wrote,
  // an altered domain included, is not used. The website is a homepage: the
  // root of the chosen result's host, exactly as the result writes it
  // ("https://www.samsung.com" for "https://www.samsung.com/us/").
  const fromResults = (url: string) => hits.find(hit => sameUrl(hit.url, url))
  const missed = (pick: Pick | undefined) =>
    pick?.url.trim()
      ? ': the link picked was not among the search results'
      : pick?.reason.trim()
        ? ` (${pick.reason
            .trim()
            .replace(/[.\s]+$/, '')
            .slice(0, 200)})`
        : ''

  // --- LinkedIn: taken from the result itself, since it cannot be read signed out.
  if (needLinkedin) {
    const pick = picks?.linkedin
    const hit = pick?.url.trim() ? fromResults(pick.url) : undefined
    const canonical = hit ? canonicalLinkedinUrl(hit.url) : null
    if (pick && canonical) {
      result.verified.linkedinUrl = {
        url: canonical.url,
        evidence: evidenceOf(pick.reason),
        confidence: pick.confidence
      }
    } else {
      result.notes.push(
        `LinkedIn: no ${linkedinKind} for ${entity.name} was found${missed(pick)}. Paste the URL if you have one.`
      )
    }
  }

  // --- Website.
  let website: string | undefined
  const websitePick = picks?.website
  if (needWebsite && websitePick?.url.trim()) {
    const picked = toWebUrl(websitePick.url)
    const hit = picked
      ? (fromResults(picked) ??
        (isSiteRoot(picked)
          ? hits.find(result => sameHost(result.url, picked))
          : undefined))
      : undefined
    if (hit && !/(^|\.)linkedin\.com$/i.test(new URL(hit.url).hostname)) {
      website = new URL(hit.url).origin
    }
  }

  // --- Background: other sites the AI judged to be about them. Their own
  // site is not background.
  const ownHosts = [website, provided.websiteUrl]
    .map(url => (url ? hostnameOf(toWebUrl(url) ?? url) : null))
    .filter((host): host is string => Boolean(host))
  const background = [
    ...new Map(
      (picks?.background ?? [])
        .map(pick => fromResults(pick.url))
        .filter((hit): hit is SearchHit => Boolean(hit))
        .filter(hit => !ownHosts.includes(hostnameOf(hit.url) ?? ''))
        .map(hit => [normalizeUrlForCompare(hit.url), hit])
    ).values()
  ].slice(0, MAX_BACKGROUND_PAGES)

  const [websitePage, pages] = await Promise.all([
    website ? deps.fetchPage(website) : Promise.resolve(null),
    Promise.all(background.map(hit => deps.fetchPage(hit.url)))
  ])

  if (website && websitePick) {
    // A site that could not be read still counts: the AI judged it from the
    // results, and big sites often turn readers away.
    result.verified.websiteUrl = {
      url: website,
      evidence: evidenceOf(websitePick.reason),
      confidence: websitePick.confidence
    }
    if (websitePick.confidence === 'medium') {
      result.notes.push(
        `Website: ${website} is the likeliest of several matching sites; check that it is the right one.`
      )
    }
  } else if (needWebsite) {
    result.notes.push(
      `Website: no official site for ${entity.name} was found${missed(websitePick)}. Paste it if you have one.`
    )
  }

  // Pages that could not be read give the AI nothing to quote.
  for (const page of [websitePage, ...pages]) {
    if (page?.status.status === 'fetched' && page.content) {
      result.sources.push({ ...page, status: { ...page.status, kind: 'web' } })
    }
  }

  return result
}
