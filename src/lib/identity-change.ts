import { PLATFORM_IDS, type PlatformId } from '@/lib/formats'
import { deriveHeadline } from '@/lib/identity-profile'
import {
  canonicalProfileLink,
  cleanProfileLinks,
  platformOfLink,
  type ProfileLinks
} from '@/lib/profile-links'

/**
 * Telling one company (or person) from another, for an identity that is
 * changed to describe someone else: Zomato rewritten as TDCCommerce. Its
 * voice, knowledge, goals, ideas and history all belong to the old one, so
 * Re-analyze offers to switch them over (src/lib/identity-switch.ts) instead
 * of filling the gaps around them. Pure and client-safe.
 */

/** Who an identity describes: enough to tell one company from another. */
export type IdentitySnapshot = {
  name: string
  company?: string | null
  websiteUrl?: string | null
}

/** Words that name a kind of company, not which one. */
const COMPANY_WORDS = new Set(
  'the inc incorporated ltd limited pvt private llc llp co company corp corporation plc gmbh'.split(' ')
)

/** A name as compared: case, punctuation, spacing and company suffixes don't count. */
export function comparableName(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(word => word && !COMPANY_WORDS.has(word))
    .join('')
}

/** The site a link is on, without "www.": "zomato.com". Empty for none or an invalid link. */
export function siteOf(url: string | null | undefined): string {
  const value = url?.trim()
  if (!value) return ''
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** One name is the other, or holds it ("Zomato India"). */
function sameName(a: string, b: string): boolean {
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 4 && longer.includes(shorter)
}

/** The same site, or one of its subdomains (blog.zomato.com); sites as siteOf gives them. */
export function sameSite(a: string, b: string): boolean {
  if (!a || !b) return false
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/** Second-level labels that are not a name: the "co" of example.co.in. */
const GENERIC_LABELS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

/** The name in a website's address: "tdccommerce" for https://blox.tdccommerce.com. */
function siteName(url: string | null | undefined): string {
  const labels = siteOf(url).split('.').filter(Boolean)
  labels.pop()
  if (labels.length > 1 && GENERIC_LABELS.has(labels[labels.length - 1]!)) labels.pop()
  return labels[labels.length - 1] ?? ''
}

/**
 * Whether `to` describes someone else than `from`: another company, or the
 * same person at another company. A new name on the same website is the
 * same company renamed; small changes to a name or link are the same one.
 */
export function isDifferentIdentity(
  from: IdentitySnapshot,
  to: IdentitySnapshot
): boolean {
  const fromName = comparableName(from.name)
  const toName = comparableName(to.name)
  const fromSite = siteOf(from.websiteUrl)
  const toSite = siteOf(to.websiteUrl)
  const sitesKnown = Boolean(fromSite && toSite)
  const siteDiffers = sitesKnown && !sameSite(fromSite, toSite)

  if (fromName && toName && !sameName(fromName, toName)) {
    return !(sitesKnown && !siteDiffers)
  }
  const fromCompany = comparableName(from.company)
  const toCompany = comparableName(to.company)
  const companyDiffers = Boolean(
    fromCompany && toCompany && !sameName(fromCompany, toCompany)
  )
  if (companyDiffers && siteDiffers) return true
  // No name to compare: another website says it all.
  return !toName && siteDiffers
}

/** Just what tells the identity apart, trimmed. */
export function snapshotOf(profile: IdentitySnapshot): IdentitySnapshot {
  return {
    name: profile.name.trim(),
    company: profile.company?.trim() || null,
    websiteUrl: profile.websiteUrl?.trim() || null
  }
}

/**
 * What `accounts.context_identity` becomes when the profile is saved: the
 * company the voice, knowledge and goals were set up for, while the profile
 * names another one; null once it names that company again, or never did.
 *
 * `current` is what it holds now, `saved` the profile before this save and
 * `next` the profile being saved.
 */
export function contextIdentityAfterSave(
  current: IdentitySnapshot | null | undefined,
  saved: IdentitySnapshot,
  next: IdentitySnapshot
): IdentitySnapshot | null {
  const base = current ?? snapshotOf(saved)
  return isDifferentIdentity(base, next) ? base : null
}

type HeadlineParts = {
  name: string
  company?: string | null
  industry?: string | null
}

/**
 * The headline after a save. It is made from the company and industry (and
 * the name when both are empty), so it follows them; nothing else edits it.
 * Before, it was written once and kept, and a Zomato identity rewritten as
 * TDCCommerce still introduced itself as "Food delivery" in every prompt.
 */
export function headlineAfterSave(
  existing: string | null | undefined,
  saved: HeadlineParts,
  next: HeadlineParts
): string {
  const changed = (['name', 'company', 'industry'] as const).some(
    key => (saved[key] ?? '').trim() !== (next[key] ?? '').trim()
  )
  if (existing?.trim() && !changed) return existing.trim()
  return deriveHeadline({
    name: next.name.trim(),
    company: next.company?.trim() || undefined,
    industry: next.industry?.trim() || undefined
  })
}

/** Where a link proposed for a switched identity came from. */
export type LinkSource = 'typed' | 'suggested' | 'found' | 'saved'

/**
 * The profile link on each platform an identity switched to another company
 * is offered. In order of trust: the link typed into the analysis, the main
 * link it suggested, the accounts research found (only on `platforms`, when
 * given), then a link already saved. A saved link may be the old company's,
 * so the review asks about each one that does not fit the new company
 * (linkFitsIdentity) instead of keeping it. A typed link on no platform's
 * site (a link-in-bio page) has no field, so it comes back as `otherLink`.
 */
export function switchProfileLinks(input: {
  typed?: string | null
  suggested?: string | null
  found?: Partial<Record<PlatformId, string>> | null
  saved?: ProfileLinks | null
  platforms?: readonly PlatformId[]
}): {
  links: ProfileLinks
  sources: Partial<Record<PlatformId, LinkSource>>
  otherLink: string | null
} {
  const links: Record<string, string> = {}
  const sources: Partial<Record<PlatformId, LinkSource>> = {}
  const place = (url: string | null | undefined, source: LinkSource) => {
    const value = url?.trim()
    if (!value) return
    const platform = platformOfLink(value)
    if (platform && !links[platform]) {
      links[platform] = value
      sources[platform] = source
    }
  }
  place(input.typed, 'typed')
  place(input.suggested, 'suggested')
  for (const platform of PLATFORM_IDS) {
    const url = input.found?.[platform]
    if (!url || links[platform]) continue
    if (input.platforms && !input.platforms.includes(platform)) continue
    if (canonicalProfileLink(platform, url)) place(url, 'found')
  }
  for (const platform of PLATFORM_IDS) place(input.saved?.[platform], 'saved')
  const cleaned = cleanProfileLinks(links)
  const typed = input.typed?.trim()
  return {
    links: cleaned,
    sources: Object.fromEntries(
      Object.entries(sources).filter(([p]) => cleaned[p as PlatformId])
    ),
    otherLink: typed && !platformOfLink(typed) ? typed : null
  }
}

/**
 * The account a profile link points at, as written there: "zomato" for
 * https://www.instagram.com/zomato/. Empty when the link names no account by
 * name (a numeric Facebook profile, a YouTube channel id) or is on no platform.
 */
export function profileHandle(url: string): string {
  const platform = platformOfLink(url)
  const canonical = platform ? canonicalProfileLink(platform, url) : null
  if (!canonical) return ''
  const parts = new URL(canonical).pathname.split('/').filter(Boolean)
  if (parts[0] === 'profile.php' || (platform === 'youtube' && parts[0] === 'channel')) {
    return ''
  }
  return (parts[parts.length - 1] ?? '').replace(/^@/, '')
}

/** The length of the longest run of letters two names share. */
function longestCommonRun(a: string, b: string): number {
  let best = 0
  let previous = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        row[j] = previous[j - 1]! + 1
        if (row[j]! > best) best = row[j]!
      }
    }
    previous = row
  }
  return best
}

