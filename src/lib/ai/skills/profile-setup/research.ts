/**
 * Web research for identity setup, as plain rules with no network access.
 *
 * Search results are untrusted: a company name is rarely unique, and a search
 * engine will happily return a different business, a directory listing or a
 * stale profile. Nothing found online reaches a field unless it passes the
 * checks here, and a check that cannot be answered counts as "not verified".
 */

export type SearchHit = { url: string; title: string; snippet: string }

type EntityKind = 'person' | 'company'

/** Who the analysis should look up. */
export type Entity = {
  name: string
  kind: EntityKind
  location?: string
  /** A few words on what they do, to tell them apart from namesakes. */
  hint?: string
}

export type VerifiedLink = {
  url: string
  /** Why this link is believed to belong to them, in plain words. */
  evidence: string
  confidence: 'high' | 'medium'
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const collapse = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** True when `text` names the entity (all of a person's name parts, or the whole company name). */
export function mentionsEntity(text: string, entityName: string): boolean {
  const name = entityName.trim()
  if (name.length < 2) return false
  const haystack = text.toLowerCase()
  if (haystack.includes(name.toLowerCase())) return true
  // "Priya  Rao" or "Rao, Priya": every part present, for short personal names.
  const parts = name
    .toLowerCase()
    .split(/\s+/)
    .filter(part => part.length > 1)
  if (parts.length >= 2 && parts.length <= 3) {
    return parts.every(part =>
      new RegExp(`\\b${escapeRegExp(part)}\\b`).test(haystack)
    )
  }
  // "Ledger-ly" and "Ledgerly" are the same name.
  return (
    collapse(haystack).includes(collapse(name)) && collapse(name).length >= 4
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const STOPWORDS = new Set(
  (
    'about above after again also always among another around because before being between both could ' +
    'doing during every first found from have having help helps helping into itself just like make makes ' +
    'many more most much never only other over people really since some such than that their them then ' +
    'there these they this those through under until very want what when where which while with within ' +
    'without would your yours their company business service services brand brands founder working work ' +
    'worked build building built based offer offers offering provide provides providing love write writing ' +
    'linkedin should being want wants need needs'
  ).split(' ')
)

/** Distinctive words from the user's description, used to tell namesakes apart. */
function descriptionKeywords(description: string): string[] {
  const words = description.toLowerCase().match(/[a-z][a-z0-9&-]{4,}/g) ?? []
  return Array.from(new Set(words.filter(word => !STOPWORDS.has(word)))).slice(
    0,
    60
  )
}

const NOT_A_MARKET_TERM = new Set([
  'linkedin',
  'google',
  'facebook',
  'twitter',
  'instagram',
  'youtube'
])

/**
 * Proper nouns the description uses to place the business: a country, a city,
 * a product or a market such as "D2C". A namesake in the same trade usually
 * differs here, so a page about the right business should share at least one.
 * The entity's own name and the writer's personal name are left out; those
 * say who they are, not where or what.
 */
export function marketTerms(description: string, entity: Entity): string[] {
  const exclude = new Set(
    entity.name.toLowerCase().split(/\s+/).filter(Boolean)
  )
  const personal = new RegExp(
    `\\b(?:I(?:'m|\\s+am)|My name is|This is)\\s+(${NAME})`
  ).exec(description)
  for (const part of personal?.[1]?.toLowerCase().split(/\s+/) ?? [])
    exclude.add(part)

  const terms = new Set<string>()
  for (const sentence of description.split(/(?<=[.!?])\s+/)) {
    // The first word of a sentence is capitalized anyway, so it says nothing.
    const words = sentence.split(/\s+/).slice(1)
    for (const raw of words) {
      const word = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
      if (!/^[A-Z]/.test(word)) continue
      const lower = word.toLowerCase()
      if (exclude.has(lower) || NOT_A_MARKET_TERM.has(lower)) continue
      // "Cr" and "Mr" are not places or markets; "D2C" and "India" are.
      if (word.length < 4 && !/\d/.test(word)) continue
      terms.add(word)
    }
  }
  return Array.from(terms).slice(0, 12)
}

/**
 * Does a page look like it is about *this* entity rather than a namesake?
 * It must name the entity, share distinctive terms with the description, and
 * (when the description names a place or market) mention at least one of
 * them. Returns how many terms matched, or null when the page does not qualify.
 */
export function pageMatchStrength(
  content: string,
  entity: Entity,
  description: string
): number | null {
  if (!mentionsEntity(content, entity.name)) return null
  const lower = content.toLowerCase()

  const market = marketTerms(description, entity)
  if (
    market.length > 0 &&
    !market.some(term => lower.includes(term.toLowerCase()))
  ) {
    return null
  }

  const keywords = descriptionKeywords(description).filter(
    word => !collapse(entity.name).includes(collapse(word))
  )
  if (keywords.length === 0) return 0
  const matched = keywords.filter(word => lower.includes(word)).length
  // A short description gives little to compare, so ask for less.
  const required = Math.min(2, keywords.length)
  return matched >= required ? matched : null
}

// ---------------------------------------------------------------------------
// Which links to trust
// ---------------------------------------------------------------------------

const NOT_AN_OFFICIAL_SITE = [
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'pinterest.com',
  'reddit.com',
  'quora.com',
  'medium.com',
  'wikipedia.org',
  'wikidata.org',
  'crunchbase.com',
  'zoominfo.com',
  'apollo.io',
  'rocketreach.co',
  'signalhire.com',
  'dnb.com',
  'glassdoor.com',
  'glassdoor.co.in',
  'indeed.com',
  'naukri.com',
  'ambitionbox.com',
  'yelp.com',
  'g2.com',
  'capterra.com',
  'trustpilot.com',
  'clutch.co',
  'justdial.com',
  'indiamart.com',
  'tofler.in',
  'zaubacorp.com',
  'bloomberg.com',
  'github.com',
  'play.google.com',
  'apps.apple.com'
]

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const hostMatches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

/** The registrable part of a host's name, e.g. "ledgerly" from "app.ledgerly.co.in". */
function domainLabel(host: string): string {
  const parts = host.split('.')
  const second = parts[parts.length - 2] ?? ''
  const isSecondLevelTld = ['co', 'com', 'org', 'net', 'gov', 'ac'].includes(
    second
  )
  return (isSecondLevelTld ? parts[parts.length - 3] : second) ?? ''
}

export type LinkedinPick = { link?: VerifiedLink; ambiguous: boolean }

/** Canonical form of a LinkedIn profile or company URL, or null if it is neither. */
export function canonicalLinkedinUrl(
  url: string
): { url: string; type: 'company' | 'person'; slug: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!hostMatches(parsed.hostname.toLowerCase(), 'linkedin.com')) return null
  const match = /^\/(company|in|school)\/([^/?#]+)/i.exec(parsed.pathname)
  if (!match) return null
  const type = match[1]!.toLowerCase() === 'in' ? 'person' : 'company'
  const slug = decodeURIComponent(match[2]!).toLowerCase()
  const section = type === 'person' ? 'in' : match[1]!.toLowerCase()
  return { url: `https://www.linkedin.com/${section}/${slug}`, type, slug }
}

/**
 * The LinkedIn page for the entity, taken from search results. LinkedIn cannot
 * be read when signed out, so the evidence is the result's own title and
 * snippet: both must name the entity, and the page type must fit (a company
 * page for a company, a profile for a person).
 */
export function pickLinkedin(hits: SearchHit[], entity: Entity): LinkedinPick {
  const wantedType = entity.kind === 'company' ? 'company' : 'person'
  const candidates = new Map<
    string,
    { hit: SearchHit; titleLeads: boolean; url: string }
  >()

  for (const hit of hits) {
    const canonical = canonicalLinkedinUrl(hit.url)
    if (!canonical || canonical.type !== wantedType) continue
    const title = hit.title.replace(/\s*[|\-–]\s*LinkedIn.*$/i, '').trim()
    const named =
      mentionsEntity(title, entity.name) ||
      mentionsEntity(hit.snippet, entity.name)
    if (!named) continue
    // "Priya Rao - Founder - Ledgerly" and "Ledgerly" begin with the name.
    const titleLeads = title.toLowerCase().startsWith(entity.name.toLowerCase())
    const existing = candidates.get(canonical.url)
    if (!existing || (titleLeads && !existing.titleLeads)) {
      candidates.set(canonical.url, { hit, titleLeads, url: canonical.url })
    }
  }

  const found = [...candidates.values()]
  if (found.length === 0) return { ambiguous: false }

  const leading = found.filter(c => c.titleLeads)
  const best =
    leading.length === 1
      ? leading[0]
      : found.length === 1
        ? found[0]
        : undefined
  if (!best) return { ambiguous: true }

  return {
    ambiguous: false,
    link: {
      url: best.url,
      evidence: `Search result "${best.hit.title.trim()}" names ${entity.name}.`,
      confidence: 'medium'
    }
  }
}

export type WebsiteCandidate = { url: string; score: number; title: string }

/**
 * Plausible official sites from search results, best first. Social networks,
 * directories and review sites are never an official site. A host qualifies
 * only if its name or the result title carries the entity's name.
 */
export function pickWebsiteCandidates(
  hits: SearchHit[],
  entity: Entity
): { candidates: WebsiteCandidate[]; ambiguous: boolean } {
  const byHost = new Map<string, WebsiteCandidate>()
  const wanted = collapse(entity.name)

  for (const hit of hits) {
    const host = hostOf(hit.url)
    if (!host) continue
    if (NOT_AN_OFFICIAL_SITE.some(domain => hostMatches(host, domain))) continue

    const label = collapse(domainLabel(host))
    const domainMatches =
      wanted.length >= 3 &&
      (label === wanted ||
        label.includes(wanted) ||
        (label.length >= 4 && wanted.includes(label)))
    const titleMatches = mentionsEntity(hit.title, entity.name)
    if (!domainMatches && !titleMatches) continue

    const score =
      (domainMatches ? 3 : 0) +
      (titleMatches ? 2 : 0) +
      (mentionsEntity(hit.snippet, entity.name) ? 1 : 0)
    const origin = `https://${host}/`
    const existing = byHost.get(host)
    if (!existing || score > existing.score) {
      byHost.set(host, { url: origin, score, title: hit.title })
    }
  }

  const candidates = [...byHost.values()].sort((a, b) => b.score - a.score)
  // Two different sites that fit equally well: do not guess.
  const ambiguous =
    candidates.length > 1 &&
    candidates[0]!.score === candidates[1]!.score &&
    candidates[0]!.score >= 3
  return { candidates, ambiguous }
}

/** Pages worth reading for background: not social or directory sites, not the site itself. */
export function pickBackgroundPages(
  hits: SearchHit[],
  entity: Entity,
  excludeHosts: string[]
): SearchHit[] {
  const seen = new Set(excludeHosts)
  const picked: SearchHit[] = []
  for (const hit of hits) {
    const host = hostOf(hit.url)
    if (!host || seen.has(host)) continue
    if (NOT_AN_OFFICIAL_SITE.some(domain => hostMatches(host, domain))) continue
    if (!mentionsEntity(`${hit.title} ${hit.snippet}`, entity.name)) continue
    seen.add(host)
    picked.push(hit)
  }
  return picked
}

export const hostnameOf = hostOf

// ---------------------------------------------------------------------------
// Finding the entity without a model, as a fallback
// ---------------------------------------------------------------------------

const NAME = "[A-Z][\\w&'.-]*(?:\\s+[A-Z][\\w&'.-]*){0,3}"

/** A guess at the entity, and whether the phrasing leaves little doubt. */
export type EntityGuess = Entity & { confident: boolean }

/**
 * A best guess from phrases like "I'm Priya Rao, founder of Ledgerly". It is
 * confident for "founder of X", "X is a ..." and a full personal name; a lone
 * capitalized word after "I'm" (as in "I'm Passionate about...") is not.
 */
export function guessEntity(
  description: string,
  accountType?: 'personal' | 'company'
): EntityGuess | null {
  const company = new RegExp(
    `\\b(?:founder|co-?founder|ceo|owner|director|head)\\s+(?:and\\s+\\w+\\s+)?(?:of|at)\\s+(${NAME})`
  ).exec(description)
  const personal = new RegExp(
    `\\b(?:I(?:'m|\\s+am)|My name is|This is)\\s+(${NAME})`
  ).exec(description)
  const brand = new RegExp(`\\b(${NAME})\\s+is\\s+(?:a|an)\\s`).exec(
    description
  )

  const asCompany = (match: RegExpExecArray): EntityGuess => ({
    name: clean(match[1]!),
    kind: 'company',
    confident: true
  })
  const asPerson = (match: RegExpExecArray): EntityGuess => {
    const name = clean(match[1]!)
    return { name, kind: 'person', confident: name.split(/\s+/).length >= 2 }
  }

  if (accountType === 'personal' && personal) return asPerson(personal)
  if (accountType === 'company') {
    const match = company ?? brand
    if (match) return asCompany(match)
  }
  if (company) return asCompany(company)
  if (personal) return asPerson(personal)
  if (brand) return asCompany(brand)
  return null
}

const clean = (value: string) => value.replace(/[.,;:]+$/, '').trim()

// ---------------------------------------------------------------------------
// Numbers: nothing may be stated that was not in the input
// ---------------------------------------------------------------------------

/** Numbers as written (not inside words like "B2B" or "Web3"): "40", "2021", "1,200". */
function numbersIn(text: string): string[] {
  return (text.match(/(?<![A-Za-z0-9])\d[\d,]*(?:\.\d+)?/g) ?? []).map(n =>
    n.replace(/,/g, '').replace(/\.0+$/, '')
  )
}

/**
 * Builds a checker for one body of trusted text. Figures in a piece of text
 * that appear nowhere in that body are returned. Single digits are ignored
 * (they count things like "3 steps"), but a percentage must always be backed
 * by a percentage. Anything else (years, client counts, revenue, headcount)
 * has to come from the user's words or a page that was read.
 *
 * The trusted text is scanned once, so checking many sentences stays cheap.
 */
export function figureChecker(corpus: string): (text: string) => string[] {
  const known = new Set(numbersIn(corpus))
  // "5%" is only backed by a percentage, not by "5 days".
  const knownPercents = new Set(
    Array.from(
      corpus.matchAll(/(?<![A-Za-z0-9])(\d[\d,]*(?:\.\d+)?)\s?%/g),
      m => m[1]!.replace(/,/g, '').replace(/\.0+$/, '')
    )
  )
  const pattern = /(?<![A-Za-z0-9])\d[\d,]*(?:\.\d+)?(%?)/g

  return text => {
    const missing: string[] = []
    for (const match of text.matchAll(pattern)) {
      const value = match[0]
        .replace(/%$/, '')
        .replace(/,/g, '')
        .replace(/\.0+$/, '')
      const isPercent = match[1] === '%'
      if (!isPercent && Number(value) < 10) continue
      if (!(isPercent ? knownPercents : known).has(value))
        missing.push(match[0])
    }
    return Array.from(new Set(missing))
  }
}

/** One-off form of {@link figureChecker}. */
export function ungroundedNumbers(text: string, corpus: string): string[] {
  return figureChecker(corpus)(text)
}

/** Splits prose into sentences for removing only the ones that cannot be backed. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
}
