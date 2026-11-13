import {
  canHaveImage,
  cleanFormats,
  FORMATS,
  isCreatableFormat,
  needsImage,
  isPlatformId,
  PLATFORMS,
  platformsOf
} from './registry'
import {
  DEFAULT_STYLES,
  isCasualStyle,
  isContentStyle,
  isEmojiLevel,
  type ContentStyle,
  type EmojiLevel
} from './styles'
import {
  DEFAULT_FORMAT,
  PLATFORM_IDS,
  type FormatId,
  type PlatformId
} from './types'

/**
 * What an identity has said about each platform it posts on, saved in
 * `preferences.channel_settings`. LinkedIn takes its audience, tone and emoji
 * from the identity's profile and voice, so its entry holds only its style.
 */
export type ChannelNote = {
  /** Who follows the identity on this platform, in its own words. */
  audience?: string
  /** How the identity sounds here, beyond its core voice. */
  tone?: string
  /** Professional, casual or fun; absent means the platform's default. */
  style?: ContentStyle
  /** How freely posts here use emoji; absent follows the style (emojiOf). */
  emoji?: EmojiLevel
  /**
   * How the identity writes here, learned from its own posts on this
   * platform (learnPlatformStyle). Only that action writes it.
   */
  rubric?: string
}
export type ChannelSettings = Partial<Record<PlatformId, ChannelNote>>

export interface ResolvedChannels {
  /** The formats this identity drafts, in registry order; never empty. */
  enabledFormats: FormatId[]
  /** The platforms of those formats. */
  platforms: PlatformId[]
  settings: ChannelSettings
}

const NOTE_LIMIT = 2000
/** Longest learned style kept for a platform. */
export const RUBRIC_LIMIT = 3000

const note = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, NOTE_LIMIT)
    : undefined

/** Reads saved channel settings, dropping unknown platforms and blank notes. */
export function cleanChannelSettings(value: unknown): ChannelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ChannelSettings = {}
  for (const [platform, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isPlatformId(platform)) continue
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const style = isContentStyle(entry.style) ? entry.style : undefined
    const cleaned: ChannelNote =
      platform === 'linkedin'
        ? { style }
        : {
            audience: note(entry.audience),
            tone: note(entry.tone),
            style,
            emoji: isEmojiLevel(entry.emoji) ? entry.emoji : undefined,
            rubric:
              typeof entry.rubric === 'string' && entry.rubric.trim()
                ? entry.rubric.trim().slice(0, RUBRIC_LIMIT)
                : undefined
          }
    // Keys left undefined are dropped, so a saved entry holds only what was said.
    const kept = Object.fromEntries(
      Object.entries(cleaned).filter(([, value]) => value !== undefined)
    ) as ChannelNote
    if (Object.keys(kept).length > 0) out[platform] = kept
  }
  return out
}

/** How posts on this platform should sound: the identity's pick, else its default. */
export function styleOf(settings: ChannelSettings, platform: PlatformId): ContentStyle {
  return settings[platform]?.style ?? DEFAULT_STYLES[platform]
}

/**
 * How freely a platform uses emoji until the identity picks: the voice's
 * level on LinkedIn and professional platforms, freely on casual and fun ones.
 * The voice's level is usually learned from LinkedIn posts, and would keep
 * emoji out of a fun Instagram caption.
 */
export function defaultEmojiOf(
  settings: ChannelSettings,
  platform: PlatformId,
  voiceLevel: EmojiLevel
): EmojiLevel {
  if (platform === 'linkedin') return voiceLevel
  return isCasualStyle(styleOf(settings, platform)) ? 'liberal' : voiceLevel
}

/** How freely posts on this platform use emoji: the identity's pick, else the default. */
export function emojiOf(
  settings: ChannelSettings,
  platform: PlatformId,
  voiceLevel: EmojiLevel
): EmojiLevel {
  if (platform === 'linkedin') return voiceLevel
  return settings[platform]?.emoji ?? defaultEmojiOf(settings, platform, voiceLevel)
}

/**
 * The platforms a goal's posts go on, from its saved list: known ones, once
 * each, in registry order. Empty means every platform the identity posts on.
 */
