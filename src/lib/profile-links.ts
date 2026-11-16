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
