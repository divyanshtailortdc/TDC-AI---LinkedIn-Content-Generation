import { PLATFORMS, PLATFORM_IDS, type PlatformId } from '@/lib/formats'
import { optionalUrlError } from '@/lib/identity-profile'

/**
 * An identity's profile link on each platform it posts on, saved in
 * `accounts.profile_links`. `accounts.linkedin_url` still holds one link, the
 * main one (mainProfileLink), for what reads a single link: the handle and
 * the AI setup's research. Every write of the links rewrites it.
 */
export type ProfileLinks = Partial<Record<PlatformId, string>>

export const PROFILE_LINK_MAX_LENGTH = 500

/** What a profile link on each platform looks like, for a person and for a brand. */
export function profileLinkPlaceholder(platform: PlatformId, brand = false): string {
  switch (platform) {
    case 'linkedin':
      return brand
        ? 'https://www.linkedin.com/company/your-brand'
        : 'https://www.linkedin.com/in/your-name'
    case 'x':
      return 'https://x.com/your-handle'
    case 'threads':
      return 'https://www.threads.com/@your-handle'
    case 'facebook':
      return brand ? 'https://www.facebook.com/your-page' : 'https://www.facebook.com/your-name'
    case 'instagram':
      return 'https://www.instagram.com/your-handle'
    case 'youtube':
      return 'https://www.youtube.com/@your-channel'
  }
}

