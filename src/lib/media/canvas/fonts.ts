import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_FONT, findFont } from '~/lib/brand/fonts'

/**
 * Typefaces for the canvas renderer. Inter ships with the app; any other
 * family from FONT_CHOICES is fetched from Google Fonts as TTF (the only
 * formats satori reads are TTF, OTF and WOFF) and cached in memory and on
 * disk. A family that cannot be fetched is replaced by Inter, and the caller
 * is told so it can say so.
 *
 * No `server-only` import, so tests can render with the bundled font.
 */

export interface SatoriFont {
  name: string
  data: Buffer
  weight: 400 | 600 | 700 | 800
  style: 'normal'
}

export interface LoadedFonts {
  fonts: SatoriFont[]
  heading: string
  body: string
  headingWeight: 700 | 800
  /** Typefaces that could not be loaded, in words fit to show. */
  issues: string[]
}

const BUNDLED_DIR = join(process.cwd(), 'src/lib/media/canvas/fonts')
const CACHE_DIR = join(tmpdir(), 'linkedin-canvas-fonts')
const FETCH_TIMEOUT_MS = 10_000

let bundled: Promise<SatoriFont[]> | null = null

function loadBundled(): Promise<SatoriFont[]> {
  bundled ??= Promise.all(
    ([400, 600, 800] as const).map(async weight => ({
      name: DEFAULT_FONT,
      data: await readFile(join(BUNDLED_DIR, `${DEFAULT_FONT}-${weight}.ttf`)),
      weight,
      style: 'normal' as const
    }))
  ).catch(err => {
    bundled = null
    throw err
  })
  return bundled
}

const fetched = new Map<string, Promise<SatoriFont[] | null>>()

const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-')

async function fetchFamily(
  family: string,
  weights: Array<400 | 600 | 700 | 800>
): Promise<SatoriFont[]> {
  const files = weights.map(w => join(CACHE_DIR, `${slug(family)}-${w}.ttf`))
  try {
    const data = await Promise.all(files.map(f => readFile(f)))
    return data.map((d, i) => ({
      name: family,
      data: d,
      weight: weights[i]!,
      style: 'normal' as const
    }))
  } catch {
    // Not cached yet.
  }

  // Without a browser user agent, the CSS API answers with TTF URLs.
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weights.join(';')}`,
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  )
  if (!css.ok) throw new Error(`Google Fonts answered ${css.status}`)
  const faces = [
    ...(await css.text()).matchAll(
      /font-weight:\s*(\d+);[\s\S]*?src:\s*url\((https:[^)]+)\)\s*format\('truetype'\)/g
    )
  ]
  const fonts = await Promise.all(
    weights.map(async weight => {
      const url = faces.find(f => Number(f[1]) === weight)?.[2]
      if (!url) throw new Error(`no ${weight} weight`)
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (!res.ok) throw new Error(`font file answered ${res.status}`)
      return {
        name: family,
        data: Buffer.from(await res.arrayBuffer()),
        weight,
        style: 'normal' as const
      }
    })
  )
  // The cache only saves a download; failing to write it changes nothing.
  await mkdir(CACHE_DIR, { recursive: true })
    .then(() =>
      Promise.all(fonts.map((f, i) => writeFile(files[i]!, f.data)))
    )
    .catch(() => {})
  return fonts
}

function loadFamily(family: string): Promise<SatoriFont[] | null> {
  const choice = findFont(family)
  if (!choice) return Promise.resolve(null)
  const weights: Array<400 | 600 | 700 | 800> = [400, 600, choice.bold]
  let pending = fetched.get(choice.family)
  if (!pending) {
    pending = fetchFamily(choice.family, weights).catch(err => {
      console.warn(`Could not load the ${choice.family} typeface:`, err)
      // Tried again on the next image, not cached as missing.
      fetched.delete(choice.family)
      return null
    })
    fetched.set(choice.family, pending)
  }
  return pending
}

/**
 * The fonts for one image: Inter always (it also fills in any glyph a brand
 * typeface lacks), plus the theme's heading and body families.
 */
export async function loadCanvasFonts(theme: {
  headingFont: string
  bodyFont: string
}): Promise<LoadedFonts> {
  const fonts = [...(await loadBundled())]
  const issues: string[] = []

  const resolve = async (family: string, role: string) => {
    const choice = findFont(family)
    if (!choice || choice.family === DEFAULT_FONT) {
      return { name: DEFAULT_FONT, bold: 800 as const }
    }
    const loaded = await loadFamily(choice.family)
    if (!loaded) {
      issues.push(
        `The ${role} typeface ${choice.family} could not be loaded, so ${DEFAULT_FONT} was used.`
      )
      return { name: DEFAULT_FONT, bold: 800 as const }
    }
    if (!fonts.some(f => f.name === choice.family)) fonts.unshift(...loaded)
    return { name: choice.family, bold: choice.bold }
  }

  const heading = await resolve(theme.headingFont, 'headline')
  const body = await resolve(theme.bodyFont, 'body')
  return {
    fonts,
    heading: heading.name,
    body: body.name,
    headingWeight: heading.bold,
    issues
  }
}
