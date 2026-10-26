import { z } from 'zod'
import { DEFAULT_FONT, findFont } from './fonts'

/**
 * An identity's brand theme: its logo, colours, typefaces and the look of the
 * visual side of every image generated for it.
 *
 * Every image is laid out the same way by the canvas renderer
 * (src/lib/media/canvas): the text on the left, a diagram or illustration on
 * the right, on a light background. The theme fills that layout in.
 *
 * Pure and free of Node APIs, so the Brand Theme form, the server actions and
 * the media prompt builders share one definition. The logo bytes are not part
 * of the theme: they are loaded only where an image is rendered.
 */

export { BRAND_THEME_PATH } from './theme-path'

export const VISUAL_STYLES = [
  {
    value: 'auto',
    label: 'Decide per post',
    description:
      'A diagram when the post explains how things connect, an illustration when it tells a story.'
  },
  {
    value: 'diagram',
    label: 'Diagram',
    description:
      'Hub-and-spoke, flows, layers, cards or a comparison, drawn with exact labels.'
  },
  {
    value: 'illustration',
    label: 'Illustration',
    description:
      'A flat vector illustration drawn by the image model, with labelled badges.'
  }
] as const
export type VisualStyle = (typeof VISUAL_STYLES)[number]['value']

export const BACKGROUND_PATTERNS = [
  { value: 'auto', label: 'Auto' },
  { value: 'dots', label: 'Dots' },
  { value: 'grid', label: 'Grid' },
  { value: 'plain', label: 'Plain' }
] as const
export type BackgroundPattern = (typeof BACKGROUND_PATTERNS)[number]['value']

/** What an image is drawn with: Auto is settled per image by the art director. */
export const CANVAS_PATTERNS = ['dots', 'grid', 'plain'] as const
export type CanvasPattern = (typeof CANVAS_PATTERNS)[number]

/** Soft white: the background when the theme sets none. */
export const DEFAULT_BACKGROUND = '#f8fafc'
/** Diagrams and the tagline need a colour even before the brand has one. */
export const DEFAULT_PRIMARY = '#2563eb'

/**
 * Text and diagrams are set on the background, so it has to be light: a
 * relative luminance of at least this (#cbd5e1, a light slate, is about 0.66;
 * #e2e8f0 about 0.79).
 */
export const MIN_BACKGROUND_LUMINANCE = 0.78

export const FOOTER_MAX_LENGTH = 60

export type LogoPlacement =
  | 'top_left'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_right'

/**
 * Where the logo goes on generated images. Kept in the corner away from where
 * a reader starts, to the headline.
 */
export const LOGO_PLACEMENT: LogoPlacement = 'bottom_right'

/** Longest headline an image may carry, in words. */
export const HEADLINE_MAX_WORDS = 8

export interface ResolvedBrandTheme {
  /** Lower-case #rrggbb, or null when not set. */
  primaryColor: string | null
  accentColor: string | null
  /** Alias for accentColor for backwards compatibility. */
  secondaryColor?: string | null
  /** Null for the default soft white. */
  backgroundColor: string | null
  /** Families from FONT_CHOICES. */
  headingFont: string
  bodyFont: string
  visualStyle: VisualStyle
  backgroundPattern: BackgroundPattern
  /** Whether the logo goes on images; ignored until one is uploaded. */
  showLogo: boolean
  /** The website or handle on images; null for none. */
  footerText: string | null
  hasLogo: boolean
  /** False until the theme is first saved. */
  saved: boolean
}

