import { platformOfLink } from '@/lib/profile-links'
import { postKey } from '@/lib/profile-insights/public-posts'
import { stripTrackingParams } from '@/lib/urls'
import type { ReferenceKind, ReferenceSource } from './types'

/**
 * A link someone shared as a model post, read from its address alone: which
 * platform, what kind of post, and the platform's own id for it. Pure, so
 * the browser can check a link as it is typed and tests can pin the rules.
 */

/** Why a link cannot be used, in words for the user. */
export class ReferenceLinkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceLinkError'
  }
}

export type ReferenceLink = {
  /** Tidied: https, the platform's canonical host, no tracking parameters. */
  url: string
  source: ReferenceSource
  kind: ReferenceKind
  /** The platform's own id for the post ("instagram:dzcgxo1e2lt"), when it has one. */
  key: string | null
}

/** Longest link accepted: a post's address is far shorter. */
export const REFERENCE_LINK_MAX_LENGTH = 1000

/** Parameters platforms add to a shared link that only say who shared it, and how. */
const SHARE_PARAMS: Partial<Record<ReferenceSource, RegExp>> = {
  instagram: /^(?:igsh|igshid|img_index|utm_.+)$/i,
  x: /^(?:s|t|ref_src|ref_url)$/i,
  threads: /^(?:xmt|slof)$/i,
  linkedin: /^(?:rcm|trk|trackingId|lipi|utm_.+)$/i,
  facebook: /^(?:mibextid|rdid|sfnsn|__cft__.*|__tn__)$/i,
  youtube: /^(?:si|feature|pp)$/i,
  tiktok: /^(?:_r|_t|is_from_webapp|sender_device|web_id|_d|share_.+)$/i
}

const PROFILE_ONLY: Partial<Record<ReferenceSource, string>> = {
  instagram:
    'This is an Instagram profile, not a post. Open the post or reel and copy its link.',
  x: 'This is an X profile, not a post. Open the post and copy its link.',
  linkedin:
    'This is a LinkedIn profile or page, not a post. Open the post and copy its link (… › Copy link to post).',
  facebook:
    'This is a Facebook page or profile, not a post. Open the post, reel or video and copy its link.',
  threads: 'This is a Threads profile, not a post. Open the post and copy its link.',
  youtube: 'This is a YouTube channel or list, not a video. Open the video or Short and copy its link.',
  tiktok: 'This is a TikTok profile, not a video. Open the video and copy its link.'
}

function sourceOf(host: string): ReferenceSource {
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok'
  return platformOfLink(`https://${host}/`) ?? 'web'
}

/** The address, its host made the one each platform answers on. */
function canonicalHost(url: URL, source: ReferenceSource): void {
  switch (source) {
    case 'x':
      url.hostname = 'x.com'
      break
    case 'instagram':
      url.hostname = 'www.instagram.com'
      break
    case 'linkedin':
      url.hostname = 'www.linkedin.com'
      break
    case 'facebook':
      // fb.watch and fb.me are short links; they stay as they are.
      if (/(^|\.)facebook\.com$/.test(url.hostname)) url.hostname = 'www.facebook.com'
      break
    case 'threads':
      url.hostname = 'www.threads.com'
      break
    case 'youtube':
      if (url.hostname === 'youtu.be') {
        const id = url.pathname.split('/').filter(Boolean)[0]
        url.hostname = 'www.youtube.com'
        url.pathname = '/watch'
        const t = url.searchParams.get('t')
        url.search = ''
        if (id) url.searchParams.set('v', id)
        if (t) url.searchParams.set('t', t)
      } else {
        url.hostname = 'www.youtube.com'
      }
      break
    case 'tiktok':
      if (url.hostname === 'tiktok.com' || url.hostname === 'm.tiktok.com') {
        url.hostname = 'www.tiktok.com'
      }
      break
  }
}

