import type { IconName } from './icon-names'
import { CANVAS_SIZE } from './spec'

/**
 * A reference image's structure, as the art director read it: every element
 * it has (title, cards, stats, pills, list lines, icons, shapes, lines, an
 * image area…) as a box in percentages of the image, back to front, with its
 * shape, fill, shadow, text size and weight, plus its arrows. The renderer
 * draws the same boxes in the same places, at the reference's own shape,
 * with the post's words and the brand's colours, so a new image is built
 * like the reference rather than like the nearest built-in layout.
 *
 * Pure, so the placing and fitting rules are testable without rendering.
 */

export const BLUEPRINT_ROLES = [
  'logo',
  'tagline',
  'headline',
  'text',
  'footer',
  'label',
  'card',
  'stat',
  'pill',
  'bullet',
  'button',
  'icon',
  'image',
  'shape',
  'divider',
  'panel'
] as const
export type BlueprintRole = (typeof BLUEPRINT_ROLES)[number]

export const BLUEPRINT_TONES = [
  'primary',
  'accent',
  'dark',
  'soft',
  'surface',
  'outline',
  'none'
] as const
export type BlueprintTone = (typeof BLUEPRINT_TONES)[number]

export const BLUEPRINT_SHAPES = ['rect', 'rounded', 'pill', 'circle'] as const
export type BlueprintShape = (typeof BLUEPRINT_SHAPES)[number]

export const BLUEPRINT_ALIGNS = ['left', 'center', 'right'] as const
export type BlueprintAlign = (typeof BLUEPRINT_ALIGNS)[number]

export const BLUEPRINT_WEIGHTS = ['regular', 'medium', 'bold'] as const
export type BlueprintWeight = (typeof BLUEPRINT_WEIGHTS)[number]

export const BLUEPRINT_TEXT_COLORS = [
  'default',
  'primary',
  'accent',
  'muted'
] as const
export type BlueprintTextColor = (typeof BLUEPRINT_TEXT_COLORS)[number]

export const BLUEPRINT_ICON_PLACEMENTS = ['auto', 'top', 'left'] as const
export type BlueprintIconPlacement = (typeof BLUEPRINT_ICON_PLACEMENTS)[number]

export const BLUEPRINT_ARROW_STYLES = ['arrow', 'line', 'dashed'] as const
export type BlueprintArrowStyle = (typeof BLUEPRINT_ARROW_STYLES)[number]

export interface BlueprintBlock {
  role: BlueprintRole
  /** Left, top, width and height, as percentages of the image. */
  x: number
  y: number
  w: number
  h: number
  /** The words of a label, card, stat, pill, bullet or button. */
  text: string
  detail: string
  icon: IconName | null
  shape: BlueprintShape
  tone: BlueprintTone
  /** Casts a shadow in the reference. */
  elevated: boolean
  align: BlueprintAlign
  /** One line of its main text, as a percentage of the image height; 0 to fit. */
  textSize: number
  weight: BlueprintWeight
  textColor: BlueprintTextColor
  /** A card's icon above its words or beside them. */
  iconPlacement: BlueprintIconPlacement
}

export interface BlueprintArrow {
  /** Indexes into the blocks. */
  from: number
  to: number
  style: BlueprintArrowStyle
}

export interface Blueprint {
  blocks: BlueprintBlock[]
  arrows: BlueprintArrow[]
}

/** A block on the canvas, in pixels. */
export interface PlacedBlock
  extends Omit<BlueprintBlock, 'x' | 'y' | 'w' | 'h'> {
  left: number
  top: number
  width: number
  height: number
  /** The filled panel the block sits on, so its text reads on that. */
  backdrop: BlueprintTone | null
}

export interface PlacedBlueprint {
  blocks: PlacedBlock[]
  arrows: BlueprintArrow[]
}

export interface CanvasSize {
  width: number
  height: number
}

/**
 * The shapes a blueprint is drawn at: LinkedIn's three feed shapes, at about
 * 1.5x LinkedIn's own sizes and in multiples of 16 for the image models.
 */
