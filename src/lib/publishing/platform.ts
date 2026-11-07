import { PLATFORMS, type PlatformSpec } from '@/lib/platforms'

/**
 * The platform the publishing engine publishes to through its API. Only one
 * platform has an API provider so far (./linkedin), so connections,
 * publications and Settings → Integrations all serve this one; its name comes
 * from the platform registry, so messages never spell it out.
 */
export const PUBLISHING_PLATFORM: PlatformSpec = PLATFORMS.linkedin

/** Whether a post written for `platform` can be published through the API. */
export function canPublishTo(platform: string | null | undefined): boolean {
  return platform === PUBLISHING_PLATFORM.id
}
