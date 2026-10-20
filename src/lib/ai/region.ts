import type { GenerationContext } from './context-blocks'

/**
 * Where an account's readers are, so research searches that market and ideas
 * do not carry another market's launches, prices or rules to them.
 *
 * Read from what the account says about its readers (the audience, then the
 * goal), then from a regional website ("samsung.com/in/", "example.co.uk").
 * The bio is left out: it usually says where a company comes from, which is
 * not where its readers are ("a South Korean multinational").
 */

export interface Region {
  /** ISO 3166 alpha-2, lowercase, as Serper's `gl` takes it. Absent when several markets are named. */
  code?: string
  name: string
}

const COUNTRIES: Array<{ code: string; name: string; pattern: RegExp }> = [
  { code: 'in', name: 'India', pattern: /\bIndia(?:n|ns)?\b/ },
  { code: 'us', name: 'United States', pattern: /\b(?:United States|USA|U\.S\.|US)\b/ },
  { code: 'gb', name: 'United Kingdom', pattern: /\b(?:United Kingdom|UK|Britain|British)\b/ },
  { code: 'ca', name: 'Canada', pattern: /\bCanad(?:a|ian|ians)\b/ },
  { code: 'au', name: 'Australia', pattern: /\bAustralian?s?\b/ },
  { code: 'nz', name: 'New Zealand', pattern: /\bNew Zealand(?:ers?)?\b/ },
  { code: 'ie', name: 'Ireland', pattern: /\b(?:Ireland|Irish)\b/ },
  { code: 'de', name: 'Germany', pattern: /\bGerman(?:y|s)?\b/ },
  { code: 'fr', name: 'France', pattern: /\b(?:France|French)\b/ },
  { code: 'es', name: 'Spain', pattern: /\b(?:Spain|Spanish)\b/ },
  { code: 'it', name: 'Italy', pattern: /\b(?:Italy|Italian)\b/ },
  { code: 'nl', name: 'Netherlands', pattern: /\b(?:Netherlands|Dutch)\b/ },
  { code: 'jp', name: 'Japan', pattern: /\bJapan(?:ese)?\b/ },
  { code: 'kr', name: 'South Korea', pattern: /\b(?:South Korea|Korean?s?)\b/ },
  { code: 'sg', name: 'Singapore', pattern: /\bSingapore(?:an)?s?\b/ },
  { code: 'id', name: 'Indonesia', pattern: /\bIndonesian?s?\b/ },
  { code: 'ph', name: 'Philippines', pattern: /\b(?:Philippines|Filipinos?)\b/ },
  { code: 'vn', name: 'Vietnam', pattern: /\bViet ?nam(?:ese)?\b/ },
  { code: 'pk', name: 'Pakistan', pattern: /\bPakistan(?:i|is)?\b/ },
  { code: 'bd', name: 'Bangladesh', pattern: /\bBangladesh(?:i|is)?\b/ },
  { code: 'ae', name: 'United Arab Emirates', pattern: /\b(?:UAE|United Arab Emirates|Emirati)\b/ },
  { code: 'sa', name: 'Saudi Arabia', pattern: /\bSaudi\b/ },
  { code: 'za', name: 'South Africa', pattern: /\bSouth African?s?\b/ },
  { code: 'ng', name: 'Nigeria', pattern: /\bNigerian?s?\b/ },
  { code: 'ke', name: 'Kenya', pattern: /\bKenyan?s?\b/ },
  { code: 'br', name: 'Brazil', pattern: /\bBrazil(?:ian)?s?\b/ },
  { code: 'mx', name: 'Mexico', pattern: /\bMexic(?:o|an|ans)\b/ }
]

/** Country domains that do not use their ISO code. */
const DOMAIN_ALIASES: Record<string, string> = { uk: 'gb' }
/** Two-letter path parts that are more often a word than a country. */
const AMBIGUOUS_PATH = new Set(['it', 'id'])

const byCode = (code: string | undefined) =>
  COUNTRIES.find(c => c.code === code)

/** The English name of a country this module knows, by code. */
export function countryName(code: string): string | undefined {
  return byCode(code)?.name
}

/** Countries named in `text`, each once, in the order the table lists them. */
export function countriesNamed(text: string): Region[] {
  return COUNTRIES.filter(c => c.pattern.test(text)).map(c => ({
    code: c.code,
    name: c.name
  }))
}

/**
 * The market a page is localised for: a country domain (".co.uk", ".in") or
 * a locale as the first path part ("/in/", "/en-gb/"). Undefined for global
 * pages and countries this module does not know.
 */
export function countryOfUrl(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const host = parsed.hostname.toLowerCase()
  const tld = host.split('.').pop() ?? ''
  const fromDomain = byCode(DOMAIN_ALIASES[tld] ?? tld)
  if (fromDomain) return fromDomain.code
  // linkedin.com/in/... is a profile, not India.
  if (/(^|\.)linkedin\.com$/.test(host)) return undefined
  const first = parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  const locale = first ? /^(?:[a-z]{2}[-_])?([a-z]{2})$/.exec(first) : null
  const code = locale?.[1]
  if (!code || (first === code && AMBIGUOUS_PATH.has(code))) return undefined
  return byCode(DOMAIN_ALIASES[code] ?? code)?.code
}

export function inferRegion(
  ctx: Pick<GenerationContext, 'audiences' | 'primaryGoal' | 'account'>
): Region | null {
  const audienceText = ctx.audiences
    .flatMap(a => [a.geography ?? '', a.name])
    .join('\n')
  const goalText = [ctx.primaryGoal?.title, ctx.primaryGoal?.keyMessage]
    .filter(Boolean)
    .join('\n')
  const named = countriesNamed(audienceText)
  const stated = named.length > 0 ? named : countriesNamed(goalText)
  if (stated.length === 1) return stated[0]!
  if (stated.length > 1) return { name: stated.map(r => r.name).join(', ') }

  const site = ctx.account.websiteUrl ? countryOfUrl(ctx.account.websiteUrl) : undefined
  const country = byCode(site)
  return country ? { code: country.code, name: country.name } : null
}
