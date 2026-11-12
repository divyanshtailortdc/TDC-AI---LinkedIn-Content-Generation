import type { FormatId } from '@/lib/formats'
import { PLATFORMS, type PlatformId, type PlatformSpec } from '@/lib/platforms'

/**
 * The platforms the publishing engine publishes to through an API, each with
 * a provider (./provider.ts): LinkedIn directly, X through Buffer. Their
 * names come from the platform registry, so messages never spell them out.
 * Safe for the browser: no provider code is imported here.
 */
export const PUBLISHING_PLATFORM_IDS = [
  'linkedin',
  'x'
] as const satisfies readonly PlatformId[]
export type PublishingPlatformId = (typeof PUBLISHING_PLATFORM_IDS)[number]

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
  x: ['x.post', 'x.thread']
}

/**
 * The platforms whose provider publishes a post's first comment with it
 * (on X, the reply under the post).
 */
export const SENDS_FIRST_COMMENT: ReadonlySet<string> = new Set([
  'linkedin',
  'x'
])

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
