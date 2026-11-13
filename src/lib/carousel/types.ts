import { ICON_NAMES, type IconName } from '@/lib/media/canvas/icon-names'

/**
 * A carousel post's slides: what each one says and how it is designed. The
 * slides are kept apart from the post's caption (post_drafts.hook/body/cta),
 * in `post_slides`, so the caption and every slide are edited on their own
 * and a slide never carries the caption's text.
 *
 * Pure data and functions: imported by server code, tests and the browser.
 */

export const SLIDE_ROLES = ['cover', 'content', 'cta'] as const
export type SlideRole = (typeof SLIDE_ROLES)[number]

/**
 * How a slide is laid out:
 *
 *   cover      the first slide: the carousel's promise, large, over its
 *              picture when it has one
 *   statement  one point, its headline large with the body under it
 *   icon       an icon tile above the headline and body
 *   stat       one figure from the evidence, very large, with what it means
 *   list       the headline over two to four short points (one per body line)
 *   quote      the body as a pull quote, the headline as who said it or why
 *   photo      a picture across the top half, the text under it
 *   cta        the last slide: the ask, with the logo and website
 */
export const SLIDE_LAYOUTS = [
  'cover',
  'statement',
  'icon',
  'stat',
  'list',
  'quote',
  'photo',
  'cta'
] as const
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number]

/** The layouts a content slide (not the first or last) may use. */
export const CONTENT_LAYOUTS = [
  'statement',
  'icon',
  'stat',
  'list',
  'quote',
  'photo'
] as const satisfies readonly SlideLayout[]

/** The layouts that carry a generated picture when the slide has one. */
export const PICTURE_LAYOUTS: readonly SlideLayout[] = ['cover', 'photo']

export const SLIDE_LAYOUT_LABELS: Record<SlideLayout, string> = {
  cover: 'Cover',
  statement: 'Statement',
  icon: 'Icon',
  stat: 'Big number',
  list: 'List',
  quote: 'Quote',
  photo: 'Photo',
  cta: 'Call to action'
}

export interface SlideDesign {
  layout: SlideLayout
  /** The icon an `icon` slide shows (lucide's name, from ICON_NAMES). */
  icon?: IconName | null
  /** A `stat` slide's figure, e.g. "43%", taken from the evidence only. */
  stat?: string | null
  /** Words or short phrases of the headline set in the accent colour. */
  emphasis?: string[]
  /**
   * A generated picture is part of this slide, made from its imagePrompt.
   * Only cover and photo slides show one.
   */
  picture?: boolean
}

/** What one slide says and how it looks, before it is drawn. */
export interface SlideContent {
  role: SlideRole
  /** A few words, large on the slide. */
  headline: string
  /** One or two short sentences; a list slide's points, one per line. */
  body: string
  /**
   * The picture this slide would show, for the image model: a concrete
   * scene, no text in it. Written for every slide, so a picture can be
   * added to any slide later.
   */
  imagePrompt: string
  design: SlideDesign
  /** The slide described for screen readers. */
  altText: string
}

/** A slide as it is stored and shown, with its number and rendered image. */
export interface SlideView extends SlideContent {
  id: string
  /** 1-based, in the order the slides are swiped. */
  position: number
  /** A link the browser can load; null until the slide is drawn. */
  imageUrl: string | null
  /** The slide has a generated picture drawn into it. */
  hasPicture: boolean
  status: SlideRenderStatus
  /** Why the slide could not be drawn, or what is wrong with its picture. */
  error: string | null
  issues: string[]
}

export const SLIDE_RENDER_STATUSES = ['ready', 'failed'] as const
export type SlideRenderStatus = (typeof SLIDE_RENDER_STATUSES)[number]

/**
 * Lengths a slide is held to. Slides are read in a second or two while
 * swiping: a headline of a few words and a body of a sentence or two. The
 * renderer fits text up to the hard limits; the soft ones are what the
 * writer aims for and what the checks warn past.
 */
export const SLIDE_TEXT = {
  headline: { soft: 60, hard: 90 },
  body: { soft: 200, hard: 320 },
  imagePrompt: { hard: 600 },
  stat: { hard: 12 },
  listPoints: { min: 2, max: 4 },
  emphasis: { max: 3 }
} as const

/**
 * Generated pictures in one carousel when it is first made: the cover's and
 * at most one more. Every picture is an image-model call and a vision check
 * (about $0.05–0.13 each); the other slides are drawn by code in the brand's
 * colours. The reviewer can add a picture to any slide.
 */
export const MAX_DRAFT_PICTURES = 2

export const isSlideLayout = (value: unknown): value is SlideLayout =>
  typeof value === 'string' &&
  (SLIDE_LAYOUTS as readonly string[]).includes(value)

export const isSlideRole = (value: unknown): value is SlideRole =>
  typeof value === 'string' &&
  (SLIDE_ROLES as readonly string[]).includes(value)

export const isIconName = (value: unknown): value is IconName =>
  typeof value === 'string' && (ICON_NAMES as readonly string[]).includes(value)

/** A list slide's points: its body's non-empty lines, without bullet marks. */
export function listPoints(body: string): string[] {
  return body
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*•·–]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

/** The layout a slide in `role` falls back to when its own does not fit it. */
export function layoutForRole(role: SlideRole, layout: unknown): SlideLayout {
  if (role === 'cover') return 'cover'
  if (role === 'cta') return 'cta'
  return (CONTENT_LAYOUTS as readonly unknown[]).includes(layout)
    ? (layout as SlideLayout)
    : 'statement'
}

/**
 * A design read back from storage or a request, with anything that does not
 * fit its role or layout dropped: an icon only on an icon slide, a figure
 * only on a stat slide, a picture only where a layout shows one.
 */
export function cleanDesign(role: SlideRole, value: unknown): SlideDesign {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const layout = layoutForRole(role, raw.layout)
  const emphasis = Array.isArray(raw.emphasis)
    ? raw.emphasis
        .filter((w): w is string => typeof w === 'string' && Boolean(w.trim()))
        .map(w => w.trim())
        .slice(0, SLIDE_TEXT.emphasis.max)
    : []
  const stat =
    layout === 'stat' && typeof raw.stat === 'string' && raw.stat.trim()
      ? raw.stat.trim().slice(0, SLIDE_TEXT.stat.hard)
      : null
  return {
    layout: layout === 'stat' && !stat ? 'statement' : layout,
    icon: layout === 'icon' && isIconName(raw.icon) ? raw.icon : null,
    stat,
    emphasis,
    picture: PICTURE_LAYOUTS.includes(layout) && raw.picture === true
  }
}

/** The text a slide shows, for checks that compare it with the caption. */
export const slideText = (slide: Pick<SlideContent, 'headline' | 'body'>) =>
  [slide.headline, slide.body].filter(Boolean).join('\n')