/** The hosts each platform's profiles live on, subdomains included. */
const HOSTS: ReadonlyArray<[RegExp, PlatformId]> = [
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(x|twitter)\.com$/, 'x'],
  [/(^|\.)threads\.(net|com)$/, 'threads'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook'],
  [/(^|\.)(instagram\.com|instagr\.am)$/, 'instagram'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube']
]

/** The platform a link is on, from its host; null for any other site. */
export function platformOfLink(url: string): PlatformId | null {
  let host: string
  try {
    host = new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return null
  }
  return HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? null
}

/** First path segments that are a platform's own pages, not an account. */
const NOT_ACCOUNTS: Partial<Record<PlatformId, ReadonlySet<string>>> = {
  x: new Set(
    'i home search explore hashtag intent share settings messages notifications login signup tos privacy compose jobs download'.split(' ')
  ),
  facebook: new Set(
    'sharer sharer.php share share.php dialog groups events watch photo photo.php photos story.php permalink.php login login.php help pages people hashtag marketplace gaming plugins tr l.php reel reels posts video videos media business privacy policies'.split(' ')
  ),
  instagram: new Set('p reel reels tv explore stories accounts about legal direct web developer'.split(' ')),
  youtube: new Set('watch shorts playlist results feed embed live hashtag channel c user about'.split(' '))
}

/**
 * The profile a link on `platform` belongs to, as that profile's own address
 * (https://www.instagram.com/zomato/ for a link to one of its posts), or null
 * when the link names no account: a share button, a hashtag, a search.
 */
export function canonicalProfileLink(platform: PlatformId, url: string): string | null {
  if (platformOfLink(url) !== platform) return null
  const parsed = new URL(url.trim())
  const parts = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map(part => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
  const first = parts[0] ?? ''
  const isAccount = (pattern: RegExp) =>
    pattern.test(first) && !NOT_ACCOUNTS[platform]?.has(first.toLowerCase())
  switch (platform) {
    case 'linkedin': {
      const slug = parts[1]
      const section = first.toLowerCase()
      return ['in', 'company', 'school'].includes(section) && slug
        ? `https://www.linkedin.com/${section}/${slug.toLowerCase()}`
        : null
    }
    case 'x':
      return isAccount(/^\w{1,15}$/) ? `https://x.com/${first}` : null
    case 'threads':
      return /^@[\w.]{1,30}$/.test(first) ? `https://www.threads.com/${first}` : null
    case 'instagram':
      return isAccount(/^[\w.]{1,30}$/) ? `https://www.instagram.com/${first}/` : null
    case 'facebook': {
      const id = parsed.searchParams.get('id')
      if (first.toLowerCase() === 'profile.php' && id && /^\d+$/.test(id)) {
        return `https://www.facebook.com/profile.php?id=${id}`
      }
      return isAccount(/^[\w.-]{2,}$/) ? `https://www.facebook.com/${first}` : null
    }
    case 'youtube': {
      if (/^@[\w.-]{1,100}$/.test(first)) return `https://www.youtube.com/${first}`
      const section = first.toLowerCase()
      if (['channel', 'c', 'user'].includes(section) && parts[1]) {
        return `https://www.youtube.com/${section}/${parts[1]}`
      }
      return isAccount(/^[\w.-]{2,}$/) ? `https://www.youtube.com/${first}` : null
    }
  }
}

/**
 * Of a page's links, the first profile on each of `platforms`: a business's
 * own site links its accounts, usually as icons in the footer.
 */
export function profilesAmong(links: readonly string[], platforms: readonly PlatformId[]): ProfileLinks {
  const found: ProfileLinks = {}
  for (const link of links) {
    const platform = platformOfLink(link)
    if (!platform || !platforms.includes(platform) || found[platform]) continue
    const profile = canonicalProfileLink(platform, link)
    if (profile) found[platform] = profile
  }
  return found
}

/** What is wrong with a link typed for `platform`, or undefined when it is fine or empty. */
export function profileLinkError(platform: PlatformId, value: string): string | undefined {
  const url = value.trim()
  if (!url) return undefined
  const invalid = optionalUrlError(url)
  if (invalid) return invalid
  if (url.length > PROFILE_LINK_MAX_LENGTH) {
    return `Links must be ${PROFILE_LINK_MAX_LENGTH} characters or fewer`
  }
  const on = platformOfLink(url)
  if (on && on !== platform) {
    return `This is a ${PLATFORMS[on].label} link. Put your ${PLATFORMS[platform].label} profile here.`
  }
  return undefined
}

/** Every problem in a set of typed links, by platform. */
export function profileLinkErrors(
  links: ProfileLinks
): Partial<Record<PlatformId, string>> {
  const errors: Partial<Record<PlatformId, string>> = {}
  for (const platform of PLATFORM_IDS) {
    const error = profileLinkError(platform, links[platform] ?? '')
    if (error) errors[platform] = error
  }
  return errors
}

/**
 * Typed or saved links: known platforms only, trimmed, in platform order. An
 * empty link means none; one with a problem (profileLinkError) is dropped,
 * so check typed links with profileLinkErrors first.
 */
export function cleanProfileLinks(value: unknown): ProfileLinks {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const out: ProfileLinks = {}
  for (const platform of PLATFORM_IDS) {
    const raw = record[platform]
    if (typeof raw !== 'string') continue
    const url = raw.trim()
    if (url && !profileLinkError(platform, url)) out[platform] = url
  }
  return out
}

/** The main link: LinkedIn's, else the first platform's that has one. */
export function mainProfileLink(links: ProfileLinks): string | null {
  return links.linkedin ?? PLATFORM_IDS.map(p => links[p]).find(Boolean) ?? null
}

/**
 * An identity's saved links. One saved before links were kept per platform
 * is only in linkedin_url, and counts for the platform its host is on.
 */
export function profileLinksOf(account: {
  profileLinks?: unknown
  linkedinUrl?: string | null
}): ProfileLinks {
  const links = cleanProfileLinks(account.profileLinks)
  const legacy = account.linkedinUrl?.trim()
  const on = legacy ? platformOfLink(legacy) : null
  if (legacy && on && !links[on] && !profileLinkError(on, legacy)) {
    return cleanProfileLinks({ ...links, [on]: legacy })
  }
  return links
}

/**
 * A link saved before links were kept per platform whose site is no
 * platform's (a link-in-bio page, say). It has no field of its own, so it is
 * kept as it is until a platform link replaces it as the main one.
 */
export function otherProfileLink(account: { linkedinUrl?: string | null }): string | null {
  const legacy = account.linkedinUrl?.trim()
  return legacy && !platformOfLink(legacy) ? legacy : null
}

/** The links typed into a form, over the saved ones: an emptied field removes its link. */
export function mergeProfileLinks(saved: ProfileLinks, typed: Record<string, unknown>): ProfileLinks {
  const merged: Record<string, unknown> = { ...saved }
  for (const platform of PLATFORM_IDS) {
    if (typeof typed[platform] === 'string') merged[platform] = typed[platform]
  }
  return cleanProfileLinks(merged)
}

/**
 * The platforms whose link fields a profile shows: the ones it posts on, then
 * any other with a saved link, so nothing saved is out of reach.
 */
export function linkPlatforms(posting: readonly PlatformId[], saved: ProfileLinks): PlatformId[] {
  return PLATFORM_IDS.filter(p => posting.includes(p) || Boolean(saved[p]))
}
