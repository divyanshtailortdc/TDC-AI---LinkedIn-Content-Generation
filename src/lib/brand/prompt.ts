import {
  brandColors,
  cornerWords,
  describeColor,
  HEADLINE_MAX_WORDS,
  type LogoPlacement,
  type ResolvedBrandTheme
} from './theme'

/**
 * The brand theme in words, for the two readers that need it: the art
 * director who designs each image (a brief, with room for judgment) and the
 * image model (fixed lines appended to its prompt by code, so the colours and
 * the no-logo rule never depend on the brief remembering them).
 */

const named = (hex: string) => `${hex} (${describeColor(hex)})`

/** "#e4572e (bright orange) as the dominant colour and …", or null without colours. */
function paletteWords(theme: ResolvedBrandTheme): string | null {
  const [first, second] = brandColors(theme)
  if (!first) return null
  return second
    ? `${named(first.hex)} as the dominant colour and ${named(second.hex)} as the supporting colour`
    : `${named(first.hex)} as the dominant colour`
}

/** The theme as the art director reads it; empty when nothing was set. */
export function renderBrandForArtDirector(theme: ResolvedBrandTheme): string {
  const palette = paletteWords(theme)
  return palette
    ? `Brand colours: ${palette}. Build the image from these, with white, greys and near-black as neutrals and no other strong colours.`
    : ''
}

/** The lettering rule, for the art director. */
export const TEXT_RULE = `Text: at most one headline of up to ${HEADLINE_MAX_WORDS} words, in large type. Nothing else in the image is lettered: screens, documents, signs, labels and packaging show abstract lines and shapes, never words or numbers. Leave the headline empty when the image says it better without words.`

/**
 * Opens the image prompt when a reference image is attached. The reference
 * lends its layout and look; the subject comes from the post, and with brand
 * colours set the reference reaches the image model in greyscale, so its own
 * colours have nothing to leak from.
 */
export function referenceImageInstruction(theme: ResolvedBrandTheme): string {
  const recolour = paletteWords(theme)
    ? ' Do not copy its colours either: the colours come only from the palette below.'
    : ''
  return `Create a new image. The attached reference image is a guide to arrangement and rendering style only: where the main subject, the empty space and any headline sit, the framing and camera angle, the medium, line work, texture, lighting and level of detail. None of the objects, props, devices, icons, people, wording or logos in the reference may appear: what the image shows is described below.${recolour}`
}

/**
 * Fixed lines appended to the image prompt. `clearSpace` keeps the logo's
 * corner empty; `userPrompt` softens the colours to a default, because a
 * prompt the reviewer wrote wins over the theme.
 */
export function imagePromptSuffix(options: {
  theme: ResolvedBrandTheme
  /** The headline the brief chose; empty for none. Ignored for user prompts. */
  headline?: string
  clearSpace?: string | null
  /** Where the logo goes, when it does: the headline is kept to the other side. */
  logoPlacement?: LogoPlacement
  userPrompt?: boolean
}): string {
  const lines: string[] = []
  const palette = paletteWords(options.theme)

  if (options.userPrompt) {
    if (palette) {
      lines.push(
        `Unless the description above names other colours, use the brand colours: ${palette}, with white, greys and near-black as neutrals.`
      )
    }
  } else {
    if (palette) {
      const supporting =
        brandColors(options.theme).length > 1
          ? ' Give the supporting colour a visible share too, such as the headline, outlines or a second large shape.'
          : ''
      lines.push(
        `Colour palette: ${palette}, with white, light grey and near-black as neutrals.${supporting} No other strong colours.`
      )
    }
    const headline = (options.headline || '').trim()
    if (headline) {
      // A headline run across the logo's corner ends up under the logo.
      const side = options.logoPlacement
        ? ` Set it on the ${options.logoPlacement.endsWith('left') ? 'right' : 'left'}-hand side of the image, well clear of the ${cornerWords(options.logoPlacement)} corner.`
        : ''
      lines.push(
        `The only text in the image is the headline "${headline}", spelled exactly, in large clear type.${side} Screens, documents, signs, labels and packaging show abstract lines and shapes, never letters or numbers.`
      )
    } else {
      lines.push(
        'The image contains no text at all: no letters, words, numbers, labels or captions. Screens, documents, signs and packaging show abstract lines and shapes only.'
      )
    }
  }

  if (options.clearSpace) lines.push(options.clearSpace)
  lines.push(
    'Never draw a logo, emblem, wordmark, company or product name, signature or watermark anywhere in the image.'
  )
  return lines.join(' ')
}