/** What kind of post the address says it is; null when it names no post. */
function kindOf(source: ReferenceSource, url: URL): ReferenceKind | null {
  const path = url.pathname
  switch (source) {
    case 'instagram': {
      const m = /^\/(?:[\w.]+\/)?(p|reels?|tv)\/[\w-]+/i.exec(path)
      if (!m) return null
      return /^p$/i.test(m[1]!) ? 'post' : /^tv$/i.test(m[1]!) ? 'video' : 'reel'
    }
    case 'x':
      return /^\/\w+\/status\/\d+/i.test(path) ? 'post' : null
    case 'linkedin':
      if (/^\/pulse\/[^/]+/i.test(path)) return 'article'
      return /^\/posts\/[^/]+/i.test(path) ||
        /^\/feed\/update\/urn:li:(?:activity|share|ugcPost):\d+/i.test(path)
        ? 'post'
        : null
    case 'facebook': {
      if (/^fb\.watch$/i.test(url.hostname)) return 'video'
      if (/\/(?:reels?)\//i.test(path) || /^\/share\/r\//i.test(path)) return 'reel'
      if (/\/videos?\//i.test(path) || /^\/watch\/?$/i.test(path) || /^\/share\/v\//i.test(path)) {
        return 'video'
      }
      if (/\/photos?\//i.test(path) || /^\/photo(?:\.php)?\/?$/i.test(path)) return 'photo'
      if (
        /\/posts\//i.test(path) ||
        /^\/(?:permalink|story)\.php$/i.test(path) ||
        /^\/share\/p\//i.test(path) ||
        /^\/groups\/[^/]+\/(?:posts|permalink)\//i.test(path) ||
        /^fb\.me$/i.test(url.hostname)
      ) {
        return 'post'
      }
      return null
    }
    case 'threads':
      return /^\/@[\w.]+\/post\/[\w-]+/i.test(path) ? 'post' : null
    case 'youtube':
      if (/^\/shorts\/[\w-]+/i.test(path)) return 'reel'
      if (/^\/watch\/?$/i.test(path) && url.searchParams.get('v')) return 'video'
      if (/^\/live\/[\w-]+/i.test(path)) return 'video'
      return null
    case 'tiktok':
      if (/^(?:vm|vt)\.tiktok\.com$/i.test(url.hostname)) return 'video'
      return /^\/@[\w.]+\/(?:video|photo)\/\d+/i.test(path)
        ? /\/photo\//i.test(path)
          ? 'carousel'
          : 'video'
        : null
    case 'web':
      return 'article'
  }
}

/**
 * The shared link, or why it cannot be used. Accepts a link typed without
 * https:// ("instagram.com/p/…").
 */
export function parseReferenceLink(input: string): ReferenceLink {
  const raw = (input ?? '').trim()
  if (!raw) throw new ReferenceLinkError('Paste the link to a public post, reel or video.')
  if (raw.length > REFERENCE_LINK_MAX_LENGTH) {
    throw new ReferenceLinkError('That link is too long to be a post’s address.')
  }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new ReferenceLinkError('That does not look like a link. Copy the post’s address and paste it here.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ReferenceLinkError('Only web links (https://…) can be used.')
  }
  if (url.username || url.password) {
    throw new ReferenceLinkError('Links with a user name or password in them cannot be used.')
  }
  url.hostname = url.hostname.toLowerCase()
  if (!url.hostname.includes('.')) {
    throw new ReferenceLinkError('That does not look like a link. Copy the post’s address and paste it here.')
  }
  url.protocol = 'https:'
  url.hash = ''
  const source = sourceOf(url.hostname)
  canonicalHost(url, source)
  const share = SHARE_PARAMS[source]
  if (share) {
    for (const key of [...url.searchParams.keys()]) {
      if (share.test(key)) url.searchParams.delete(key)
    }
  }
  const tidy = stripTrackingParams(url.toString())
  const kind = kindOf(source, new URL(tidy))
  if (!kind) {
    throw new ReferenceLinkError(
      PROFILE_ONLY[source] ?? 'This link does not point to a post. Open the post and copy its link.'
    )
  }
  const keyed =
    source === 'web' || source === 'youtube' || source === 'tiktok'
      ? null
      : postKey(source, tidy)
  return { url: tidy, source, kind, key: keyed }
}
