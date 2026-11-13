import type { CanvasPattern } from '~/lib/brand/theme'
import type { ImageShape } from '@/lib/formats'
import type { PlacedBlueprint } from './blueprint'
import type { IconName } from './icon-names'
import type { CanvasPalette } from './palette'

/**
 * What one image is made of, before it is drawn: the text (logo, tagline,
 * headline with highlighted words, subheadline, website) and a visual (a
 * diagram drawn from labelled nodes, or a picture from the image model in
 * the image style: a photograph or 3D scene filling its side, or an
 * illustration with labelled badges), on the brand's light background.
 *
 * Pure, so the layout rules are testable without rendering.
 */

/** The 1.91:1 feed ratio at ~1.7x 1200x627, so it stays sharp after recompression. */
export const CANVAS_SIZE = { width: 2048, height: 1072 } as const

/**
 * The size each post shape (src/lib/formats) is drawn and generated at:
 * about 1.4-1.7x the feed's own (1200x627, 1600x900, 1080x1350), in
 * multiples of 16 for the image models. The built-in layouts fit the same
 * square visual panel into each: beside the text when wide, under or over it
 * when tall.
 */
export const SHAPE_SIZES: Record<ImageShape, { width: number; height: number }> = {
  '1.91:1': CANVAS_SIZE,
  '16:9': { width: 2048, height: 1152 },
  '4:5': { width: 1536, height: 1920 }
}

/** The right-hand side: a square the full height of the image, 52% of its width. */
export const VISUAL_PANEL = {
  left: CANVAS_SIZE.width - CANVAS_SIZE.height,
  top: 0,
  width: CANVAS_SIZE.height,
  height: CANVAS_SIZE.height
} as const

/** The left-hand side, which holds all the text. */
export const TEXT_COLUMN = {
  left: 0,
  width: VISUAL_PANEL.left,
  padX: 104,
  padY: 88
} as const

/**
 * The size a picture is generated at for a panel: the panel's shape, 1024 to
 * 2048 px on its long edge, in the multiples of 16 the image models need. It
 * is then cropped to the panel exactly.
 */
export function pictureGenerationSize(panel: {
  width: number
  height: number
}): { width: number; height: number } {
  const long = Math.max(panel.width, panel.height)
  const scale = long < 1024 ? 1024 / long : long > 2048 ? 2048 / long : 1
  const edge = (n: number) => Math.max(256, Math.ceil((n * scale) / 16) * 16)
  return { width: edge(panel.width), height: edge(panel.height) }
}

/** A tall canvas's margin above or below the visual panel. */
export const STACK_MARGIN = 96

/** Too narrow for text and panel side by side (4:5): they are stacked. */
export const isStacked = (size: { width: number; height: number }) =>
  size.width / size.height < 1.3

/** Where top_bottom's picture band starts: just below the header's text. */
export const PICTURE_BAND_TOP = 456

/**
 * Where a photograph or 3D scene goes: the whole visual side of the layout,
 * out to the image's edges, so it reads as a photograph in an editorial
 * spread rather than a picture pasted onto a graphic. The text keeps the
 * rest, exactly where the layout always puts it.
 */
export function picturePanel(
  layout: CanvasLayout,
  size: { width: number; height: number }
): { left: number; top: number; width: number; height: number } {
  if (isStacked(size)) {
    // The text keeps its height; the picture takes the panel and its margin.
    const height = VISUAL_PANEL.height + STACK_MARGIN
    return {
      left: 0,
      top: layout === 'split_right' ? 0 : size.height - height,
      width: size.width,
      height
    }
  }
  if (layout === 'top_bottom') {
    return {
      left: 0,
      top: PICTURE_BAND_TOP,
      width: size.width,
      height: size.height - PICTURE_BAND_TOP
    }
  }
  return {
    left: layout === 'split_right' ? 0 : size.width - VISUAL_PANEL.width,
    top: 0,
    width: VISUAL_PANEL.width,
    height: size.height
  }
}

export const CANVAS_LAYOUTS = [
  'split_left',
  'split_right',
  'top_bottom',
  'centered_hero'
] as const
export type CanvasLayout = (typeof CANVAS_LAYOUTS)[number]

export const isCanvasLayout = (value: unknown): value is CanvasLayout =>
  (CANVAS_LAYOUTS as readonly unknown[]).includes(value)

/**
 * The layouts with room for a picture: centered_hero's card covers nearly
 * the whole image and has nowhere to show one.
 */
export const PICTURE_LAYOUTS = [
  'split_left',
  'split_right',
  'top_bottom'
] as const satisfies readonly CanvasLayout[]

export const DIAGRAM_FORMS = [
  'hub_spoke',
  'flow',
  'stack',
  'cards',
  'comparison'
] as const
export type DiagramForm = (typeof DIAGRAM_FORMS)[number]

export const isDiagramForm = (value: unknown): value is DiagramForm =>
  (DIAGRAM_FORMS as readonly unknown[]).includes(value)

/** A labelled point in a diagram, or a badge over an illustration. */
export interface CanvasNode {
  label: string
  icon: IconName
  /** A short second line; shown where the form has room. */
  detail?: string
}

export interface DiagramSpec {
  form: DiagramForm
  /** The centre of a hub-and-spoke diagram. */
  hub?: CanvasNode | null
  nodes: CanvasNode[]
  /** Outer satellite badges (e.g. AI agents, workflows, chat pills). */
  badges?: CanvasNode[]
  /** A comparison's two column titles; its nodes split evenly between them. */
  groups?: [string, string]
}

