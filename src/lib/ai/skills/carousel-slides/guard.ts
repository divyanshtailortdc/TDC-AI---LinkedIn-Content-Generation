import {
  CAPTION_COPY_LIMIT,
  captionOnSlides,
  clampWords,
  cleanSlideText,
  figureIsSourced
} from '@/lib/carousel/checks'
import {
  cleanDesign,
  listPoints,
  MAX_DRAFT_PICTURES,
  SLIDE_TEXT,
  type SlideContent,
  type SlideRole
} from '@/lib/carousel/types'
import type { SlideOutput } from './schema'

/**
 * The model's slides as a carousel: a cover first, a call to action last,
 * content between, each slide's words fit to be drawn and its design fit to
 * its role. Pure, so the rules are testable without a model.
 */

export interface GuardOptions {
  /** Most slides the post may carry; extra content slides are dropped. */
  maxSlides: number
  /** Whether the image style draws pictures at all (not minimal graphic design). */
  pictures: boolean
  /** Where a stat slide's figure must come from: the evidence and the author's details. */
  figureSources: string
}

/** One slide from the model, cleaned for `role`. */
export function toSlide(
  raw: Partial<SlideOutput> | null | undefined,
  role: SlideRole,
  options: Pick<GuardOptions, 'pictures' | 'figureSources'>
): SlideContent {
  const headline = clampWords(
    cleanSlideText(raw?.headline),
    SLIDE_TEXT.headline.hard
  )
  let body = cleanSlideText(raw?.body, true)
  let layout = raw?.layout
  // A figure the evidence does not hold is not drawn, however large.
  const stat = cleanSlideText(raw?.stat)
  if (
    layout === 'stat' &&
    !(stat && figureIsSourced(stat, options.figureSources))
  ) {
    layout = 'statement'
  }
  if (layout === 'list') {
    const points = listPoints(body).slice(0, SLIDE_TEXT.listPoints.max)
    if (points.length < SLIDE_TEXT.listPoints.min) layout = 'statement'
    else body = points.join('\n')
  }
  if (layout !== 'list') body = body.replace(/\n+/g, ' ')
  body = clampWords(body, SLIDE_TEXT.body.hard)

  const emphasis = (raw?.emphasis ?? [])
    .map(w => cleanSlideText(w))
    .filter(w => w && headline.toLowerCase().includes(w.toLowerCase()))
  const design = cleanDesign(role, {
    layout,
    icon: raw?.icon,
    stat,
    emphasis,
    picture: options.pictures && raw?.picture === true
  })
  return {
    role,
    headline,
    body,
    imagePrompt: (raw?.imagePrompt ?? '')
      .trim()
      .slice(0, SLIDE_TEXT.imagePrompt.hard),
    design,
    altText:
      (raw?.altText ?? '').trim() || [headline, body].filter(Boolean).join('. ')
  }
}

/** Throws when the model gave too little to make a carousel from. */
export class IncompleteCarouselError extends Error {}

/**
 * The model's slides as a carousel. The first is the cover and the last the
 * call to action whatever roles the model gave them; content slides past the
 * platform's limit are dropped from the middle. Pictures: the cover's when
 * the style draws pictures, and at most MAX_DRAFT_PICTURES in all.
 */
export function toCarousel(
  raw: Array<Partial<SlideOutput> | null | undefined>,
  options: GuardOptions
): SlideContent[] {
  const given = raw.filter(s => s && cleanSlideText(s.headline))
  if (given.length < 2) {
    throw new IncompleteCarouselError(
      'The model returned fewer than two slides.'
    )
  }
  const max = Math.max(2, options.maxSlides)
  const kept =
    given.length > max
      ? [...given.slice(0, max - 1), given[given.length - 1]]
      : given
  const slides = kept.map((s, i) =>
    toSlide(
      s,
      i === 0 ? 'cover' : i === kept.length - 1 ? 'cta' : 'content',
      options
    )
  )

  let pictures = 0
  for (const slide of slides) {
    const wants =
      options.pictures &&
      (slide.role === 'cover' || slide.design.picture === true) &&
      pictures < MAX_DRAFT_PICTURES
    // The cover always gets its picture when the style draws them; it is
    // what stops the scroll.
    slide.design.picture = Boolean(
      wants && (slide.role === 'cover' || slide.design.layout === 'photo')
    )
    if (slide.design.picture) pictures++
  }
  return slides
}

/** What is wrong with a carousel that the reviewer should know. */
export function carouselIssues(
  caption: string,
  slides: SlideContent[]
): string[] {
  const issues: string[] = []
  if (captionOnSlides(caption, slides) > CAPTION_COPY_LIMIT) {
    issues.push(
      'The slides repeat most of the caption; they should carry the points, the caption the context.'
    )
  }
  return issues
}
