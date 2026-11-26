/**
 * Diagrams and charts in a blog, drawn from data rather than painted by an
 * image model: a flow of steps, a timeline, or a bar chart of figures from a
 * source. The data lives in the document (a `diagram` node, src/lib/blogs/
 * doc.ts), so its words are exact, editable and searchable, and every
 * renderer draws it the same way. Pure: the editor, the server and the
 * exports share it.
 */

export const DIAGRAM_KINDS = ['flow', 'timeline', 'bar'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

export const DIAGRAM_KIND_LABELS: Record<DiagramKind, string> = {
  flow: 'Steps',
  timeline: 'Timeline',
  bar: 'Bar chart'
}

/** A diagram as a document stores it. `values` and `unit` belong to bar charts. */
export type DiagramAttrs = {
  kind: DiagramKind
  title: string
  items: string[]
  values: number[]
  unit: string
  caption: string
  alt: string
  /** The source its figures come from (S1, K2…); empty when none. */
  sourceId: string
}

export const DIAGRAM_LIMITS = {
  item: 120,
  title: 120,
  unit: 12,
  caption: 300,
  alt: 300,
  minItems: 2,
  /** Steps or dates past this stop reading as one picture. */
  maxSteps: 8,
  maxBars: 10
} as const

const SOURCE_ID = /^[SK]\d{1,3}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : ''

const isDiagramKind = (value: unknown): value is DiagramKind =>
  typeof value === 'string' && (DIAGRAM_KINDS as readonly string[]).includes(value)

/** A chart value as a number: numbers, or numeric text such as "61" or "1,200". */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[,\s]/g, '').replace(/%$/, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : null
}

/**
 * A diagram's data made safe to store, or null when it does not hold
 * together: an unknown kind, too few or too many items, or a chart whose
 * labels and values do not pair up.
 */
export function cleanDiagram(raw: unknown): DiagramAttrs | null {
  if (!isRecord(raw) || !isDiagramKind(raw.kind)) return null
  const kind = raw.kind
  const rawItems = Array.isArray(raw.items) ? raw.items : []
  let items: string[]
  let values: number[] = []
  if (kind === 'bar') {
    const rawValues = Array.isArray(raw.values) ? raw.values : []
    if (rawValues.length !== rawItems.length) return null
    const pairs: Array<[string, number]> = []
    for (let i = 0; i < rawItems.length; i++) {
      const label = text(rawItems[i], DIAGRAM_LIMITS.item)
      const value = toNumber(rawValues[i])
      if (value === null) return null
      if (label) pairs.push([label, value])
    }
    items = pairs.map(([label]) => label)
    values = pairs.map(([, value]) => value)
  } else {
    items = rawItems
      .map(item => text(item, DIAGRAM_LIMITS.item))
      .filter(Boolean)
  }
  const max = kind === 'bar' ? DIAGRAM_LIMITS.maxBars : DIAGRAM_LIMITS.maxSteps
  if (items.length < DIAGRAM_LIMITS.minItems || items.length > max) return null
  const sourceId = text(raw.sourceId, 12)
  return {
    kind,
    title: text(raw.title, DIAGRAM_LIMITS.title),
    items,
    values,
    unit: kind === 'bar' ? text(raw.unit, DIAGRAM_LIMITS.unit) : '',
    caption: text(raw.caption, DIAGRAM_LIMITS.caption),
    alt: text(raw.alt, DIAGRAM_LIMITS.alt),
    sourceId: SOURCE_ID.test(sourceId) ? sourceId : ''
  }
}

/** A number as a chart label: whole numbers as they are, others to two places. */
export function formatValue(value: number, unit: string): string {
  const number = Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (!unit) return number
  // A currency comes first, with any word after it after the number:
  // "₹ crore" reads "₹11,821 crore", "$" reads "$13", "$ billion" reads
  // "$13 billion" (a live chart wrote "11,821₹ crore", which no source says).
  const currency = /^([$£€₹¥₩])\s*(.*)$/u.exec(unit.trim())
  if (currency) {
    const rest = currency[2]!.trim()
    return `${currency[1]}${number}${rest ? ` ${rest}` : ''}`
  }
  // "%" and other symbols sit against the number; words get a space.
  return /^\p{L}/u.test(unit) ? `${number} ${unit}` : `${number}${unit}`
}

