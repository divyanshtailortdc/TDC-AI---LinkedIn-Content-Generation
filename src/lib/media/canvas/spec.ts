import type { BackgroundPattern } from '~/lib/brand/theme'
import type { IconName } from './icon-names'
import type { CanvasPalette } from './palette'

/**
 * What one image is made of, before it is drawn. Every generated image has
 * the same layout: a text column on the left (logo, tagline, headline with
 * highlighted words, subheadline, website) and a visual on the right (a
 * diagram drawn from labelled nodes, or an illustration from the image model
 * with labelled badges over it), on a light patterned background.
 *
 * Pure, so the layout rules are testable without rendering.
 */

/** LinkedIn's 1.91:1 feed ratio at ~1.7x 1200x627, so it stays sharp after recompression. */
export const CANVAS_SIZE = { width: 2048, height: 1072 } as const

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
      kind: 'illustration'
      /** PNG, VISUAL_PANEL-sized or larger; transparent where it was white. */
      image: Buffer
      /** True when its background could not be cut away; it is shown as a card. */
      framed: boolean
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
  pattern: BackgroundPattern
  logo: CanvasLogo | null
  /** Set in the logo's place when the logo is on but none was uploaded. */
  wordmark?: string | null
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