export const BLUEPRINT_SIZES: readonly CanvasSize[] = [
  CANVAS_SIZE, // 1.91:1
  { width: 1600, height: 1600 }, // 1:1
  { width: 1536, height: 1920 } // 4:5, the tallest the feed shows whole
]

/** The feed shape closest to the reference's, so its proportions survive. */
export function canvasSizeFor(reference: CanvasSize): CanvasSize {
  const ratio = Math.log(reference.width / reference.height)
  return BLUEPRINT_SIZES.reduce((best, size) =>
    Math.abs(Math.log(size.width / size.height) - ratio) <
    Math.abs(Math.log(best.width / best.height) - ratio)
      ? size
      : best
  )
}

export const MAX_BLUEPRINT_BLOCKS = 40
const MAX_ARROWS = 16

/** Filled from the brief's copy or the brand: one of each. */
const SINGLE_ROLES = new Set<BlueprintRole>([
  'logo',
  'tagline',
  'headline',
  'text',
  'footer'
])

/** The longest text each kind of block carries, in characters. */
const TEXT_LIMITS: Partial<Record<BlueprintRole, number>> = {
  label: 48,
  card: 48,
  stat: 14,
  pill: 32,
  bullet: 80,
  button: 32
}
const DETAIL_MAX_CHARS = 64

/** What a refinement may add: nothing that carries words. */
const DECORATIVE_ROLES = new Set<BlueprintRole>([
  'shape',
  'divider',
  'icon',
  'panel'
])

/** Where a logo or website goes when the reference has none, in percent. */
const ADDED_SIZE = {
  logo: { w: 15, h: 8 },
  footer: { w: 24, h: 5 }
} as const
const CORNER_MARGIN = 4
const CORNERS = {
  logo: ['top_left', 'top_right', 'bottom_left', 'bottom_right'],
  footer: ['bottom_left', 'bottom_right', 'top_right', 'top_left']
} as const

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

type Box = Pick<BlueprintBlock, 'x' | 'y' | 'w' | 'h'>

const overlapArea = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/**
 * A box for the logo or website that covers none of the other blocks. A
 * corner is tried first, at any size, before anywhere along the top or
 * bottom edge, and those before the sides; within each, full size before
 * smaller and some clearance before none. Bands and backgrounds that span
 * the image do not count, since a logo may sit on them; a card-like panel
 * does. Failing all of those, the spot that covers the least.
 */
function spotFor(
  kind: 'logo' | 'footer',
  blocks: BlueprintBlock[]
): { box: Box; overlap: number } {
  const solid = blocks.filter(
    b => b.role !== 'panel' || (b.w < 95 && b.h < 95)
  )
  const placesAt = (w: number, h: number): Box[][] => {
    const [leftX, rightX] = [CORNER_MARGIN, 100 - CORNER_MARGIN - w]
    const [topY, bottomY] = [CORNER_MARGIN, 100 - CORNER_MARGIN - h]
    const corners = CORNERS[kind].map(corner => ({
      x: corner.endsWith('left') ? leftX : rightX,
      y: corner.startsWith('top') ? topY : bottomY,
      w,
      h
    }))
    const edges: Box[] = []
    for (const y of kind === 'logo' ? [topY, bottomY] : [bottomY, topY]) {
      for (let x = leftX; x <= rightX; x += 1) edges.push({ x, y, w, h })
    }
    const sides: Box[] = []
    for (const x of [leftX, rightX]) {
      for (let y = topY; y <= bottomY; y += 1) sides.push({ x, y, w, h })
    }
    return [corners, edges, sides]
  }
  let best: { box: Box; overlap: number } | null = null
  for (const group of [0, 1, 2]) {
    for (const clearance of [true, false]) {
      for (const scale of [1, 0.75, 0.55]) {
        const size = ADDED_SIZE[kind]
        for (const box of placesAt(size.w * scale, size.h * scale)[group]!) {
          // So it never sits flush against a block, where there is room.
          const clear = clearance
            ? { x: box.x - 1.5, y: box.y - 1, w: box.w + 3, h: box.h + 2 }
            : box
          const overlap = solid.reduce((sum, b) => sum + overlapArea(clear, b), 0)
          if (overlap === 0) return { box, overlap }
          if (!best || overlap < best.overlap) best = { box, overlap }
        }
      }
    }
  }
  return best!
}

