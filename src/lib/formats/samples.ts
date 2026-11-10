import type { PlatformId } from './types'

/**
 * Which platform a pasted sample post was written for. A tag in square
 * brackets anywhere in the post names it, the way "[performed well]" marks a
 * high performer: [X], [Twitter], [Instagram], [Facebook], [Threads] or
 * [LinkedIn]. Untagged posts are LinkedIn posts, as every sample was before.
 */

const TAGS: Array<[RegExp, PlatformId]> = [
  [/\[\s*(?:x|twitter|tweet)\s*\]/i, 'x'],
  [/\[\s*(?:instagram|insta|ig)\s*\]/i, 'instagram'],
  [/\[\s*(?:facebook|fb)\s*\]/i, 'facebook'],
  [/\[\s*threads\s*\]/i, 'threads'],
  [/\[\s*tiktok\s*\]/i, 'tiktok'],
  [/\[\s*(?:youtube|yt)\s*\]/i, 'youtube'],
  [/\[\s*linkedin\s*\]/i, 'linkedin']
]

export function samplePlatform(raw: string): {
  platform: PlatformId
  content: string
} {
  for (const [pattern, platform] of TAGS) {
    if (pattern.test(raw)) {
      return {
        platform,
        content: raw.replace(new RegExp(pattern.source, 'gi'), '').trim()
      }
    }
  }
  return { platform: 'linkedin', content: raw }
}