export function cleanGoalPlatforms(value: unknown): PlatformId[] {
  if (!Array.isArray(value)) return []
  return PLATFORM_IDS.filter(p => value.includes(p))
}

/** Whether posts for this goal may go on `platform`. */
export function goalServes(
  goal: { platforms?: unknown },
  platform: PlatformId
): boolean {
  const own = cleanGoalPlatforms(goal.platforms)
  return own.length === 0 || own.includes(platform)
}

/** Where a goal's posts go, as a tag: "LinkedIn only", "LinkedIn, X"; null for every platform. */
export function goalPlatformsLabel(value: unknown): string | null {
  const own = cleanGoalPlatforms(value)
  if (own.length === 0) return null
  const labels = own.map(p => PLATFORMS[p].label)
  return labels.length === 1 ? `${labels[0]} only` : labels.join(', ')
}

export function resolveChannels(
  row:
    | { enabledFormats?: unknown; channelSettings?: unknown }
    | null
    | undefined
): ResolvedChannels {
  // A format that can no longer be created, turned on before, is dropped here, so
  // ideation, Preferences and Add a version never see it.
  const enabled = cleanFormats(row?.enabledFormats).filter(isCreatableFormat)
  const enabledFormats = enabled.length > 0 ? enabled : [DEFAULT_FORMAT]
  return {
    enabledFormats,
    platforms: platformsOf(enabledFormats),
    settings: cleanChannelSettings(row?.channelSettings)
  }
}

/**
 * The formats to draft for an idea: the ones chosen for it, else the ones it
 * suits, else LinkedIn. Only formats the registry knows; an idea saved before
 * formats existed drafts LinkedIn, as it always did.
 */
export function formatsToDraft(idea: {
  targetFormats?: unknown
  formatFit?: unknown
}): FormatId[] {
  // Only formats that can still be created: an older idea aimed at a Reel or
  // a Short drafts its other formats, or LinkedIn.
  const chosen = cleanFormats(idea.targetFormats).filter(isCreatableFormat)
  if (chosen.length > 0) return chosen
  const fit = cleanFormats(idea.formatFit).filter(isCreatableFormat)
  return fit.length > 0 ? fit : [DEFAULT_FORMAT]
}

/**
 * Whether drafting makes an image for an idea's post in `formatId`, as chosen
 * in Create posts ("Add an image", kept in suggestedMedia.imageFormats). A
 * format that needs one always gets one and a video script never does.
 * Undefined when nothing was chosen (an idea from before the choice): the
 * caller's own default applies.
 */
export function imageChosenFor(
  idea: { suggestedMedia?: unknown },
  formatId: FormatId
): boolean | undefined {
  if (!canHaveImage(formatId)) return false
  if (needsImage(formatId)) return true
  const chosen = (idea.suggestedMedia as { imageFormats?: unknown } | null)
    ?.imageFormats
  return Array.isArray(chosen) ? chosen.includes(formatId) : undefined
}

/**
 * The formats an idea from a run should start out targeting: for a run aimed
 * at one platform, that platform's enabled formats; otherwise the enabled
 * formats the idea suits, or every enabled format when it named none. Only
 * the platforms of the idea's goal count, unless the identity no longer posts
 * on any of them.
 */
export function initialTargetFormats(options: {
  enabled: FormatId[]
  fit: FormatId[]
  channel?: PlatformId | null
  /** The platforms of the idea's main goal; empty or absent is every platform. */
  goalPlatforms?: PlatformId[]
}): FormatId[] {
  const enabled = options.channel
    ? options.enabled.filter(f => FORMATS[f].platform === options.channel)
    : options.enabled
  const goalPlatforms = options.goalPlatforms ?? []
  const forGoal =
    goalPlatforms.length > 0
      ? enabled.filter(f => goalPlatforms.includes(FORMATS[f].platform))
      : enabled
  const pool = forGoal.length > 0 ? forGoal : enabled
  const suited = pool.filter(f => options.fit.includes(f))
  if (suited.length > 0) return suited
  if (pool.length > 0) return options.channel ? pool : [pool[0]!]
  return [DEFAULT_FORMAT]
}
