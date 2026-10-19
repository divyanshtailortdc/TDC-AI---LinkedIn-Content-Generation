/**
 * Pure helpers for Account Setup's web research: the shapes it works with,
 * LinkedIn URL forms, a fallback guess at who to look up, and the figures
 * check. No network access.
 *
 * Which search results belong to the person or business is not decided here:
 * the AI judges that from context (see link-pick.ts), and research only checks
 * that every link it picks was copied from a result (see identity-research.ts).
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
// Links
// ---------------------------------------------------------------------------

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

const hostMatches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`)

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

export const hostnameOf = hostOf

// ---------------------------------------------------------------------------
// Finding the entity without a model, as a fallback
// ---------------------------------------------------------------------------

// "&" may join parts, as in "Crumb & Co.".
const NAME = "[A-Z][\\w&'.-]*(?:\\s+(?:&\\s+)?[A-Z][\\w&'.-]*){0,3}"

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

/** A period after these is part of the name, not the end of a sentence. */
const ABBREVIATION =
  /^(?:dr|mr|mrs|ms|mx|prof|st|jr|sr|co|inc|ltd|llc|corp)\.$/i

/** "Sam. I want" names Sam; "Dr. Maya Okafor" and "Crumb & Co." stay whole. */
function clean(value: string): string {
  const parts = value.trim().split(/\s+/)
  const end = parts.findIndex(
    (part, index) =>
      index < parts.length - 1 && part.endsWith('.') && !ABBREVIATION.test(part)
  )
  return (end === -1 ? parts : parts.slice(0, end + 1))
    .join(' ')
    .replace(/[.,;:]+$/, '')
    .trim()
}

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
