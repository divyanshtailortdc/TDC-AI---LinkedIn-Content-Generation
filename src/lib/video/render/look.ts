import { normalizeHex } from '@/lib/brand/theme'
import type { PlatformId } from '@/lib/platforms'
import type { ProfileInsights } from '@/lib/profile-insights/types'

/**
 * How a recorded video looks, matched to the identity's own posts: which of
 * the recorder's templates, which colours, how words are set and how quickly
 * slides move. Chosen once per platform by the video-look skill from the
 * profile's analysis and its example images (src/lib/video/look-source.ts),
 * and stored with each video. Pure: tests read it.
 */

export const VIDEO_TEMPLATES = ['cards', 'bold', 'minimal', 'photo'] as const
export type VideoTemplate = (typeof VIDEO_TEMPLATES)[number]

/**
 * How a video is built, after how their recent posts are built: the
 * template is its colours, the format its structure.
 * slides: title cards, numbered slides under story bars, fades (carousels,
 * tips, lists). kinetic: huge words that pop in one by one, hard cuts, no
 * cards (punchy, energetic text posts). meme: a band of casual text over
 * one of their photos, hard cuts (memes, trend riffs). poster: each slide a
 * designed graphic with a framed photo and a contact bar, pushed in
 * (branded graphics, announcements, infographics). editorial: centred quiet
 * words between thin rules, slow fades (quotes, premium, editorial).
 */
export const VIDEO_FORMATS = [
  'slides',
  'kinetic',
  'meme',
  'poster',
  'editorial'
] as const
export type VideoFormat = (typeof VIDEO_FORMATS)[number]

/** How key words stand out: a marker box, the accent colour, or not at all. */
export const VIDEO_HIGHLIGHTS = ['none', 'marker', 'color'] as const
export type VideoHighlight = (typeof VIDEO_HIGHLIGHTS)[number]

export interface VideoLook {
  /** The video's structure (VIDEO_FORMATS); slides when nothing is known. */
  format: VideoFormat
  /**
   * cards: deep title cards, light slides (the look with no analysis).
   * bold: dark slides, big bright words. minimal: light cards and slides.
   * photo: their own photos behind the words.
   */
  template: VideoTemplate
  /** From their posts; null to keep the brand's. Made readable on use. */
  colors: { background: string; text: string; accent: string } | null
  textCase: 'as_written' | 'upper'
  /** The caption line in a box, or as plain subtitles. */
  captions: 'badge' | 'subtitles'
  pace: 'quick' | 'steady' | 'calm'
  /** How key words (numbers, else the closing words) stand out. */
  highlight: VideoHighlight
  /**
   * The example images that are their photos and sit well behind words, by
   * 0-based index, best first: shown behind the slides of the photo template.
   */
  photos: number[]
  /** One sentence: what in their posts led to this look. */
  reason: string
}

/** The look of a video for an identity nothing is known about. */
export const DEFAULT_VIDEO_LOOK: VideoLook = {
  format: 'slides',
  template: 'cards',
  colors: null,
  textCase: 'as_written',
  captions: 'badge',
  pace: 'steady',
  highlight: 'none',
  photos: [],
  reason: ''
}

/** Most example images shown behind a video's slides. */
export const MAX_VIDEO_PHOTOS = 6

const oneOf = <T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T
): T => (options.includes(value as T) ? (value as T) : fallback)

/**
 * The skill's answer made safe to use: known values only, real hex colours
 * (all three or none), photos that exist, and a photo template or a meme
 * only with a photo to show (a meme without one is kinetic type).
 * `imageCount` is how many images the skill was shown.
 */
