import type { FormatId, PlatformId } from './types'

/**
 * How posts on a platform should sound. It is chosen per platform, so one
 * identity can be professional on LinkedIn and fun on Instagram, and it is
 * independent of who is posting (a person or a brand): a café can be fun, a
 * dancer can be professional. Saved with the platform's other notes in
 * `preferences.channel_settings`.
 *
 * - professional: expertise and insight, the way LinkedIn posts were always
 *   written. Its prompts are the ones every identity had before styles.
 * - casual: relaxed and personal, written for the people who follow them.
 * - fun: playful and high-energy: jokes, skits, POV and trends.
 */
export const CONTENT_STYLES = ['professional', 'casual', 'fun'] as const
export type ContentStyle = (typeof CONTENT_STYLES)[number]

export const STYLE_LABELS: Record<ContentStyle, { label: string; hint: string }> = {
  professional: { label: 'Professional', hint: 'Expertise, insight and opinions' },
  casual: { label: 'Casual', hint: 'Relaxed and personal, like talking to followers' },
  fun: { label: 'Fun', hint: 'Jokes, skits, POV and trends' }
}

/**
 * How a platform sounds until the identity picks: LinkedIn professional,
 * everywhere else casual.
 */
export const DEFAULT_STYLES: Record<PlatformId, ContentStyle> = {
  linkedin: 'professional',
  x: 'casual',
  threads: 'casual',
  facebook: 'casual',
  instagram: 'casual',
  youtube: 'casual'
}

export function isContentStyle(value: unknown): value is ContentStyle {
  return (
    typeof value === 'string' &&
    (CONTENT_STYLES as readonly string[]).includes(value)
  )
}

/** Written for followers (casual or fun) rather than as expertise. */
export const isCasualStyle = (style: ContentStyle): style is 'casual' | 'fun' =>
  style !== 'professional'

/**
 * Whether a set of platforms is all professional, all casual or fun, or a
 * mix. Ideas, goals and research follow it: an identity that is fun on every
 * platform gets content ideas, one that is professional everywhere gets the
 * editorial ones it always had, and a mix gets both.
 */
export type StyleMix = 'professional' | 'casual' | 'mixed'

export function mixOf(styles: ContentStyle[]): StyleMix {
  if (styles.length === 0) return 'professional'
  const casual = styles.filter(isCasualStyle).length
  if (casual === 0) return 'professional'
  return casual === styles.length ? 'casual' : 'mixed'
}

/**
 * The formats a platform starts with when it is picked during setup: its
 * main post. More are turned on under Preferences.
 */
export const STARTING_FORMATS: Record<PlatformId, FormatId[]> = {
  linkedin: ['linkedin.post'],
  x: ['x.post'],
  threads: ['threads.post'],
  facebook: ['facebook.post'],
  instagram: ['instagram.caption'],
  youtube: ['youtube.short']
}
