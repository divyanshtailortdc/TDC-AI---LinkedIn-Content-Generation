import type { SetupSource } from '../skills/profile-setup/prompt'
import {
  hostnameOf,
  pageMatchStrength,
  pickBackgroundPages,
  pickLinkedin,
  pickWebsiteCandidates,
  type Entity,
  type SearchHit,
  type VerifiedLink
} from '../skills/profile-setup/research'

/**
 * The web research that runs before the AI sees an identity: find the
 * person's or company's real website and LinkedIn page, and read a couple of
 * pages about them.
 *
 * Search and page fetching are passed in, so the rules (which results count,
 * what gets verified, what is reported as not found) are the same in
 * production and in tests, and nothing here touches the network itself.
 */

export type ResearchDeps = {
  /** Web search; returns no hits, rather than throwing, when it fails. */
  search: (query: string) => Promise<SearchHit[]>
  fetchPage: (url: string) => Promise<SetupSource>
  /** False when no search key is set. */
  searchConfigured: boolean
}

export type ResearchResult = {
  /** Pages found by search that were read and checked to be about this entity. */
  sources: SetupSource[]
  verified: { websiteUrl?: VerifiedLink; linkedinUrl?: VerifiedLink }
  /** Things that could not be verified, worded for the person reading them. */
  notes: string[]
}

const MAX_BACKGROUND_PAGES = 2
const MAX_WEBSITE_CHECKS = 2

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

  const [websiteHits, linkedinHits, backgroundHits] = await Promise.all([
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

  // --- LinkedIn: taken from the result itself, since it cannot be read signed out.
  if (needLinkedin) {
    const pick = pickLinkedin(
      [...linkedinHits, ...websiteHits, ...backgroundHits],
      entity
    )
    if (pick.link) {
      result.verified.linkedinUrl = pick.link
    } else {
      result.notes.push(
        pick.ambiguous
          ? `LinkedIn: several pages could be ${entity.name}, so none was chosen. Paste the right LinkedIn URL.`
          : `LinkedIn: no ${entity.kind === 'company' ? 'company page' : 'profile'} for ${entity.name} could be verified. Paste the URL if you have one.`
      )
    }
  }

  // --- Website and background pages are read at the same time. A candidate
  // site counts only after its page is read and checked.
  const excludeHosts: string[] = []
  const providedHost = provided.websiteUrl
    ? hostnameOf(withScheme(provided.websiteUrl))
    : null
  if (providedHost) excludeHosts.push(providedHost)

  const { candidates, ambiguous } = needWebsite
    ? pickWebsiteCandidates([...websiteHits, ...backgroundHits], entity)
    : { candidates: [], ambiguous: false }
  const toCheck = candidates.slice(0, MAX_WEBSITE_CHECKS)
  // Background pages never repeat a site that is being checked as the website.
  const checkedHosts = toCheck
    .map(c => hostnameOf(c.url))
    .filter(Boolean) as string[]
  const background = pickBackgroundPages(
    [...backgroundHits, ...websiteHits],
    entity,
    [...excludeHosts, ...checkedHosts]
  ).slice(0, MAX_BACKGROUND_PAGES)

  const [checked, pages] = await Promise.all([
    Promise.all(
      toCheck.map(async candidate => {
        const source = await deps.fetchPage(candidate.url)
        const strength =
          source.status.status === 'fetched' && source.content
            ? pageMatchStrength(source.content, entity, description)
            : null
        return { candidate, source, strength }
      })
    ),
    Promise.all(
      background.map(async hit => {
        const source = await deps.fetchPage(hit.url)
        const qualifies =
          source.status.status === 'fetched' &&
          Boolean(source.content) &&
          pageMatchStrength(source.content!, entity, description) !== null
        return qualifies ? source : null
      })
    )
  ])

  if (needWebsite) {
    // Candidates are in search-rank order, so ties go to the site search
    // engines rank first. Only sites whose page was read and matched count.
    const verifiedSites = checked.filter(entry => entry.strength !== null)
    const winner = verifiedSites[0]
    if (winner) {
      const strength = winner.strength ?? 0
      const alsoMatched = verifiedSites.length > 1 || ambiguous
      result.verified.websiteUrl = {
        url: winner.candidate.url,
        evidence:
          strength > 0
            ? `The page names ${entity.name} and mentions ${strength} terms from your details.`
            : `The page names ${entity.name}.`,
        // Several sites fit, so this is the likeliest rather than the only one.
        confidence: strength >= 3 && !alsoMatched ? 'high' : 'medium'
      }
      if (verifiedSites.length > 1) {
        result.notes.push(
          `Website: ${winner.candidate.url} was chosen from several matching sites; check that it is the right one.`
        )
      }
      result.sources.push({
        ...winner.source,
        status: { ...winner.source.status, kind: 'web' }
      })
    } else {
      result.notes.push(
        ambiguous
          ? `Website: several sites could belong to ${entity.name} and none could be verified. Paste your website URL.`
          : `Website: no official site for ${entity.name} could be verified. Paste it if you have one.`
      )
    }
  }

  for (const page of pages) {
    if (page)
      result.sources.push({ ...page, status: { ...page.status, kind: 'web' } })
  }

  return result
}

function withScheme(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}