/**
 * Whether a profile link could be the identity's own: its account name
 * shares a run of letters with the identity's name, company or website
 * ("priya.dances" for Priya Rao, "ledgerly_hq" for someone at Ledgerly). One
 * that shares nothing names another account: instagram.com/zomato on an
 * identity now called TDCCommerce. With nothing to compare, it fits.
 */
export function linkFitsIdentity(url: string, identity: IdentitySnapshot): boolean {
  const handle = comparableName(profileHandle(url))
  if (!handle) return true
  const names = [
    comparableName(identity.name),
    comparableName(identity.company),
    siteName(identity.websiteUrl)
  ].filter(name => name.length >= 3)
  if (names.length === 0) return true
  return names.some(name => {
    const run = longestCommonRun(handle, name)
    return run >= 3 && run >= Math.min(5, handle.length, name.length)
  })
}

/**
 * How closely a profile link's account name matches an identity: the
 * longest run of letters it shares with its name, company or website.
 */
function linkMatch(url: string, identity: IdentitySnapshot): number {
  const handle = comparableName(profileHandle(url))
  if (!handle) return 0
  return Math.max(
    0,
    ...[
      comparableName(identity.name),
      comparableName(identity.company),
      siteName(identity.websiteUrl)
    ]
      .filter(name => name.length >= 3)
      .map(name => longestCommonRun(handle, name))
  )
}

/**
 * Whether a profile link belongs to an identity changed from `from` to
 * `to`: it matches the new one more closely than the old one, or as closely
 * when the name stayed (a person who moved to another company). Fitting the
 * new one is not enough: linkedin.com/company/tdccommerce fits "Blink
 * Commerce" by the word "commerce", but it is TDCCommerce's.
 */
export function linkStaysAfterChange(
  url: string,
  from: IdentitySnapshot,
  to: IdentitySnapshot
): boolean {
  const now = linkMatch(url, to)
  const before = linkMatch(url, from)
  if (now !== before) return now > before
  return comparableName(from.name) === comparableName(to.name)
}

/** The saved links that look like another account's (linkFitsIdentity). */
export function unrelatedLinks(
  links: ProfileLinks,
  identity: IdentitySnapshot
): string[] {
  return PLATFORM_IDS.flatMap(platform => {
    const url = links[platform]
    return url && !linkFitsIdentity(url, identity) ? [url] : []
  })
}

/** The address a profile link is compared under. */
const comparable = (platform: PlatformId, url: string) =>
  canonicalProfileLink(platform, url) ?? url.trim()

/** The saved links that `next` leaves out or replaces, for showing what goes. */
export function removedProfileLinks(
  saved: ProfileLinks,
  next: ProfileLinks
): string[] {
  return PLATFORM_IDS.flatMap(platform => {
    const old = saved[platform]
    if (!old) return []
    const kept = next[platform]
    return kept && comparable(platform, kept) === comparable(platform, old)
      ? []
      : [old]
  })
}