const CHIP_GAP = 1

const sameRow = (a: Box, b: Box) =>
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0

/** The width a pill or button needs for its words at a readable size, in percent. */
function chipWidth(chip: BlueprintBlock, size: CanvasSize): number {
  const height = (chip.h / 100) * size.height
  const font = Math.min(40, height * 0.52) * 0.8
  const icon = chip.role === 'pill' && chip.icon ? height * 0.64 : 0
  const px = chip.text.length * font * 0.64 + Math.min(height * 0.45, 40) * 2 + icon
  return (px / size.width) * 100
}

/**
 * Pills and buttons in a row pulled apart where the reference was measured
 * touching, then widened into the free space beside them where the post's
 * words are longer than the reference's, so they need not shrink to a
 * squint.
 */
function fitChips(blocks: BlueprintBlock[], size: CanvasSize) {
  const chips = blocks
    .filter(b => b.role === 'pill' || b.role === 'button')
    .sort((a, b) => a.x - b.x)
  for (const [i, a] of chips.entries()) {
    for (const b of chips.slice(i + 1)) {
      const overlap = a.x + a.w + CHIP_GAP - b.x
      if (!sameRow(a, b) || overlap <= 0 || overlap > Math.min(a.w, b.w) * 0.3) {
        continue
      }
      a.w -= overlap / 2
      b.x += overlap / 2
      b.w -= overlap / 2
    }
  }

  for (const chip of chips) {
    let short = chipWidth(chip, size) - chip.w
    if (short <= 0) continue
    const cx = chip.x + chip.w / 2
    const row = blocks.filter(
      o => o !== chip && o.role !== 'panel' && sameRow(o, chip)
    )
    const right = Math.min(
      100 - CORNER_MARGIN,
      ...row.filter(o => o.x + o.w / 2 > cx).map(o => o.x - CHIP_GAP)
    )
    const left = Math.max(
      CORNER_MARGIN,
      ...row.filter(o => o.x + o.w / 2 <= cx).map(o => o.x + o.w + CHIP_GAP)
    )
    // A chip on the right grows leftwards first, so it keeps its edge.
    for (const side of cx > 50 ? ['left', 'right'] : ['right', 'left']) {
      const room = side === 'left' ? chip.x - left : right - (chip.x + chip.w)
      const grow = Math.max(0, Math.min(short, room))
      if (side === 'left') chip.x -= grow
      chip.w += grow
      short -= grow
    }
  }
}

/** Blocks that are only words: they can move or narrow to clear what they run into. */
const flows = (b: BlueprintBlock) =>
  b.role === 'headline' ||
  b.role === 'tagline' ||
  b.role === 'text' ||
  b.role === 'label' ||
  b.role === 'bullet' ||
  b.role === 'footer' ||
  (b.role === 'stat' && b.tone === 'none')

/** A block under the whole image: everything sits on it. */
const coversImage = (b: Box) => b.w >= 95 && b.h >= 95

/** The share of `a` that lies within `b`. */
const shareInside = (a: Box, b: Box) => overlapArea(a, b) / Math.max(a.w * a.h, 0.0001)

/** Words kept this far, in percent, from the image's edges. */
const TEXT_MARGIN = 2.5
const TEXT_GAP = 1

const inBounds = (box: Box) =>
  box.x >= TEXT_MARGIN - 0.01 &&
  box.y >= TEXT_MARGIN - 0.01 &&
  box.x + box.w <= 100 - TEXT_MARGIN + 0.01 &&
  box.y + box.h <= 100 - TEXT_MARGIN + 0.01

/**
 * What a block of words must not overlap: any other block, whatever it is,
 * unless the words sit wholly on it (a title inside a card, a number inside
 * a circle, words on a band), which a design does on purpose.
 */
const clashesWith = (a: Box, b: Box) =>
  !coversImage(b) && shareInside(a, b) < 0.8 && overlapArea(a, b) > 0

