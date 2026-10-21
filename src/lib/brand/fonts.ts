/**
 * The typefaces a brand theme can pick. Each is a Google Fonts family that
 * has the three weights the canvas sets text in (regular, semibold and a
 * heavy weight for the headline); `bold` is the heaviest of 700 and 800 the
 * family offers. Checked against the Google Fonts CSS API.
 *
 * Pure, so the Brand Theme form and the canvas font loader share it.
 */

export interface FontChoice {
  family: string
  category: 'sans' | 'serif'
  bold: 700 | 800
}

/** Bundled with the app, so it renders even when Google Fonts cannot be reached. */
export const DEFAULT_FONT = 'Inter'

export const FONT_CHOICES: readonly FontChoice[] = [
  { family: 'Inter', category: 'sans', bold: 800 },
  { family: 'Manrope', category: 'sans', bold: 800 },
  { family: 'Plus Jakarta Sans', category: 'sans', bold: 800 },
  { family: 'DM Sans', category: 'sans', bold: 800 },
  { family: 'Poppins', category: 'sans', bold: 800 },
  { family: 'Montserrat', category: 'sans', bold: 800 },
  { family: 'Work Sans', category: 'sans', bold: 800 },
  { family: 'Outfit', category: 'sans', bold: 800 },
  { family: 'Sora', category: 'sans', bold: 800 },
  { family: 'Lexend', category: 'sans', bold: 800 },
  { family: 'Figtree', category: 'sans', bold: 800 },
  { family: 'Nunito Sans', category: 'sans', bold: 800 },
  { family: 'Roboto', category: 'sans', bold: 800 },
  { family: 'Open Sans', category: 'sans', bold: 800 },
  { family: 'Source Sans 3', category: 'sans', bold: 800 },
  { family: 'IBM Plex Sans', category: 'sans', bold: 700 },
  { family: 'Space Grotesk', category: 'sans', bold: 700 },
  { family: 'Rubik', category: 'sans', bold: 800 },
  { family: 'Urbanist', category: 'sans', bold: 800 },
  { family: 'Archivo', category: 'sans', bold: 800 },
  { family: 'Red Hat Display', category: 'sans', bold: 800 },
  { family: 'Playfair Display', category: 'serif', bold: 800 },
  { family: 'Merriweather', category: 'serif', bold: 800 },
  { family: 'Lora', category: 'serif', bold: 700 },
  { family: 'Fraunces', category: 'serif', bold: 800 },
  { family: 'Source Serif 4', category: 'serif', bold: 800 }
]

/** The listed family with this name, matched without regard to case. */
export function findFont(family: string | null | undefined): FontChoice | null {
  const wanted = (family || '').trim().toLowerCase()
  return FONT_CHOICES.find(f => f.family.toLowerCase() === wanted) ?? null
}
