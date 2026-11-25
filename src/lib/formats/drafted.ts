import { isVideoFormat } from '@/lib/video/formats'
import { FORMATS, isFormatId } from './registry'
import type { FormatId, PlatformId } from './types'

/**
 * Which posts an idea already has, as Create posts reads them. Create posts
 * makes one post per platform, so a platform is drafted once the idea has
 * any post there that is not a video; a Reel or a Short is its own kind of
 * post, drafted only by itself. ("Add a version" on a post can still add
 * another type on a platform.) An idea that is drafted can be selected
 * again for the platforms it has no post on.
 *
 * `existing` is the formats of the idea's posts as stored. Pure: the Ideas
 * page, the Create posts dialog and the server read it alike.
 */
export function hasPostFor(
  format: FormatId,
  existing: readonly string[]
): boolean {
  if (existing.includes(format)) return true
  if (isVideoFormat(format)) return false
  const platform = FORMATS[format].platform
  return existing.some(
    f => isFormatId(f) && !isVideoFormat(f) && FORMATS[f].platform === platform
  )
}

/** Of the requested formats, those the idea has no post for yet. */
export const formatsStillToDraft = (
  requested: readonly FormatId[],
  existing: readonly string[]
): FormatId[] => requested.filter(f => !hasPostFor(f, existing))

/** The platforms an idea has a post on that is not a video, in the registry's order. */
export function draftedPlatforms(existing: readonly string[]): PlatformId[] {
  const platforms = new Set(
    existing
      .filter(f => isFormatId(f) && !isVideoFormat(f))
      .map(f => FORMATS[f as FormatId].platform)
  )
  return [...new Set(Object.values(FORMATS).map(f => f.platform))].filter(p =>
    platforms.has(p)
  )
}
