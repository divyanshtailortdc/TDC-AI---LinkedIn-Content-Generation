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
  // Created no more (see CREATABLE_FORMATS); kept so Reels already written open.
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

/**
 * The shape a post's generated image is made in, to fill its platform's feed:
 * LinkedIn's 1.91:1, X's 16:9, and the 4:5 portrait Instagram, Facebook and
 * Threads show whole. src/lib/media draws each at its own size.
 */
export type ImageShape = '1.91:1' | '16:9' | '4:5'

/** Where a link goes when it should not sit in the post itself. */
export type LinkFallback = 'first_comment' | 'reply' | 'link_in_bio'

/**
 * What goes out with a post's text: nothing (a text-only post), one image,
 * a carousel of slides, or a video (a script the author films). The caption
 * is the post's text in every case; a carousel's slides carry their own.
 */
export const MEDIA_FORMATS = ['text', 'image', 'carousel', 'video'] as const
export type MediaFormat = (typeof MEDIA_FORMATS)[number]

/**
 * How a platform takes a carousel. `document`: one PDF the feed shows page
 * by page (LinkedIn's carousels); `images`: several images in one post
 * (Instagram, Facebook).
 */
export interface CarouselSpec {
  /** Fewest and most slides the platform takes in one post. */
  minSlides: number
  maxSlides: number
  /** What drafting aims for: enough to swipe, few enough to finish. */
  targetSlides: { min: number; max: number }
  delivery: 'document' | 'images'
}

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
  /**
   * The post is a picture with its caption (an Instagram post): drafting
   * makes the picture with the text, as it does for a LinkedIn post.
   */
  withImage?: boolean
  /** The shape its generated images are made in. */
  imageShape: ImageShape
  /**
   * What can go out with the text, the first being what a new post gets
   * unless its idea suggests otherwise. `carousel` is set when the format
   * takes one.
   */
  media: {
    formats: readonly MediaFormat[]
    /** Most images one post carries (X: 4); absent when only one or none. */
    maxImages?: number
    carousel?: CarouselSpec
  }
  /** Where a format reads or opens unlike its platform's other formats (a video script). */
  register?: string
  opening?: string
}
