/**
 * The platforms and formats posts are written for. Everything that differs
 * between platforms lives in the registry (./registry), so the drafting
 * engine, the checks and the review screen read a spec instead of branching
 * on a platform. See docs/MULTI_PLATFORM_PLAN.md §4.
 *
 * Pure data and functions: imported by server code, tests and the browser.
 */

// One list of platforms for the whole app: src/lib/platforms, which also holds
// what each platform's posts look like where only the platform is known.
export { PLATFORM_IDS, type PlatformId } from '@/lib/platforms'
import type { PlatformId } from '@/lib/platforms'

export const FORMAT_IDS = [
  'linkedin.post',
  'x.post',
  'x.thread',
  'threads.post',
  'facebook.post',
  'instagram.caption',
  'instagram.reel',
  'youtube.short'
] as const
export type FormatId = (typeof FORMAT_IDS)[number]

/** What every identity drafts until it turns other formats on. */
export const DEFAULT_FORMAT: FormatId = 'linkedin.post'

/**
 * How a platform counts a post's length. LinkedIn counts UTF-16 units (what
 * `String.length` gives); X weighs characters, counting every link as 23 and
 * emoji and most non-Latin characters as 2.
 */
export type CountMode = 'utf16' | 'graphemes' | 'x_weighted'

/** Where a link goes when it should not sit in the post itself. */
export type LinkFallback = 'first_comment' | 'reply' | 'link_in_bio'

export interface PlatformInfo {
  id: PlatformId
  label: string
  /**
   * What earns attention on this platform and what does not, for ideation:
   * the kinds of idea worth proposing for it.
   */
  ideationProfile: string
  /** How posts read here, for drafting. */
  register: string
  /** How a post opens here, so each platform's version opens its own way. */
  opening: string
}

export interface FormatSpec {
  id: FormatId
  platform: PlatformId
  /** As the review screen names it, e.g. "X thread". */
  label: string
  /** Stored on each post written under this spec; bump when the rules change. */
  version: number
  /**
   * One text, an ordered set of posts (a thread), or a short video: a
   * spoken script shot by shot, posted with a caption.
   */
  structure: 'single' | 'thread' | 'script'
  limits: {
    count: CountMode
    /** The whole post, or each part of a thread. */
    maxChars: number
    /** What to aim for: the whole post, or each part of a thread. */
    targetChars: number
    /** Where the feed cuts the text behind "more"; null when it does not. */
    foldChars: number | null
    /** How many posts a thread has. */
    parts?: { min: number; max: number }
    /** A video's spoken length, in seconds; `maxChars` is then the caption's. */
    seconds?: { target: number; max: number }
  }
  /** A fixed range, or 'voice' to follow the identity's hashtag policy. */
  hashtags: { min: number; max: number } | 'voice'
  links: {
    /** What a link in the post itself does. */
    inBody: 'ok' | 'reach_penalty' | 'not_clickable'
    fallback: LinkFallback
    /** Anything else drafting should know about links here. */
    note?: string
  }
  /** Rules the drafting prompt states for this format. */
  rules: string[]
  /** What the review screen calls the first comment field on this platform. */
  commentLabel: string
  /** Where a format reads or opens unlike its platform's other formats (a Reel). */
  register?: string
  opening?: string
}