export function cleanVideoLook(raw: unknown, imageCount: number): VideoLook {
  const value = (raw ?? {}) as Record<string, unknown>
  const colorsIn = (value.colors ?? null) as Record<string, unknown> | null
  const hexes = colorsIn
    ? [colorsIn.background, colorsIn.text, colorsIn.accent].map(c =>
        typeof c === 'string' ? normalizeHex(c) : null
      )
    : []
  const colors =
    hexes.length === 3 && hexes.every(Boolean)
      ? { background: hexes[0]!, text: hexes[1]!, accent: hexes[2]! }
      : null
  // The skill numbers images from 1, as it saw them.
  const photos = Array.isArray(value.photos)
    ? [
        ...new Set(
          value.photos
            .map(n => Number(n) - 1)
            .filter(i => Number.isInteger(i) && i >= 0 && i < imageCount)
        )
      ].slice(0, MAX_VIDEO_PHOTOS)
    : []
  const template = oneOf(VIDEO_TEMPLATES, value.template, 'cards')
  const format = oneOf(VIDEO_FORMATS, value.format, 'slides')
  return {
    format: format === 'meme' && photos.length === 0 ? 'kinetic' : format,
    template: template === 'photo' && photos.length === 0 ? 'cards' : template,
    colors,
    textCase: oneOf(
      ['as_written', 'upper'] as const,
      value.textCase,
      'as_written'
    ),
    captions: oneOf(['badge', 'subtitles'] as const, value.captions, 'badge'),
    pace: oneOf(['quick', 'steady', 'calm'] as const, value.pace, 'steady'),
    highlight: oneOf(VIDEO_HIGHLIGHTS, value.highlight, 'none'),
    photos,
    reason:
      typeof value.reason === 'string' ? value.reason.trim().slice(0, 300) : ''
  }
}

/** A look read back from a video's stored metadata; null when it is not one. */
export function storedVideoLook(value: unknown): VideoLook | null {
  if (!value || typeof value !== 'object') return null
  const look = value as Partial<VideoLook>
  if (!VIDEO_TEMPLATES.includes(look.template as VideoTemplate)) return null
  // Stored photo indexes are 0-based already; clean them as 1-based.
  return cleanVideoLook(
    { ...look, photos: (look.photos ?? []).map(i => Number(i) + 1) },
    MAX_VIDEO_PHOTOS
  )
}

/**
 * The look with the Brand Theme's own choice laid over it: an image style
 * set there (rather than "Like my posts") decides the template where a
 * video has one to match. Minimal Graphic Design makes it minimal;
 * Photorealistic shows their photos when there are any. Illustration and 3D
 * have no video kind, so the look from their posts stays.
 */
export function brandedLook(
  look: VideoLook,
  imageStyle: string | null | undefined
): VideoLook {
  if (imageStyle === 'minimal_graphic') return { ...look, template: 'minimal' }
  if (imageStyle === 'photorealistic' && look.photos.length > 0)
    return { ...look, template: 'photo' }
  return look
}

/**
 * How a format plays: whether the hook and the call to action sit on title
 * cards with fades between slides, or are slides themselves with hard cuts;
 * and whether a slide's caption line is part of its layout rather than
 * drawn over it.
 */
export function formatRhythm(format: VideoFormat): {
  cards: boolean
  cuts: boolean
  captionInPage: boolean
} {
  const cards = format === 'slides' || format === 'editorial'
  return {
    cards,
    cuts: !cards,
    captionInPage: format !== 'slides' && format !== 'meme'
  }
}

/** How much longer or shorter slides stay up at each pace. */
export const PACE_FACTOR: Record<VideoLook['pace'], number> = {
  quick: 0.85,
  steady: 1,
  calm: 1.15
}

/**
 * Where a video's reference comes from: the analysis of the platform it is
 * for, else the account's nearest short-video platform (YouTube is never
 * analyzed, so a Short borrows Instagram's, then Facebook's).
 */
export function scriptInsightsSource(
  all: Partial<Record<PlatformId, ProfileInsights>> | undefined,
  platform: PlatformId
): { platform: PlatformId; insights: ProfileInsights } | null {
  const order: PlatformId[] =
    platform === 'youtube'
      ? ['instagram', 'facebook']
      : platform === 'instagram'
        ? ['instagram', 'facebook']
        : platform === 'facebook'
          ? ['facebook', 'instagram']
          : [platform]
  for (const p of order) {
    const insights = all?.[p]
    if (insights) return { platform: p, insights }
  }
  return null
}

/**
 * For the look itself any analyzed platform helps, since a brand looks alike
 * everywhere: the script's source first, then whichever describes its
 * visuals.
 */
export function lookInsightsSource(
  all: Partial<Record<PlatformId, ProfileInsights>> | undefined,
  platform: PlatformId
): { platform: PlatformId; insights: ProfileInsights } | null {
  const near = scriptInsightsSource(all, platform)
  if (near?.insights.visualIdentity) return near
  const seen = Object.entries(all ?? {}).find(
    ([, insights]) => insights?.visualIdentity
  ) as [PlatformId, ProfileInsights] | undefined
  return seen ? { platform: seen[0], insights: seen[1] } : near
}
