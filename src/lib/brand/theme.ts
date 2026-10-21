import { z } from 'zod'

/**
 * An identity's brand theme: its logo and its two brand colours, applied to
 * every image generated for it.
 *
 * Pure and free of Node APIs, so the Brand Theme form, the server actions and
 * the media prompt builders share one definition. The logo bytes are not part
 * of the theme: they are loaded only where an image is composited.
 */

/** Where the Brand Theme page lives. */
export const BRAND_THEME_PATH = '/brand'

export type LogoPlacement =
  | 'top_left'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_right'

/**
 * Where the logo goes on every image. Bottom right leaves the left side, where
 * a reader starts, to the headline.
 */
export const LOGO_PLACEMENT: LogoPlacement = 'bottom_right'

/** Longest headline an image may carry, in words. */
export const HEADLINE_MAX_WORDS = 8

export interface ResolvedBrandTheme {
  /** Lower-case #rrggbb, or null when not set. */
  primaryColor: string | null
  secondaryColor: string | null
  hasLogo: boolean
  /** False until the theme is first saved. */
  saved: boolean
}

export const DEFAULT_BRAND_THEME: ResolvedBrandTheme = {
  primaryColor: null,
  secondaryColor: null,
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

/** The stored row, as far as resolving it is concerned. */
export interface BrandThemeRecord {
  primaryColor?: string | null
  secondaryColor?: string | null
  hasLogo?: boolean | null
}

export function resolveBrandTheme(
  row: BrandThemeRecord | null | undefined
): ResolvedBrandTheme {
  if (!row) return DEFAULT_BRAND_THEME
  return {
    primaryColor: normalizeHex(row.primaryColor),
    secondaryColor: normalizeHex(row.secondaryColor),
    hasLogo: Boolean(row.hasLogo),
    saved: true
  }
}

/** The brand colours that are set, the primary first. */
export function brandColors(
  theme: Pick<ResolvedBrandTheme, 'primaryColor' | 'secondaryColor'>
): Array<{ role: 'primary' | 'secondary'; hex: string }> {
  const colors: Array<{ role: 'primary' | 'secondary'; hex: string }> = []
  if (theme.primaryColor) colors.push({ role: 'primary', hex: theme.primaryColor })
  if (theme.secondaryColor)
    colors.push({ role: 'secondary', hex: theme.secondaryColor })
  return colors
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

export const BrandThemePayloadSchema = z.object({
  primaryColor: hexField('Primary colour'),
  secondaryColor: hexField('Secondary colour'),
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