export interface CanvasCopy {
  /** The small category line above the headline. */
  tagline: string
  headline: string
  /** Words or short phrases of the headline set in the accent colour. */
  highlights: string[]
  subheadline: string
  /** The website or handle in the bottom-left corner. */
  footer: string | null
}

export type CanvasVisual =
  | { kind: 'diagram'; diagram: DiagramSpec }
  | {
      /** A picture from the image model, in the chosen image style. */
      kind: 'picture'
      image: Buffer
      mediaType: 'image/png' | 'image/jpeg'
      /**
       * bleed: a photograph or 3D scene filling the visual side to the
       * image's edges. cutout: an illustration whose white was made
       * transparent, standing on the background. card: one whose background
       * could not be cut away, shown as a framed card.
       */
      display: 'bleed' | 'cutout' | 'card'
      /** Labelled pills over a cutout or card; none over a bleed picture. */
      badges: CanvasNode[]
    }

export interface CanvasLogo {
  dataUrl: string
  width: number
  height: number
  /** A light logo meant for dark backgrounds gets a dark plate behind it. */
  plate: boolean
}

export interface CanvasFonts {
  heading: string
  body: string
  headingWeight: 700 | 800
}

export interface CanvasSpec {
  copy: CanvasCopy
  visual: CanvasVisual
  palette: CanvasPalette
  fonts: CanvasFonts
  pattern: CanvasPattern
  logo: CanvasLogo | null
  /** Set in the logo's place when the logo is on but none was uploaded. */
  wordmark?: string | null
  /** Layout composition: split_left, split_right, top_bottom, centered_hero */
  layout?: CanvasLayout
  /**
   * A reference image's structure; drawn instead of `layout` when set, with
   * `visual` used only for an illustration in its image block.
   */
  blueprint?: PlacedBlueprint | null
  /** The image's pixel size; CANVAS_SIZE unless a blueprint takes its reference's shape. */
  size?: { width: number; height: number }
}

/** Longest headline, in words and in characters. */
export const HEADLINE_MAX_WORDS = 10
export const HEADLINE_MAX_CHARS = 72
export const TAGLINE_MAX_CHARS = 40
export const SUBHEADLINE_MAX_CHARS = 140
export const NODE_LABEL_MAX_CHARS = 26
export const NODE_DETAIL_MAX_CHARS = 48
export const MAX_HIGHLIGHTS = 3

/** How many nodes each form has room for. */
export const NODE_LIMITS: Record<DiagramForm, { min: number; max: number }> = {
  hub_spoke: { min: 3, max: 6 },
  flow: { min: 3, max: 5 },
  stack: { min: 3, max: 5 },
  cards: { min: 2, max: 4 },
  comparison: { min: 2, max: 8 }
}

export const MAX_BADGES = 3

/** Headline size: as large as the column allows for its length. */
export function headlineFontSize(headline: string): number {
  const length = headline.trim().length
  if (length <= 24) return 100
  if (length <= 40) return 88
  if (length <= 56) return 78
  return 68
}

const normalizeWord = (word: string) =>
  word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * The headline as words, each marked when it belongs to a highlighted phrase.
 * Phrases match whole words in order, ignoring case and punctuation, so
 * "AI" never lights up the "ai" inside "maintain".
 */
export function splitHeadline(
  headline: string,
  highlights: string[]
): Array<{ text: string; highlight: boolean }> {
  const words = headline.trim().split(/\s+/).filter(Boolean)
  const marked = words.map(() => false)
  const keys = words.map(normalizeWord)
  for (const phrase of highlights) {
    const target = phrase.trim().split(/\s+/).map(normalizeWord).filter(Boolean)
    if (target.length === 0) continue
    for (let i = 0; i + target.length <= words.length; i++) {
      if (target.every((t, j) => keys[i + j] === t)) {
        for (let j = 0; j < target.length; j++) marked[i + j] = true
        break
      }
    }
  }
  return words.map((text, i) => ({ text, highlight: marked[i]! }))
}

/** The highlight phrases that actually occur in the headline, at most MAX_HIGHLIGHTS. */
export function matchedHighlights(headline: string, highlights: string[]): string[] {
  const kept: string[] = []
  for (const phrase of highlights) {
    if (kept.length >= MAX_HIGHLIGHTS) break
    const clean = phrase.trim()
    if (!clean || kept.some(k => k.toLowerCase() === clean.toLowerCase())) continue
    if (splitHeadline(headline, [clean]).some(w => w.highlight)) kept.push(clean)
  }
  return kept
}

/**
 * A diagram the renderer can draw: its nodes cut to what the form holds, a
 * hub-and-spoke without a hub drawn as cards, and a comparison without its
 * two titles drawn as cards too. Returns null when too little is left to draw.
 */
export function fitDiagram(diagram: DiagramSpec): DiagramSpec | null {
  const nodes = diagram.nodes.filter(n => n.label.trim())
  let form = diagram.form
  if (form === 'hub_spoke' && !diagram.hub?.label.trim()) form = 'cards'
  const groups = diagram.groups?.map(g => g.trim())
  if (
    form === 'comparison' &&
    (!groups || groups.length !== 2 || !groups[0] || !groups[1] || nodes.length < 2)
  ) {
    form = 'cards'
  }
  const limits = NODE_LIMITS[form]
  const kept = nodes.slice(0, limits.max)
  if (kept.length < Math.min(limits.min, 2)) return null
  return {
    form,
    hub: form === 'hub_spoke' ? diagram.hub : null,
    nodes:
      form === 'comparison' && kept.length % 2 === 1 ? kept.slice(0, -1) : kept,
    badges: diagram.badges?.filter(b => b.label.trim()),
    groups: form === 'comparison' ? (groups as [string, string]) : undefined
  }
}
