/**
 * The platforms posts are written for, and what about a post depends on where
 * it goes out: its length limits and fold, how its text is formatted, and the
 * name prompts and screens use for it. Code reads these through a post's
 * `platform` (post_drafts.platform) instead of naming a platform.
 *
 * Adding a platform: add its id to PLATFORM_IDS and its spec to PLATFORMS.
 * Publishing to it through its API also needs a provider under
 * src/lib/publishing (docs/PUBLISHING.md).
 */

export const PLATFORM_IDS = [
  'linkedin',
  'x',
  'threads',
  'facebook',
  'instagram',
  'youtube'
] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]

export type PlatformSpec = {
  id: PlatformId
  /** As shown in the app and written into prompts. */
  name: string
  /** Lengths, in characters. */
  limits: {
    /** What a draft aims for: hook, body and call to action together. */
    targetChars: number
    /** The platform's hard cap on a post. */
    maxChars: number
    /** Roughly where the feed folds a post; the hook must fit above it. */
    hookMaxChars: number
    /** Where the feed folds a comment. */
    commentFoldChars: number
  }
  /** What the feed's fold link says. */
  foldLabel: string
  /** The platform renders plain text only: markdown shows as literal characters. */
  plainTextOnly: boolean
  /** Links in the body cost reach, so by default they go in the first comment. */
  bodyLinksCostReach: boolean
  /**
   * Bold survives pasting into the platform only as Unicode bold letters, so
   * Copy and the preview set the hook in them.
   */
  unicodeBoldHook: boolean
}

export const PLATFORMS: Record<PlatformId, PlatformSpec> = {
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    limits: {
      targetChars: 1300,
      maxChars: 3000,
      hookMaxChars: 200,
      commentFoldChars: 180
    },
    foldLabel: '…see more',
    plainTextOnly: true,
    bodyLinksCostReach: true,
    unicodeBoldHook: true
  },
  // The platforms below are written for in several formats each (a post, a
  // thread, a video script; src/lib/formats), whose own limits drafting and
  // the checks use. These are the platform's defaults, for code that only
  // knows a post's platform. Of these, only X is published through an API
  // (src/lib/publishing/platform.ts).
  x: {
    id: 'x',
    name: 'X',
    limits: { targetChars: 220, maxChars: 280, hookMaxChars: 280, commentFoldChars: 280 },
    foldLabel: 'Show more',
    plainTextOnly: true,
    bodyLinksCostReach: true,
    unicodeBoldHook: false
  },
  threads: {
    id: 'threads',
    name: 'Threads',
    limits: { targetChars: 320, maxChars: 500, hookMaxChars: 500, commentFoldChars: 500 },
    foldLabel: 'more',
    plainTextOnly: true,
    bodyLinksCostReach: false,
    unicodeBoldHook: false
  },
  facebook: {
    id: 'facebook',
    name: 'Facebook',
    limits: { targetChars: 600, maxChars: 2000, hookMaxChars: 2000, commentFoldChars: 200 },
    foldLabel: 'See more',
    plainTextOnly: true,
    bodyLinksCostReach: false,
    unicodeBoldHook: false
  },
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    limits: { targetChars: 800, maxChars: 2200, hookMaxChars: 125, commentFoldChars: 125 },
    foldLabel: 'more',
    plainTextOnly: true,
    bodyLinksCostReach: false,
    unicodeBoldHook: false
  },
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    limits: { targetChars: 300, maxChars: 5000, hookMaxChars: 5000, commentFoldChars: 200 },
    foldLabel: 'more',
    plainTextOnly: true,
    bodyLinksCostReach: false,
    unicodeBoldHook: false
  }
}

/**
 * The platform a post is written for when nothing else is chosen, and the
 * one every post written before platforms existed belongs to.
 */
export const DEFAULT_PLATFORM_ID: PlatformId = 'linkedin'

export function isPlatformId(value: unknown): value is PlatformId {
  return (
    typeof value === 'string' && (PLATFORM_IDS as readonly string[]).includes(value)
  )
}

/** A platform's spec; an unknown or missing id gives the default platform. */
export function getPlatform(id?: string | null): PlatformSpec {
  return PLATFORMS[isPlatformId(id) ? id : DEFAULT_PLATFORM_ID]
}
