import type { FormatId } from '@/lib/formats'
import { PLATFORMS, type PlatformId, type PlatformSpec } from '@/lib/platforms'

/**
 * The platforms the publishing engine publishes to through an API, each with
 * a provider (./provider.ts): all of them through Buffer (since 2026-11-16
 * LinkedIn too; its sign-in app is for signing in only). Their names come from the platform registry, so
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
  'linkedin',
  'x',
  'threads',
  'facebook',
  'instagram'
] as const satisfies readonly PublishingPlatformId[]
export type BufferPlatformId = (typeof BUFFER_PLATFORM_IDS)[number]

export function isBufferPlatform(value: unknown): value is BufferPlatformId {
  return (BUFFER_PLATFORM_IDS as readonly unknown[]).includes(value)
}

/** Buffer's `service` names for each network's channels. */
export const BUFFER_SERVICES: Record<BufferPlatformId, readonly string[]> = {
  linkedin: ['linkedin'],
  x: ['twitter', 'x'],
  threads: ['threads'],
  facebook: ['facebook'],
  instagram: ['instagram']
}

/** The network a Buffer channel publishes to here; null for one not published through Buffer. */
export function bufferPlatformOf(service: string): BufferPlatformId | null {
  return (
    BUFFER_PLATFORM_IDS.find(id => BUFFER_SERVICES[id].includes(service)) ?? null
  )
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
 * comment field is a link-in-bio note for the author, not a comment. Not
 * LinkedIn: Buffer takes a LinkedIn first comment only on a paid plan.
 */
export const SENDS_FIRST_COMMENT: ReadonlySet<string> = new Set([
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