/**
 * Words kept off the image's edges and out from under the other blocks. The
 * art director measures by eye, so a box of words can run into the element
 * beside it or start at the very edge; drawn as measured, its words end up
 * cut off or hidden. Each block of words that clashes is moved or narrowed,
 * whichever changes it least without clashing with anything else.
 */
function separateWords(blocks: BlueprintBlock[]) {
  for (const a of blocks.filter(flows)) {
    // Narrowed from the edge it crosses, so it keeps its place beside its
    // neighbours; moved in only when that would leave too little of it.
    if (a.x < TEXT_MARGIN) {
      const cut = TEXT_MARGIN - a.x
      if (a.w - cut >= a.w * 0.6) a.w -= cut
      a.x = TEXT_MARGIN
    }
    if (a.x + a.w > 100 - TEXT_MARGIN) {
      const over = a.x + a.w - (100 - TEXT_MARGIN)
      if (a.w - over >= a.w * 0.6) a.w -= over
      else a.x = 100 - TEXT_MARGIN - a.w
    }
    a.y = clamp(a.y, TEXT_MARGIN, Math.max(TEXT_MARGIN, 100 - TEXT_MARGIN - a.h))
    a.h = Math.min(a.h, 100 - TEXT_MARGIN - a.y)
  }

  const clashArea = (box: Box, self: BlueprintBlock) =>
    blocks.reduce(
      (sum, o) => (o !== self && clashesWith(box, o) ? sum + overlapArea(box, o) : sum),
      0
    )

  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const a of blocks.filter(flows)) {
      const b = blocks.find(o => o !== a && clashesWith(a, o))
      if (!b) continue
      const g = TEXT_GAP
      const candidates: Array<{ box: Box; cost: number }> = [
        // Moved clear, by the distance moved.
        { box: { ...a, x: b.x - g - a.w }, cost: a.x + a.w - (b.x - g) },
        { box: { ...a, x: b.x + b.w + g }, cost: b.x + b.w + g - a.x },
        { box: { ...a, y: b.y - g - a.h }, cost: a.y + a.h - (b.y - g) },
        { box: { ...a, y: b.y + b.h + g }, cost: b.y + b.h + g - a.y }
      ]
      // Narrowed or shortened clear, a little cheaper than moving, while
      // enough of the box is left for its words.
      const right = b.x - g - a.x
      if (right >= a.w * 0.5) candidates.push({ box: { ...a, w: right }, cost: (a.w - right) * 0.7 })
      const left = a.x + a.w - (b.x + b.w + g)
      if (left >= a.w * 0.5) {
        candidates.push({ box: { ...a, x: b.x + b.w + g, w: left }, cost: (a.w - left) * 0.7 })
      }
      const above = b.y - g - a.y
      if (above >= a.h * 0.6) candidates.push({ box: { ...a, h: above }, cost: (a.h - above) * 0.7 })
      const below = a.y + a.h - (b.y + b.h + g)
      if (below >= a.h * 0.6) {
        candidates.push({ box: { ...a, y: b.y + b.h + g, h: below }, cost: (a.h - below) * 0.7 })
      }
      const now = clashArea(a, a)
      const best = candidates
        .filter(c => inBounds(c.box))
        .map(c => ({ ...c, left: clashArea(c.box, a) }))
        .sort((p, q) => p.left - q.left || p.cost - q.cost)[0]
      if (best && best.left < now) {
        Object.assign(a, { x: best.box.x, y: best.box.y, w: best.box.w, h: best.box.h })
        moved = true
      }
    }
    if (!moved) break
  }
}

/** Edges of words this close, in percent, were meant to line up. */
const SNAP = 1.5

/**
 * Words meant to line up, lined up: the left edges of left-aligned blocks
 * within SNAP of each other become one edge, and the same for right edges
 * of right-aligned ones, so a column of labels starts (or ends) exactly
 * together rather than where each was measured by eye.
 */
