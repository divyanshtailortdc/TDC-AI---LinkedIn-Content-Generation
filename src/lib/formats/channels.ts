import { cleanFormats, FORMATS, isPlatformId, platformsOf } from './registry'
import { DEFAULT_STYLES, isContentStyle, type ContentStyle } from './styles'
import { DEFAULT_FORMAT, type FormatId, type PlatformId } from './types'

/**
 * What an identity has said about each platform it posts on, saved in
 * `preferences.channel_settings`. LinkedIn takes its audience and tone from
 * the identity's profile and voice, so its entry holds only its style.
 */
export type ChannelNote = {
  /** Who follows the identity on this platform, in its own words. */
  audience?: string
  /** How the identity sounds here, beyond its core voice. */
  tone?: string
  /** Professional, casual or fun; absent means the platform's default. */
  style?: ContentStyle
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
        : { audience: note(entry.audience), tone: note(entry.tone), style }
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

export function resolveChannels(
  row:
    | { enabledFormats?: unknown; channelSettings?: unknown }
    | null
    | undefined
): ResolvedChannels {
  const enabled = cleanFormats(row?.enabledFormats)
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
  const chosen = cleanFormats(idea.targetFormats)
  if (chosen.length > 0) return chosen
  const fit = cleanFormats(idea.formatFit)
  return fit.length > 0 ? fit : [DEFAULT_FORMAT]
}

/**
 * The formats an idea from a run should start out targeting: for a run aimed
 * at one platform, that platform's enabled formats; otherwise the enabled
 * formats the idea suits, or every enabled format when it named none.
 */
export function initialTargetFormats(options: {
  enabled: FormatId[]
  fit: FormatId[]
  channel?: PlatformId | null
}): FormatId[] {
  const pool = options.channel
    ? options.enabled.filter(f => FORMATS[f].platform === options.channel)
    : options.enabled
  const suited = pool.filter(f => options.fit.includes(f))
  if (suited.length > 0) return suited
  if (pool.length > 0) return options.channel ? pool : [pool[0]!]
  return [DEFAULT_FORMAT]
}
