// Shared by the docs screenshot scripts: a signed-in browser for the demo
// user (see demo-user.mjs) on the running dev server.
import fs from 'node:fs'
import os from 'node:os'
import { chromium } from 'playwright-core'
import { SESSION_FILE } from './demo-user.mjs'

export { SESSION_FILE }
export const BASE = (process.env.DOCS_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
export const CHROME_PATH =
  process.env.CHROME_PATH ?? `${os.homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`

export function readSession() {
  if (!fs.existsSync(SESSION_FILE)) {
    throw new Error(`No session in ${SESSION_FILE}. Run: node --env-file=.env scripts/docs-screenshots/demo-user.mjs`)
  }
  return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'))
}

/** A light-theme browser signed in as the demo user. */
export async function openBrowser({ width = 1440, height = 900, deviceScaleFactor = 1 } = {}) {
  const session = readSession()
  if (!fs.existsSync(CHROME_PATH)) throw new Error(`No Chromium at ${CHROME_PATH}; set CHROME_PATH.`)
  const browser = await chromium.launch({ executablePath: CHROME_PATH })
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    // The dev server's own zone (it runs on this machine), so dates the
    // server renders match the browser's and React hydrates without errors.
    timezoneId: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone
  })
  // The cookie's name follows BETTER_AUTH_URL's scheme; set both spellings so
  // either server setup accepts it (Chrome keeps Secure cookies on localhost).
  const value = session.value
  const host = new URL(BASE).hostname
  await context.addCookies(
    ['__Secure-better-auth.session_token', 'better-auth.session_token'].map(name => ({
      name,
      value,
      domain: host,
      path: '/',
      httpOnly: true,
      secure: name.startsWith('__Secure-'),
      sameSite: 'Lax'
    }))
  )
  // The app's theme toggle (next-themes) reads this; keep every page light.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('theme', 'light')
    } catch {}
  })
  // Never reach Buffer from the demo browser.
  await context.route(/^https:\/\/([a-z0-9-]+\.)*buffer\.com\//, route => route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
  })
  return { browser, context, page, errors, session }
}

export function log(...args) {
  console.log(...args)
}
