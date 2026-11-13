import type { FormatId } from '@/lib/formats'
import { PLATFORMS, type PlatformId, type PlatformSpec } from '@/lib/platforms'

/**
 * The platforms the publishing engine publishes to through an API, each with
 * a provider (./provider.ts): LinkedIn directly; X, Threads, Facebook and
 * Instagram through Buffer. Their names come from the platform registry, so
 * messages never spell them out. Safe for the browser: no provider code is
 * imported here.
 */
export const PUBLISHING_PLATFORM_IDS = [
  'linkedin',
  'x',
  'threads',
  'facebook',
  'instagram'
] as const satisfies readonly PlatformId[]
export type PublishingPlatformId = (typeof PUBLISHING_PLATFORM_IDS)[number]

/**
 * The platforms published through Buffer (./buffer): the user connects the
 * account as a channel in their own Buffer account, and the app holds only
 * their Buffer authorization.
 */
export const BUFFER_PLATFORM_IDS = [
  'x',
  'threads',
  'facebook',
  'instagram'
] as const satisfies readonly PublishingPlatformId[]
export type BufferPlatformId = (typeof BUFFER_PLATFORM_IDS)[number]

export function isBufferPlatform(value: unknown): value is BufferPlatformId {
  return (BUFFER_PLATFORM_IDS as readonly unknown[]).includes(value)
}

/** In the order Settings → Integrations lists them. */
export const PUBLISHING_PLATFORMS: readonly PlatformSpec[] =
  PUBLISHING_PLATFORM_IDS.map(id => PLATFORMS[id])

/**
 * The formats (src/lib/formats) each platform's provider publishes; a post in
 * any other (an Instagram post, a video script) is copied and posted by hand.
 */
export const PUBLISHABLE_FORMATS: Record<PublishingPlatformId, FormatId[]> = {
  linkedin: ['linkedin.post'],
  // A thread goes out as one: each post a reply to the one before.
  x: ['x.post', 'x.thread'],
  threads: ['threads.post'],
  facebook: ['facebook.post'],
  // A caption with its image; a Reel needs a video, which posts do not have.
  instagram: ['instagram.caption']
}

/**
 * The platforms whose provider publishes a post's first comment with it
 * (on X and Threads, the reply under the post). Not Instagram: its caption's
 * comment field is a link-in-bio note for the author, not a comment.
 */
export const SENDS_FIRST_COMMENT: ReadonlySet<string> = new Set([
  'linkedin',
  'x',
  'threads',
  'facebook'
])

/** The platforms that refuse a post without an image (Instagram). */
export const NEEDS_IMAGE: ReadonlySet<string> = new Set(['instagram'])

/** Whether a post written for `platform` can be published through an API. */
export function canPublishTo(
  platform: string | null | undefined
): platform is PublishingPlatformId {
  return (PUBLISHING_PLATFORM_IDS as readonly unknown[]).includes(platform)
}

/** Whether a post of this platform and format can be published through an API. */
export function canPublishFormat(
  platform: string | null | undefined,
  formatId: FormatId
): boolean {
  return canPublishTo(platform) && PUBLISHABLE_FORMATS[platform].includes(formatId)
}