function snapWordEdges(blocks: BlueprintBlock[]) {
  const words = blocks.filter(b => flows(b) && b.role !== 'headline' && b.role !== 'footer')
  for (const align of ['left', 'right'] as const) {
    const edge = (b: BlueprintBlock) => (align === 'left' ? b.x : b.x + b.w)
    const lined = words.filter(b => b.align === align).sort((p, q) => edge(p) - edge(q))
    let run: BlueprintBlock[] = []
    const settle = () => {
      if (run.length > 1) {
        const target = edge(run[Math.floor(run.length / 2)]!)
        for (const b of run) {
          if (align === 'left') {
            b.w += b.x - target
            b.x = target
          } else {
            b.w = target - b.x
          }
        }
      }
      run = []
    }
    for (const b of lined) {
      if (run.length && edge(b) - edge(run[0]!) > SNAP) settle()
      run.push(b)
    }
    settle()
  }
}

/** How far, in percent, a label may be from an element and still be beside it. */
const NEIGHBOUR = 10
/** The space kept between a label and the element it sits beside. */
const HUG = 2

/** The width a label's words take at the reference's text size, in percent; 0 when unknown. */
function wordsWidth(block: BlueprintBlock, size: CanvasSize): number {
  if (block.textSize <= 0) return 0
  const font = ((block.textSize / 100) * size.height) / 1.2
  const glyph = block.weight === 'bold' ? 0.64 : 0.6
  return ((block.text.length * font * glyph) / size.width) * 100
}

/**
 * A short label set beside another element, whatever its kind or shape, is
 * placed against it: a fixed gap from it, its words ending there when it is
 * on the element's left and starting there when on its right, and widened
 * into free space when its words need more room. A column of labels then
 * meets its elements evenly however the boxes were measured. Centred words,
 * titles and paragraphs are left as they are.
 */
function alignToNeighbours(blocks: BlueprintBlock[], size: CanvasSize) {
  for (const a of blocks) {
    const short = a.role === 'label' || a.role === 'bullet' || (a.role === 'stat' && flows(a))
    if (!short || a.align === 'center') continue
    const cy = a.y + a.h / 2
    // Any element in its row, except words and what the label sits inside.
    const beside = blocks.filter(
      b =>
        b !== a &&
        !flows(b) &&
        !coversImage(b) &&
        shareInside(a, b) < 0.8 &&
        cy >= b.y &&
        cy <= b.y + b.h
    )
    const nearest = (gap: (b: BlueprintBlock) => number) =>
      beside
        .filter(b => gap(b) >= -0.5 && gap(b) <= NEIGHBOUR)
        .sort((p, q) => gap(p) - gap(q))[0]
    const toRight = nearest(b => b.x - (a.x + a.w))
    const toLeft = nearest(b => a.x - (b.x + b.w))
    if (Boolean(toRight) === Boolean(toLeft)) continue

    // How far it may grow without reaching anything else in its row.
    const row = blocks.filter(
      o =>
        o !== a &&
        o !== toRight &&
        o !== toLeft &&
        !coversImage(o) &&
        shareInside(a, o) < 0.8 &&
        sameRow(o, a)
    )
    const need = wordsWidth(a, size)
    if (toRight) {
      a.align = 'right'
      const end = toRight.x - HUG
      const floor = Math.max(
        TEXT_MARGIN,
        ...row.filter(o => o.x + o.w <= a.x + 0.5).map(o => o.x + o.w + TEXT_GAP)
      )
      const start = Math.max(floor, Math.min(a.x, end - need))
      if (end - start > 1) Object.assign(a, { x: start, w: end - start })
    } else if (toLeft) {
      a.align = 'left'
      const start = toLeft.x + toLeft.w + HUG
      const ceiling = Math.min(
        100 - TEXT_MARGIN,
        ...row.filter(o => o.x >= a.x + a.w - 0.5).map(o => o.x - TEXT_GAP)
      )
      const end = Math.min(ceiling, Math.max(a.x + a.w, start + need))
      if (end - start > 1) Object.assign(a, { x: start, w: end - start })
    }
  }
}

/**
 * The blueprint as the renderer draws it: boxes kept on the canvas, blocks
 * with nothing to show dropped, one of each copy role, the logo and website
 * added in a free spot when the reference had no place for them, circles
 * kept round, and the percentages turned into pixels. Null when there is no
 * headline to build the image around, so the caller falls back to a built-in
 * layout.
 */
