import { isGenericPage, normalizeUrlForCompare } from '../urls'

/**
 * Which links in a newsletter lead to something worth reading, and the
 * address an article is kept under. Pure: no network.
 *
 * Links that act on the subscription or account are never followed: a GET on
 * some of them unsubscribes, confirms or signs in. Click trackers hide where
 * a link goes, so the words on the link are checked as well as the address.
 */

/** Always an action, however long the link text. */
const ALWAYS_ACTION = /\b(un-?subscribe|opt[\s-]?out)\b/i

/**
 * Link text that acts on the email or account. Headlines are longer, so one
 * that merely mentions sharing or signing up ("Share buybacks surge in Q3",
 * "Why readers subscribe") is kept: a single word counts only on a button of
 * a few words, a phrase on a short link.
 */
const ACTION_WORD =
  /\b(share|like|comment|reply|forward|invite|refer|referrals?|subscribe|upgrade|confirm|verify|privacy|terms|cookies?|advertise|tweet|restack|pledge|donate)\b/i
const ACTION_WORD_MAX_WORDS = 3
const ACTION_PHRASE =
  /\b((manage|update|change|edit)\b.{0,25}\b(preferences|subscriptions?|settings|profile)|email (settings|preferences)|view\b.{0,25}\b(browser|online|web)|web version|read (it |this )?online|open in (the )?app|sign[\s-]?(in|up)|log[\s-]?in|my account|create (an |your )?account|go paid|sponsor us|become a sponsor|work with us|download\b.{0,15}\bapp|get the app|app store|google play|contact us|privacy policy|terms of (service|use))\b/i
const ACTION_PHRASE_MAX_WORDS = 6

/** Address paths that act on the subscription or account. */
const ACTION_PATH =
  /(un-?subscribe|opt-?out|\/manage\b|preferences|\/subscribe\b|\/signup\b|sign-up|\/login\b|\/signin\b|sign-in|\/account\b|\/referrals?\b|\/refer\b|\/app-link\/|email-login|magic-link|\/confirm\b|\/verify\b|\/profile\b|\/settings\b|\/share\b|\/action\/)/i

/**
 * Sites whose pages cannot be read without signing in or an app, or that are
 * profiles rather than stories. LinkedIn articles and posts are kept.
 */
const UNREADABLE_HOST =
  /(^|\.)(twitter\.com|x\.com|facebook\.com|fb\.com|instagram\.com|tiktok\.com|threads\.net|pinterest\.com|t\.me|wa\.me|whatsapp\.com|apps\.apple\.com|itunes\.apple\.com|play\.google\.com|discord\.gg|discord\.com|bsky\.app)$/i
const LINKEDIN_STORY = /^\/(pulse|posts|news)\//i

const FILE_PATH = /\.(png|jpe?g|gif|webp|svg|ico|bmp|mp3|mp4|mov|wav|zip)$/i

/**
 * Parameters that record a click or identify the reader. Some carry a sign-in
 * token (Substack's `token`, Marketo's `mkt_tok`), and articles are shared
 * between workspaces, so they never stay in a stored address.
 */
const TRACKING_PARAM =
  /^(utm_[a-z_]+|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|vero_id|vero_conv|ck_subscriber_id|oly_enc_id|oly_anon_id|__s|_kx|_bhlid|bhcl_id|last_resource_guid|ss_source|sc_cid|s_cid|cmpid|gclid|fbclid|msclkid|igshid|srsltid|trk|ref|ref_src|r|e|token|access_token|auth|sig|signature|subscriber|subscriber_id|email|isfreemail|publication_id|post_id|triedredirect|lptoken)$/i

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * The address an article is kept under: no fragment, credentials, or tracking
 * and reader parameters. Otherwise as given. Null for anything but http(s).
 */
export function canonicalArticleUrl(raw: string): string | null {
  const url = parseHttpUrl(raw)
  if (!url) return null
  url.hash = ''
  url.username = ''
  url.password = ''
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  }
  return url.toString()
}

/**
 * One key for every way of writing an article's address: without tracking
 * or reader parameters (canonicalArticleUrl), scheme, "www." or a trailing
 * slash, so "https://www.x.com/a/" and "http://x.com/a?utm_source=y" are the
 * same article. For comparing addresses (the Knowledge base, a run's
 * evidence), never for fetching.
 */
export function articleUrlKey(raw: string): string {
  return normalizeUrlForCompare(canonicalArticleUrl(raw) ?? raw)
}

/** True when the link's text or address acts on the subscription or account. */
export function isActionLink(url: string, text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (ALWAYS_ACTION.test(text) || ALWAYS_ACTION.test(url)) return true
  if (words <= ACTION_WORD_MAX_WORDS && ACTION_WORD.test(text)) return true
  if (words <= ACTION_PHRASE_MAX_WORDS && ACTION_PHRASE.test(text)) return true
  const parsed = parseHttpUrl(url)
  return parsed ? ACTION_PATH.test(parsed.pathname) : false
}

/**
 * True when the address can be a story worth reading: a page on a public
 * site, not a homepage or section, a social profile, an app store or a file.
 */
export function isArticleUrl(url: string): boolean {
  const parsed = parseHttpUrl(url)
  if (!parsed) return false
  const host = parsed.hostname.toLowerCase()
  if (UNREADABLE_HOST.test(host)) return false
  if (
    /(^|\.)linkedin\.com$/.test(host) &&
    !LINKEDIN_STORY.test(parsed.pathname)
  )
    return false
  if (FILE_PATH.test(parsed.pathname)) return false
  if (ACTION_PATH.test(parsed.pathname)) return false
  return !isGenericPage(parsed.toString())
}

/**
 * Whether a link found in an email is worth keeping: http(s), not an action
 * on the subscription, and not obviously something other than a story. A
 * click tracker's address passes here; where it leads is checked once it is
 * followed (isArticleUrl).
 */
export function isFollowableLink(url: string, text: string): boolean {
  const parsed = parseHttpUrl(url)
  if (!parsed) return false
  if (isActionLink(url, text)) return false
  const host = parsed.hostname.toLowerCase()
  if (UNREADABLE_HOST.test(host)) return false
  if (
    /(^|\.)linkedin\.com$/.test(host) &&
    !LINKEDIN_STORY.test(parsed.pathname)
  )
    return false
  return !FILE_PATH.test(parsed.pathname)
}