export const DEFAULT_BRAND_THEME: ResolvedBrandTheme = {
  primaryColor: null,
  accentColor: null,
  secondaryColor: null,
  backgroundColor: null,
  headingFont: DEFAULT_FONT,
  bodyFont: DEFAULT_FONT,
  visualStyle: 'auto',
  backgroundPattern: 'dots',
  showLogo: true,
  footerText: null,
  hasLogo: false,
  saved: false
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** "#0e7c86" for "#0E7C86" or "#0e7"; null for anything that is not a hex colour. */
export function normalizeHex(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim()
  if (!HEX.test(trimmed)) return null
  const hex = trimmed.slice(1).toLowerCase()
  return `#${hex.length === 3 ? [...hex].map(c => c + c).join('') : hex}`
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function relativeLuminance(hex: string): number {
  const n = normalizeHex(hex) ?? '#000000'
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x
  )
  return (hi! + 0.05) / (lo! + 0.05)
}

export const isLightBackground = (hex: string) =>
  relativeLuminance(hex) >= MIN_BACKGROUND_LUMINANCE

const isOption = <T extends string>(
  options: readonly { value: T }[],
  value: string | null | undefined
): value is T => options.some(o => o.value === value)

/** The stored row, as far as resolving it is concerned. */
export interface BrandThemeRecord {
  primaryColor?: string | null
  secondaryColor?: string | null
  accentColor?: string | null
  backgroundColor?: string | null
  headingFont?: string | null
  bodyFont?: string | null
  visualStyle?: string | null
  backgroundPattern?: string | null
  showLogo?: boolean | null
  footerText?: string | null
  hasLogo?: boolean | null
}

export function resolveBrandTheme(
  row: BrandThemeRecord | null | undefined
): ResolvedBrandTheme {
  if (!row) return DEFAULT_BRAND_THEME
  const background = normalizeHex(row.backgroundColor)
  const accent = normalizeHex(row.accentColor ?? row.secondaryColor)
  return {
    primaryColor: normalizeHex(row.primaryColor),
    accentColor: accent,
    secondaryColor: accent,
    // A dark background saved by hand would make the text unreadable.
    backgroundColor:
      background && isLightBackground(background) ? background : null,
    headingFont: findFont(row.headingFont)?.family ?? DEFAULT_FONT,
    bodyFont: findFont(row.bodyFont)?.family ?? DEFAULT_FONT,
    visualStyle: isOption(VISUAL_STYLES, row.visualStyle)
      ? row.visualStyle
      : 'auto',
    backgroundPattern: isOption(BACKGROUND_PATTERNS, row.backgroundPattern)
      ? row.backgroundPattern
      : 'dots',
    showLogo: row.showLogo ?? true,
    footerText: row.footerText?.trim() || null,
    hasLogo: Boolean(row.hasLogo),
    saved: true
  }
}

/** The brand colours that are set, the primary first. */
export function brandColors(
  theme: Pick<ResolvedBrandTheme, 'primaryColor'> & {
    accentColor?: string | null
    secondaryColor?: string | null
  }
): Array<{ role: 'primary' | 'accent' | 'secondary'; hex: string }> {
  const colors: Array<{ role: 'primary' | 'accent' | 'secondary'; hex: string }> = []
  if (theme.primaryColor) colors.push({ role: 'primary', hex: theme.primaryColor })
  const second = theme.accentColor ?? theme.secondaryColor
  if (second) colors.push({ role: 'secondary', hex: second })
  return colors
}

/**
 * A website as the corner of an image shows it: without the scheme and the
 * trailing slash, otherwise exactly as given.
 */
export function displayWebsite(url: string | null | undefined): string | null {
  const shown = (url || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
  return shown && shown.length <= FOOTER_MAX_LENGTH ? shown : null
}

/**
 * A rough everyday name for a colour ("dark blue", "bright orange"), said
 * next to its hex code: image models follow a named colour more reliably than
 * a bare code.
 */
export function describeColor(hex: string): string {
  const n = normalizeHex(hex)
  if (!n) return 'unknown colour'
  const [r, g, b] = [1, 3, 5].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
  const max = Math.max(r!, g!, b!)
  const min = Math.min(r!, g!, b!)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))

  if (s < 0.15 || d < 0.08) {
    if (l < 0.12) return 'black'
    if (l > 0.93) return 'white'
    if (l < 0.35) return 'dark grey'
    if (l > 0.75) return 'light grey'
    return 'grey'
  }

  let h =
    max === r
      ? ((g! - b!) / d) % 6
      : max === g
        ? (b! - r!) / d + 2
        : (r! - g!) / d + 4
  h = (h * 60 + 360) % 360

  let hue =
    h < 15
      ? 'red'
      : h < 40
        ? 'orange'
        : h < 65
          ? 'yellow'
          : h < 160
            ? 'green'
            : h < 195
              ? 'teal'
              : h < 255
                ? 'blue'
                : h < 290
                  ? 'purple'
                  : h < 335
                    ? 'magenta'
                    : 'red'
  if (hue === 'orange' && l < 0.4) hue = 'brown'
  if ((hue === 'red' || hue === 'magenta') && l > 0.7) hue = 'pink'

  const shade =
    l < 0.22
      ? 'very dark '
      : l < 0.38
        ? 'dark '
        : l > 0.8
          ? 'pale '
          : l > 0.65
            ? 'light '
            : s > 0.75
              ? 'bright '
              : ''
  const muted = s < 0.35 && !shade.startsWith('very') ? 'muted ' : ''
  return `${muted}${shade}${hue}`.replace(/\s+/g, ' ').trim()
}


// ---------------------------------------------------------------------------
// The save payload
// ---------------------------------------------------------------------------

/** Logos arrive already scaled down by the form; this only stops abuse. */
export const LOGO_MAX_DATA_URL_LENGTH = 1_800_000
export const LOGO_UPLOAD_MAX_BYTES = 5 * 1024 * 1024
export const LOGO_UPLOAD_TYPES = [
  'image/png',
  'image/webp',
  'image/jpeg',
  'image/svg+xml'
] as const
/** The longest edge a stored logo keeps; far more than any placement needs. */
export const LOGO_MAX_EDGE = 1024
export const LOGO_MIN_EDGE = 48