export function placeBlueprint(
  blueprint: Blueprint,
  options: { logo: boolean; footer: boolean; size?: CanvasSize }
): PlacedBlueprint | null {
  const size = options.size ?? CANVAS_SIZE
  const raw = blueprint.blocks || []
  // Some models answer in fractions of the image rather than percentages.
  const scale = raw.every(b => [b.x, b.y, b.w, b.h].every(n => n <= 1))
    ? 100
    : 1

  const kept: BlueprintBlock[] = []
  const indexOf = new Map<number, number>()
  const seen = new Set<BlueprintRole>()
  raw.forEach((block, i) => {
    if (kept.length >= MAX_BLUEPRINT_BLOCKS) return
    const numbers = [block.x, block.y, block.w, block.h].map(n => n * scale)
    if (!numbers.every(Number.isFinite)) return
    let role = block.role
    if (SINGLE_ROLES.has(role) && seen.has(role)) return
    if (role === 'logo' && !options.logo) return
    if (role === 'footer' && !options.footer) return
    let limit = TEXT_LIMITS[role]
    const text = limit ? clip(block.text || '', limit) : ''
    // A box the reference left without words (a ringed icon, a blank tile)
    // is still part of its structure: kept as an icon or a shape.
    if (limit && !text) {
      if (block.icon) role = 'icon'
      else if (block.tone !== 'none') role = 'shape'
      else return
      limit = undefined
    }
    if (role === 'icon' && !block.icon) return

    const x = clamp(numbers[0]!, 0, 99.5)
    const y = clamp(numbers[1]!, 0, 99.5)
    seen.add(role)
    indexOf.set(i, kept.length)
    kept.push({
      ...block,
      role,
      x,
      y,
      // Dividers are drawn as thin as the reference has them.
      w: clamp(numbers[2]!, role === 'divider' ? 0.2 : 1, 100 - x),
      h: clamp(numbers[3]!, role === 'divider' ? 0.2 : 1, 100 - y),
      text,
      detail:
        role === 'card' || role === 'stat' || role === 'label'
          ? clip(block.detail || '', DETAIL_MAX_CHARS)
          : '',
      shape: block.shape ?? 'rounded',
      elevated: Boolean(block.elevated),
      textSize: Number.isFinite(block.textSize) ? clamp(block.textSize, 0, 30) : 0,
      weight: block.weight ?? 'medium',
      textColor: block.textColor ?? 'default',
      iconPlacement: block.iconPlacement ?? 'auto'
    })
  })
  if (!seen.has('headline')) return null

  fitChips(kept, size)
  alignToNeighbours(kept, size)
  snapWordEdges(kept)
  separateWords(kept)
  // A label pulled out from under an icon now sits beside it.
  alignToNeighbours(kept, size)
  if (options.logo && !seen.has('logo')) {
    kept.push(added('logo', spotFor('logo', kept).box))
  }
  if (options.footer && !seen.has('footer')) {
    // A website over another block is worse than none.
    const spot = spotFor('footer', kept)
    if (spot.overlap === 0) kept.push(added('footer', spot.box))
  }

  const arrows: BlueprintArrow[] = []
  for (const arrow of blueprint.arrows || []) {
    const from = indexOf.get(arrow.from)
    const to = indexOf.get(arrow.to)
    if (from === undefined || to === undefined || from === to) continue
    if (arrows.some(a => a.from === from && a.to === to)) continue
    if (arrows.length < MAX_ARROWS) {
      arrows.push({ from, to, style: arrow.style ?? 'arrow' })
    }
  }

  // The front-most filled panel or shape under a block's centre.
  const backdropOf = (block: BlueprintBlock) => {
    if (block.role === 'panel') return null
    const cx = block.x + block.w / 2
    const cy = block.y + block.h / 2
    const under = kept.filter(
      p =>
        p !== block &&
        (p.role === 'panel' || p.role === 'shape') &&
        p.tone !== 'none' &&
        p.tone !== 'outline' &&
        cx >= p.x &&
        cx <= p.x + p.w &&
        cy >= p.y &&
        cy <= p.y + p.h
    )
    return under.at(-1)?.tone ?? null
  }

  return {
    blocks: kept.map(block => {
      const { x, y, w, h, ...rest } = block
      let left = (x / 100) * size.width
      let top = (y / 100) * size.height
      let width = (w / 100) * size.width
      let height = (h / 100) * size.height
      // A circle stays a circle however the reference's shape was snapped.
      if (block.shape === 'circle') {
        const side = Math.min(width, height)
        left += (width - side) / 2
        top += (height - side) / 2
        width = height = side
      }
      return {
        ...rest,
        backdrop: backdropOf(block),
        left: Math.round(left),
        top: Math.round(top),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height))
      }
    }),
    arrows
  }
}