/**
 * What the diagram shows, in words: the description screen readers announce
 * and the text the checks read. Built from the data, so it is always true to
 * the picture, whatever alt text was written.
 */
export function diagramDescription(d: DiagramAttrs): string {
  const lead = d.title ? `${d.title.replace(/[.:]+$/, '')}. ` : ''
  switch (d.kind) {
    case 'flow':
      return `${lead}Steps: ${d.items.map((item, i) => `${i + 1}. ${item}`).join('; ')}.`
    case 'timeline':
      return `${lead}Timeline: ${d.items.join('; ')}.`
    case 'bar':
      return `${lead}${d.items
        .map((item, i) => `${item}: ${formatValue(d.values[i] ?? 0, d.unit)}`)
        .join('; ')}.`
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const WIDTH = 720
const PAD = 24
const FONT = 15
const LINE = 20
const TITLE_FONT = 17
const TITLE_LINE = 23
const DEFAULT_COLOR = '#2563eb'
const INK = '#111827'
const MUTED = '#4b5563'
const WHITE = '#ffffff'

const escapeXml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Coordinates to one decimal place, so the output is short and stable. */
const r = (value: number) => Math.round(value * 10) / 10

/** Characters drawn a full em wide: CJK, Hangul and full-width forms. */
const WIDE =
  /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u

const textWidth = (text: string, fontSize: number) =>
  Array.from(text).reduce((sum, ch) => sum + (WIDE.test(ch) ? 1 : 0.56), 0) *
  fontSize

/**
 * Text broken into lines no wider than `maxWidth`, estimated from the font
 * size (an SVG made on the server cannot measure its text). Words longer
 * than a line are broken.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number
): string[] {
  const lines: string[] = []
  let line = ''
  const push = () => {
    if (line) lines.push(line)
    line = ''
  }
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (textWidth(candidate, fontSize) <= maxWidth) {
      line = candidate
      continue
    }
    push()
    if (textWidth(word, fontSize) <= maxWidth) {
      line = word
      continue
    }
    // A word too long for any line is cut where the line is full.
    let chunk = ''
    for (const ch of Array.from(word)) {
      if (chunk && textWidth(chunk + ch, fontSize) > maxWidth) {
        lines.push(chunk)
        chunk = ''
      }
      chunk += ch
    }
    line = chunk
  }
  push()
  return lines
}

const HEX = /^#(?:[0-9a-f]{3}){1,2}$/i

function rgbOf(hex: string): [number, number, number] {
  const full =
    hex.length === 4
      ? hex
          .slice(1)
          .split('')
          .map(c => c + c)
          .join('')
      : hex.slice(1)
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number
  ]
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [red, green, blue] = rgbOf(hex).map(c => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number
  ]
  return (hi + 0.05) / (lo + 0.05)
}

/** White or near-black, whichever reads better on `fill`. */
const textOn = (fill: string) =>
  contrast(fill, WHITE) >= contrast(fill, INK) ? WHITE : INK

/** The colour mixed toward white: a light tint for boxes dark text sits on. */
function tint(hex: string, amount: number): string {
  return `#${rgbOf(hex)
    .map(c =>
      Math.round(c + (255 - c) * amount)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

type TextOptions = {
  size?: number
  lineHeight?: number
  fill?: string
  weight?: number
  anchor?: 'middle'
}

/** Lines of text, the first baseline at `y`, each further line `lineHeight` below. */
function textBlock(lines: string[], x: number, y: number, o: TextOptions = {}) {
  const size = o.size ?? FONT
  const lineHeight = o.lineHeight ?? LINE
  const attrs = [
    `x="${r(x)}"`,
    `y="${r(y)}"`,
    `font-size="${size}"`,
    `fill="${o.fill ?? INK}"`,
    ...(o.weight ? [`font-weight="${o.weight}"`] : []),
    ...(o.anchor ? [`text-anchor="${o.anchor}"`] : [])
  ].join(' ')
  const spans = lines
    .map(
      (line, i) =>
        `<tspan x="${r(x)}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('')
  return `<text ${attrs}>${spans}</text>`
}

/** An arrowhead pointing right (dx 1) or down (dy 1), its tip at (x, y). */
const arrowHead = (x: number, y: number, down: boolean) =>
  down
    ? `<path d="M${r(x)} ${r(y)} L${r(x - 5)} ${r(y - 8)} L${r(x + 5)} ${r(y - 8)} Z" fill="${MUTED}"/>`
    : `<path d="M${r(x)} ${r(y)} L${r(x - 8)} ${r(y - 5)} L${r(x - 8)} ${r(y + 5)} Z" fill="${MUTED}"/>`

type Drawn = { body: string; bottom: number }

function drawFlow(d: DiagramAttrs, top: number, color: string): Drawn {
  const n = d.items.length
  const gap = 36
  const boxWidth = (WIDTH - 2 * PAD - (n - 1) * gap) / n
  const sideLines = d.items.map(item => wrapText(item, boxWidth - 24, FONT))
  if (n <= 4 && sideLines.every(lines => lines.length <= 3)) {
    const most = Math.max(...sideLines.map(lines => lines.length))
    const height = Math.max(64, most * LINE + 28)
    const parts: string[] = []
    d.items.forEach((_, i) => {
      const x = PAD + i * (boxWidth + gap)
      const lines = sideLines[i]!
      parts.push(
        `<rect data-step="${i}" x="${r(x)}" y="${r(top)}" width="${r(boxWidth)}" height="${r(height)}" rx="10" fill="${color}"/>`,
        textBlock(
          lines,
          x + boxWidth / 2,
          top + (height - lines.length * LINE) / 2 + LINE * 0.75,
          { fill: textOn(color), weight: 600, anchor: 'middle' }
        )
      )
      if (i < n - 1) {
        const midY = top + height / 2
        const from = x + boxWidth + 6
        const to = x + boxWidth + gap - 4
        parts.push(
          `<line x1="${r(from)}" y1="${r(midY)}" x2="${r(to - 6)}" y2="${r(midY)}" stroke="${MUTED}" stroke-width="2"/>`,
          arrowHead(to, midY, false)
        )
      }
    })
    return { body: parts.join(''), bottom: top + height }
  }
  // A column of numbered steps, for more steps or longer ones.
  const parts: string[] = []
  const circleX = PAD + 28
  const textX = PAD + 58
  const fill = tint(color, 0.88)
  let y = top
  d.items.forEach((item, i) => {
    const lines = wrapText(item, WIDTH - PAD - textX - 16, FONT)
    const height = Math.max(48, lines.length * LINE + 24)
    parts.push(
      `<rect data-step="${i}" x="${PAD}" y="${r(y)}" width="${WIDTH - 2 * PAD}" height="${r(height)}" rx="10" fill="${fill}" stroke="${color}" stroke-width="1.5"/>`,
      `<circle cx="${circleX}" cy="${r(y + height / 2)}" r="15" fill="${color}"/>`,
      textBlock([String(i + 1)], circleX, y + height / 2 + 5, {
        fill: textOn(color),
        weight: 600,
        anchor: 'middle'
      }),
      textBlock(lines, textX, y + (height - lines.length * LINE) / 2 + LINE * 0.75)
    )
    y += height
    if (i < d.items.length - 1) {
      parts.push(
        `<line x1="${circleX}" y1="${r(y + 2)}" x2="${circleX}" y2="${r(y + 16)}" stroke="${MUTED}" stroke-width="2"/>`,
        arrowHead(circleX, y + 24, true)
      )
      y += 26
    }
  })
  return { body: parts.join(''), bottom: y }
}

/** "2019 — First release" → ["2019", "First release"]. */
function splitEntry(item: string): [string, string] {
  const match = /^(.{1,40}?)\s*(?:\s[—–-]\s|:\s)\s*(.+)$/u.exec(item)
  return match ? [match[1]!.trim(), match[2]!.trim()] : [item, '']
}

function drawTimeline(d: DiagramAttrs, top: number, color: string): Drawn {
  const lineX = PAD + 16
  const textX = PAD + 44
  const width = WIDTH - PAD - textX
  const parts: string[] = []
  const dots: number[] = []
  let y = top
  for (const item of d.items) {
    const [label, rest] = splitEntry(item)
    const labelLines = wrapText(label, width, FONT)
    const restLines = rest ? wrapText(rest, width, FONT) : []
    dots.push(y + LINE * 0.45)
    parts.push(textBlock(labelLines, textX, y + LINE * 0.75, { weight: 600 }))
    if (restLines.length > 0) {
      parts.push(
        textBlock(restLines, textX, y + LINE * (labelLines.length + 0.75), {
          fill: MUTED
        })
      )
    }
    y += (labelLines.length + restLines.length) * LINE + 18
  }
  const spine =
    dots.length > 1
      ? `<line x1="${lineX}" y1="${r(dots[0]!)}" x2="${lineX}" y2="${r(dots[dots.length - 1]!)}" stroke="${tint(color, 0.55)}" stroke-width="3"/>`
      : ''
  const circles = dots
    .map(cy => `<circle cx="${lineX}" cy="${r(cy)}" r="7" fill="${color}"/>`)
    .join('')
  return { body: spine + circles + parts.join(''), bottom: y - 18 }
}

function drawBars(d: DiagramAttrs, top: number, color: string): Drawn {
  const labelWidth = 200
  const barX = PAD + labelWidth + 12
  const valueWidth = 90
  const area = WIDTH - PAD - barX - valueWidth
  const largest = Math.max(0, ...d.values.map(v => Math.abs(v)))
  const parts: string[] = []
  let y = top
  d.items.forEach((item, i) => {
    let lines = wrapText(item, labelWidth, FONT)
    if (lines.length > 2) lines = [lines[0]!, `${lines[1]!.replace(/\s*\S*$/, '')}…`]
    const rowHeight = Math.max(28, lines.length * LINE)
    const value = d.values[i] ?? 0
    const width = largest > 0 && value !== 0 ? Math.max(2, (Math.abs(value) / largest) * area) : 0
    const barY = y + (rowHeight - 24) / 2
    parts.push(textBlock(lines, PAD, y + (rowHeight - lines.length * LINE) / 2 + LINE * 0.75))
    if (width > 0) {
      parts.push(
        `<rect data-bar="${i}" x="${barX}" y="${r(barY)}" width="${r(width)}" height="24" rx="4" fill="${color}"/>`
      )
    }
    parts.push(
      textBlock([formatValue(value, d.unit)], barX + width + 8, barY + 17, {
        fill: INK,
        weight: 600
      })
    )
    y += rowHeight + 14
  })
  return { body: parts.join(''), bottom: y - 14 }
}

/**
 * The diagram as a self-contained, accessible SVG: a white card in the
 * brand's colour (an unusable colour falls back to blue), labelled by its
 * title and described by its data. No styles, fonts or scripts from outside,
 * so it renders the same in the editor, an exported page and a CMS.
 */
export function renderDiagramSvg(
  d: DiagramAttrs,
  options: { color?: string; idPrefix?: string } = {}
): string {
  const color =
    options.color && HEX.test(options.color) ? options.color.toLowerCase() : DEFAULT_COLOR
  const prefix =
    (options.idPrefix ?? 'diagram').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) ||
    'diagram'
  const label = d.title || d.alt || DIAGRAM_KIND_LABELS[d.kind]
  let top = PAD
  let heading = ''
  if (d.title) {
    const lines = wrapText(d.title, WIDTH - 2 * PAD, TITLE_FONT)
    heading = textBlock(lines, PAD, top + TITLE_FONT, {
      size: TITLE_FONT,
      lineHeight: TITLE_LINE,
      weight: 600
    })
    top += lines.length * TITLE_LINE + 14
  }
  const drawn =
    d.kind === 'flow'
      ? drawFlow(d, top, color)
      : d.kind === 'timeline'
        ? drawTimeline(d, top, color)
        : drawBars(d, top, color)
  const height = r(drawn.bottom + PAD)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="100%" role="img" aria-labelledby="${prefix}-title ${prefix}-desc" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">`,
    `<title id="${prefix}-title">${escapeXml(label)}</title>`,
    `<desc id="${prefix}-desc">${escapeXml(diagramDescription(d))}</desc>`,
    `<rect x="0" y="0" width="${WIDTH}" height="${height}" rx="12" fill="${WHITE}"/>`,
    heading,
    drawn.body,
    '</svg>'
  ].join('')
}
