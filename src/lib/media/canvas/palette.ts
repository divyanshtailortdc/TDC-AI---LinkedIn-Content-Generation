import {
  contrastRatio,
  DEFAULT_BACKGROUND,
  DEFAULT_PRIMARY,
  normalizeHex,
  type ResolvedBrandTheme
} from '~/lib/brand/theme'

/**
 * The colours an image is drawn in, worked out from the brand theme so that
 * every piece of text stays readable whatever colours were picked: a pale
 * brand colour is darkened before it is used for text, and text on a filled
 * shape is white or near-black, whichever reads.
 */
export interface CanvasPalette {
  background: string
  /** The dots or grid lines over the background. */
  pattern: string
  /** Headline. */
  ink: string
  /** Subheadline and card text. */
  body: string
  /** Footer, details, connectors. */
  muted: string
  /** Hairlines and card borders. */
  line: string
  /** Cards and pills. */
  surface: string
  /** Tagline, icons, the diagram's main shapes. */
  primary: string
  /** Text and icons set on a primary fill. */
  onPrimary: string
  /** A pale tint of the primary, for icon tiles and soft fills. */
  primarySoft: string
  /** The headline's highlighted words, step numbers, arrows. */
  accent: string
  onAccent: string
  accentSoft: string
}

const INK = '#0f172a'
const WHITE = '#ffffff'

const channels = (hex: string) =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))

const toHex = (rgb: number[]) =>
  `#${rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`

/** `amount` of the way from `from` to `to`. */
export function mix(from: string, to: string, amount: number): string {
  const a = channels(from)
  const b = channels(to)
  return toHex(a.map((c, i) => c + (b[i]! - c) * amount))
}

/**
 * The colour itself when it reads against `background` at `min` contrast,
 * otherwise the first shade towards near-black that does.
 */
export function readableOn(color: string, background: string, min = 3): string {
  if (contrastRatio(color, background) >= min) return color
  for (let step = 1; step <= 10; step++) {
    const darker = mix(color, INK, step / 10)
    if (contrastRatio(darker, background) >= min) return darker
  }
  return INK
}

/** White or near-black, whichever reads better on `fill`. */
const textOn = (fill: string) =>
  contrastRatio(WHITE, fill) >= contrastRatio(INK, fill) ? WHITE : INK

export function canvasPalette(theme: ResolvedBrandTheme): CanvasPalette {
  const background = normalizeHex(theme.backgroundColor) ?? DEFAULT_BACKGROUND
  const brandPrimary = theme.primaryColor ?? DEFAULT_PRIMARY
  // One brand colour does both jobs.
  const brandAccent = theme.accentColor ?? brandPrimary
  const primary = readableOn(brandPrimary, background)
  const accent = readableOn(brandAccent, background)
  return {
    background,
    pattern: mix(background, primary, 0.16),
    ink: readableOn(INK, background, 7),
    body: readableOn('#475569', background, 4.5),
    muted: readableOn('#64748b', background, 3),
    line: mix(background, INK, 0.1),
    surface: WHITE,
    primary,
    onPrimary: textOn(primary),
    primarySoft: mix(WHITE, primary, 0.12),
    accent,
    onAccent: textOn(accent),
    accentSoft: mix(WHITE, accent, 0.14)
  }
}