const added = (role: 'logo' | 'footer', box: Box): BlueprintBlock => ({
  role,
  ...box,
  text: '',
  detail: '',
  icon: null,
  shape: 'rect',
  tone: 'none',
  elevated: false,
  align: 'left',
  textSize: 0,
  weight: 'medium',
  textColor: 'default',
  iconPlacement: 'auto'
})

/**
 * A blueprint corrected against a render of itself. The geometry and styling
 * of each block come from the correction; its role and words never do, so a
 * second look cannot change what the image says. New blocks are kept only
 * when they carry no words, and only after the existing ones, so arrow
 * indexes still point where they did.
 */
export function mergeRefinedBlueprint(
  original: Blueprint,
  refined: Blueprint
): Blueprint {
  const blocks = original.blocks.map((block, i) => {
    const r = refined.blocks?.[i]
    if (!r || r.role !== block.role) return block
    return {
      ...block,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      shape: r.shape ?? block.shape,
      tone: r.tone ?? block.tone,
      elevated: r.elevated ?? block.elevated,
      align: r.align ?? block.align,
      textSize: r.textSize ?? block.textSize,
      weight: r.weight ?? block.weight,
      textColor: r.textColor ?? block.textColor,
      iconPlacement: r.iconPlacement ?? block.iconPlacement,
      // null is the correction's answer that there is no icon here.
      icon: r.icon === undefined ? block.icon : r.icon
    }
  })
  const extra = (refined.blocks || [])
    .slice(original.blocks.length)
    .filter(b => DECORATIVE_ROLES.has(b.role))
    .map(b => ({ ...b, text: '', detail: '' }))
  // Only between the original blocks: dropping an extra shifts the indexes after it.
  const arrows = (refined.arrows?.length ? refined.arrows : original.arrows).filter(
    a => a.from >= 0 && a.to >= 0 && a.from < blocks.length && a.to < blocks.length
  )
  return { blocks: [...blocks, ...extra], arrows }
}

/** Lines `words` wrap to at `size` in `width`, by an average glyph width. */
function lineCount(
  words: string[],
  size: number,
  width: number,
  glyph: number
): number {
  const space = size * glyph * 0.55
  let lines = 1
  let used = 0
  for (const word of words) {
    const w = word.length * size * glyph
    if (used > 0 && used + space + w > width) {
      lines++
      used = w
    } else {
      used += (used > 0 ? space : 0) + w
    }
    // A word wider than the box breaks across lines.
    if (w > width) lines += Math.floor(w / width)
  }
  return lines
}

/**
 * The largest type size, in steps of 2px, at which `text` fits the box;
 * `min` when even that does not fit. `glyph` is the average character width
 * in ems: about 0.55 for Inter, more for bold or uppercase.
 */
export function fitFontSize(
  text: string,
  box: { width: number; height: number },
  options: {
    max: number
    min: number
    lineHeight?: number
    glyph?: number
    maxLines?: number
  }
): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const { max, min, lineHeight = 1.2, glyph = 0.58, maxLines } = options
  if (words.length === 0) return min
  for (let size = max; size > min; size -= 2) {
    const lines = lineCount(words, size, box.width, glyph)
    if ((!maxLines || lines <= maxLines) && lines * size * lineHeight <= box.height) {
      return size
    }
  }
  return min
}
