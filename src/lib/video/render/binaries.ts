import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { BrowserBinary } from './browser'

/**
 * The browser and ffmpeg the recorder runs. Locally: CHROMIUM_PATH and
 * FFMPEG_PATH when set, else an installed Chrome, Chromium, Brave or Edge and
 * the ffmpeg from the ffmpeg-static package. On Vercel: the Chromium build in
 * @sparticuz/chromium, unpacked into /tmp on first use, and the same ffmpeg.
 * next.config.ts deploys both binaries in their packages' own folders, with
 * the routes that record (see outputFileTracingIncludes).
 */

/** Recording cannot run here: no browser or no ffmpeg. */
export class RendererUnavailableError extends Error {}

const LINUX = [
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'brave',
  'brave-browser',
  'microsoft-edge'
]
const MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
]
const WINDOWS = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Chromium', 'Application', 'chrome.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe']
]

const onPath = (command: string) =>
  (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(dir => path.join(dir, command))
    .find(file => existsSync(file))

/** An installed Chromium-based browser, as the toolkit finds one. */
export function findInstalledChromium(): string | undefined {
  if (process.platform === 'darwin') return MAC.find(file => existsSync(file))
  if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA
    ].filter((root): root is string => Boolean(root))
    for (const parts of WINDOWS)
      for (const root of roots) {
        const file = path.join(root, ...parts)
        if (existsSync(file)) return file
      }
    return undefined
  }
  for (const command of LINUX) {
    const file = onPath(command)
    if (file) return file
  }
  return undefined
}

/** Vercel and other AWS Lambda hosts: no browser installed, only /tmp writable. */
const onServerless = () =>
  Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

// Unpacked once per process: two unpacks at once would write over each other.
let unpacked: Promise<BrowserBinary | null> | null = null

/** The serverless Chromium build, unpacked; null where it is not deployed. */
function serverlessChromium(): Promise<BrowserBinary | null> {
  unpacked ??= unpackChromium().then(found => {
    if (!found) unpacked = null
    return found
  })
  return unpacked
}

async function unpackChromium(): Promise<BrowserBinary | null> {
  if (process.platform !== 'linux' || process.arch !== 'x64') return null
  try {
    // The package finds its own bin folder, where next.config.ts deploys it.
    const { default: chromium } = await import('@sparticuz/chromium')
    return {
      executable: await chromium.executablePath(),
      args: chromium.args
    }
  } catch (err) {
    console.warn('The serverless Chromium could not be unpacked:', err)
    return null
  }
}

export async function findBrowser(): Promise<BrowserBinary> {
  const configured = process.env.CHROMIUM_PATH?.trim()
  if (configured) return { executable: configured, args: [] }
  if (!onServerless()) {
    const installed = findInstalledChromium()
    if (installed) return { executable: installed, args: [] }
  }
  const bundled = await serverlessChromium()
  if (bundled) return bundled
  throw new RendererUnavailableError(
    'No browser was found to record the video. Install Chrome, Chromium, Brave or Edge, or set CHROMIUM_PATH.'
  )
}

/**
 * A path under node_modules, built from parts: the bundler's tracing cannot
 * follow it, so it never deploys the 80 MB ffmpeg with every route that
 * imports this file. (Importing ffmpeg-static did exactly that.)
 */
const underModules = (...parts: string[]) =>
  path.join(process.cwd(), 'node_modules', ...parts)

/**
 * The binary ffmpeg-static downloaded: through its link in node_modules
 * locally, or in its own folder in pnpm's store, which is where a deploy
 * has it (next.config.ts). Null without it.
 */
function bundledFfmpeg(): string | null {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const pkg = ['ffmpeg', 'static'].join('-')
  const linked = underModules(pkg, name)
  if (existsSync(linked)) return linked
  try {
    for (const dir of readdirSync(underModules('.pnpm'))) {
      if (!dir.startsWith(`${pkg}@`)) continue
      const file = underModules('.pnpm', dir, 'node_modules', pkg, name)
      if (existsSync(file)) return file
    }
  } catch {
    // No pnpm store here.
  }
  return null
}

export async function findFfmpeg(): Promise<string> {
  const configured = process.env.FFMPEG_PATH?.trim()
  if (configured) return configured
  const bundled = bundledFfmpeg()
  if (bundled) return bundled
  const installed = onPath(
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  )
  if (installed) return installed
  throw new RendererUnavailableError(
    'ffmpeg was not found to encode the video. Reinstall dependencies (ffmpeg-static downloads it) or set FFMPEG_PATH.'
  )
}
