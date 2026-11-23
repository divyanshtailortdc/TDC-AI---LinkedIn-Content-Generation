import screenshots from './screenshots.json'

/*
 * The app screenshots the help pages show, made by `pnpm docs:screenshots`
 * (scripts/docs-screenshots): public/docs/screenshots/<name>.webp, with
 * their sizes in screenshots.json. Plain data, for pages and tests alike.
 */

export type ScreenshotSize = { width: number; height: number }

const SIZES: Record<string, ScreenshotSize | undefined> = screenshots

export const SCREENSHOT_DIR = '/docs/screenshots'

export function screenshotSrc(name: string) {
  return `${SCREENSHOT_DIR}/${name}.webp`
}

export function screenshotSize(name: string): ScreenshotSize | undefined {
  return SIZES[name]
}
