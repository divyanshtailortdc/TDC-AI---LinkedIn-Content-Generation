import { FORMATS } from './registry'
import {
  MEDIA_FORMATS,
  type CarouselSpec,
  type FormatId,
  type MediaFormat
} from './types'

/**
 * What goes out with a post's text, worked out from its format, what was
 * chosen for it and what it has. Pure: used by drafting, the checks, the
 * review screen and publishing alike, so they agree on what a post is.
 */

export const MEDIA_FORMAT_LABELS: Record<MediaFormat, string> = {
  text: 'Text only',
  image: 'Single image',
  carousel: 'Carousel',
  video: 'Reel / short video'
}

export const MEDIA_FORMAT_HINTS: Record<MediaFormat, string> = {
  text: 'The caption goes out on its own.',
  image: 'The caption with one image.',
  carousel: 'The caption with slides to swipe through.',
  video: 'A script to film, posted with its caption.'
}

export function isMediaFormat(value: unknown): value is MediaFormat {
  return (
    typeof value === 'string' &&
    (MEDIA_FORMATS as readonly string[]).includes(value)
  )
}

/** The media formats a post in this format can go out as, its default first. */
export const mediaFormatsOf = (formatId: FormatId): readonly MediaFormat[] =>
  FORMATS[formatId].media.formats

export const supportsMediaFormat = (formatId: FormatId, media: MediaFormat) =>
  mediaFormatsOf(formatId).includes(media)

/** The format's carousel rules; null when it takes no carousel. */
export const carouselSpecOf = (formatId: FormatId): CarouselSpec | null =>
  FORMATS[formatId].media.carousel ?? null

/**
 * What a post goes out as. A video script is a video. Otherwise the choice
 * stored on it (post_drafts.media_format) when its format takes it; a post
 * without one (every post from before media formats, and new posts the
 * reviewer has not changed) follows what it has: its image, else its text
 * alone. A format that takes no text-only post (Instagram) reads as an image
 * post then, so its missing image is what the checks report.
 */
export function resolveMediaFormat(
  formatId: FormatId,
  stored: string | null | undefined,
  has: { image: boolean }
): MediaFormat {
  const formats = mediaFormatsOf(formatId)
  if (formats.includes('video')) return 'video'
  if (isMediaFormat(stored) && formats.includes(stored)) return stored
  if (has.image && formats.includes('image')) return 'image'
  return formats.includes('text') ? 'text' : formats[0]!
}

/**
 * Wording that only makes sense with several slides: "swipe", "carousel",
 * "slide 3", "these 5 slides", "the last slide". A single post that says it
 * sends readers looking for slides that are not there.
 */
const CAROUSEL_WORDING = [
  /\bswip(?:e|es|ed|ing)\b/i,
  /\bcarousels?\b/i,
  /\bslide\s*#?\d+\b/i,
  // "the next slide": ordinals name slides of a set.
  /\b(?:next|last|first|final|previous|following)\s+slides?\b/i,
  // "these 5 slides": a plural with a count or a pointer. A lone "the slide"
  // is too often prices or markets sliding.
  /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|these|the|those|my|our|all)\s+slides\b/i
]

/** The carousel wording in `text`, as written, or null when it has none. */
export function carouselWording(
  text: string | null | undefined
): string | null {
  if (!text) return null
  for (const pattern of CAROUSEL_WORDING) {
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return null
}

/**
 * Whether a visual direction or a caption asks for a carousel: the idea's
 * media brief ("a carousel of the five steps"), a post's visual idea, or a
 * caption that tells readers to swipe.
 */
export const suggestsCarousel = (text: string | null | undefined): boolean =>
  carouselWording(text) !== null

/**
 * What a new post in `formatId` should go out as, before its text is
 * written: a carousel when the format takes one and its idea's visual
 * direction asks for one, else the format's default.
 */
export function plannedMediaFormat(
  formatId: FormatId,
  idea: {
    suggestedMedia?: { brief?: string | null; format?: string | null } | null
  }
): MediaFormat {
  const formats = mediaFormatsOf(formatId)
  const media = idea.suggestedMedia
  if (
    formats.includes('carousel') &&
    (media?.format === 'carousel' || suggestsCarousel(media?.brief))
  ) {
    return 'carousel'
  }
  return formats[0]!
}

/** How many slides to write for a carousel, within the platform's own limits. */
export function slideCountRange(formatId: FormatId): {
  min: number
  max: number
} {
  const spec = carouselSpecOf(formatId)
  if (!spec) return { min: 0, max: 0 }
  return {
    min: Math.max(
      spec.minSlides,
      Math.min(spec.targetSlides.min, spec.maxSlides)
    ),
    max: Math.min(spec.maxSlides, spec.targetSlides.max)
  }
}