/** Empty or missing clears the colour. */
const hexField = (label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .refine(
      v => !v?.trim() || normalizeHex(v) !== null,
      `${label} must be a hex colour like #0E7C86.`
    )
    .transform(v => normalizeHex(v))

/** Empty or missing means the default typeface. */
const fontField = (label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .refine(
      v => !v?.trim() || findFont(v) !== null,
      `${label} must be one of the listed typefaces.`
    )
    .transform(v => findFont(v)?.family ?? null)

export const BrandThemePayloadSchema = z.object({
  primaryColor: hexField('Primary colour'),
  secondaryColor: hexField('Secondary colour').optional(),
  accentColor: hexField('Accent colour').optional(),
  backgroundColor: hexField('Background colour').refine(
    v => v === null || isLightBackground(v),
    'The background must be a light colour: the headline and diagram are set on it.'
  ),
  headingFont: fontField('Headline typeface'),
  bodyFont: fontField('Body typeface'),
  visualStyle: z
    .enum(VISUAL_STYLES.map(s => s.value) as [VisualStyle, ...VisualStyle[]])
    .default('auto'),
  backgroundPattern: z
    .enum(
      BACKGROUND_PATTERNS.map(p => p.value) as [
        BackgroundPattern,
        ...BackgroundPattern[]
      ]
    )
    .default('dots'),
  showLogo: z.boolean().default(true),
  footerText: z
    .string()
    .max(
      FOOTER_MAX_LENGTH,
      `Keep the website or handle under ${FOOTER_MAX_LENGTH} characters.`
    )
    .nullable()
    .optional()
    .transform(v => v?.trim() || null),
  /**
   * Undefined keeps the saved file, null removes it, a data URL replaces it.
   * The server re-reads and re-encodes the bytes either way.
   */
  logo: z
    .string()
    .max(
      LOGO_MAX_DATA_URL_LENGTH,
      'The logo file is too large. Use one under 1 MB.'
    )
    .refine(v => v.startsWith('data:image/'), 'The logo must be an image.')
    .nullable()
    .optional()
})
export type BrandThemePayload = z.input<typeof BrandThemePayloadSchema>

// ---------------------------------------------------------------------------
// Where the logo goes
// ---------------------------------------------------------------------------

/** Share of the image's area the logo covers, so wordmarks and marks look alike in weight. */
const LOGO_AREA_SHARE = 0.011

export interface LogoBox {
  left: number
  top: number
  width: number
  height: number
  /** Padding of the backing plate drawn when the corner lacks contrast. */
  padding: number
}

/**
 * The logo's rectangle on an image. Sized by area rather than width, so a wide
 * wordmark and a square mark read at the same weight; capped so a long
 * wordmark never spans a third of the image.
 */
export function logoBox(
  canvas: { width: number; height: number },
  logo: { width: number; height: number },
  placement: LogoPlacement = LOGO_PLACEMENT
): LogoBox {
  const aspect =
    logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1
  const area = canvas.width * canvas.height * LOGO_AREA_SHARE
  let height = Math.sqrt(area / aspect)
  let width = height * aspect
  const scale = Math.min(
    1,
    (canvas.width * 0.32) / width,
    (canvas.height * 0.2) / height
  )
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.055)
  return {
    left: placement.endsWith('left') ? margin : canvas.width - margin - width,
    top: placement.startsWith('top') ? margin : canvas.height - margin - height,
    width,
    height,
    padding: Math.round(Math.min(height * 0.3, margin * 0.8))
  }
}

/** "bottom-right" for bottom_right. */
export const cornerWords = (placement: LogoPlacement) =>
  placement.replace('_', '-')

/**
 * Asks the image model to leave the logo's corner as plain background, sized
 * from where the logo will actually go.
 */
export function logoClearSpaceInstruction(
  canvas: { width: number; height: number },
  box: LogoBox,
  placement: LogoPlacement = LOGO_PLACEMENT
): string {
  // Measured from the edges the logo sits against, not from the top left.
  const edgeX = placement.endsWith('left')
    ? box.left
    : canvas.width - box.left - box.width
  const edgeY = placement.startsWith('top')
    ? box.top
    : canvas.height - box.top - box.height
  const across = Math.min(
    40,
    Math.ceil(((edgeX + box.width + box.padding * 2) / canvas.width) * 100) + 4
  )
  const down = Math.min(
    40,
    Math.ceil(((edgeY + box.height + box.padding * 2) / canvas.height) * 100) +
      4
  )
  const corner = cornerWords(placement)
  const [vertical, horizontal] = corner.split('-')
  return `Leave the ${corner} corner (about the ${horizontal}most ${across}% of the width and the ${vertical} ${down}% of the height) as calm, empty background with no text, faces or important objects: a logo is placed there afterwards.`
}

