// Annotated screenshots for the in-app help docs: each shot opens a page of
// the running app as the fictional demo customer (Northwind Studio, see
// demo-user.mjs and seed-demo.mjs), draws a red callout box around the
// control the guide talks about, and saves a cropped WebP to
// public/docs/screenshots/<name>.webp. Their sizes go to
// src/docs/screenshots.json, which the docs read.
//
//   pnpm docs:screenshots                      (every shot)
//   pnpm docs:screenshots --only ideas,posts   (some; merged into the manifest)
//
// Needs: the app running (DOCS_BASE_URL, default http://localhost:3000), the
// demo workspace seeded once (seed-demo.mjs), and .env for the database and
// auth secret (a fresh demo session is signed on every run). Chromium comes
// from CHROME_PATH, default Playwright's cached build. Spends no AI: nothing
// is generated, saved or published; dialogs are opened and left unsent.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (fs.existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env'))

const { mintDemoSession } = await import('./demo-user.mjs')
const { BASE, openBrowser } = await import('./lib.mjs')

const OUT_DIR = path.join(ROOT, 'public/docs/screenshots')
const MANIFEST = path.join(ROOT, 'src/docs/screenshots.json')
const VIEWPORT = { width: 1440, height: 900 }
const SCALE = 2
const MIN_WIDTH = 1000
const QUALITY = 82
const MAX_BYTES = 250 * 1024

// ---------------------------------------------------------------------------
// The demo workspace's ids, for pages addressed by id.

const session = await mintDemoSession()
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
const ids = await (async () => {
  try {
    const [identity] = await sql`select id from accounts where user_id = ${session.userId} order by created_at limit 1`
    if (!identity) throw new Error('The demo user has no identity yet. Run scripts/docs-screenshots/seed-demo.mjs first.')
    const [run] = await sql`select id from runs where account_id = ${identity.id} order by created_at limit 1`
    // The post the editor shots open: a LinkedIn post still awaiting review.
    const [post] = await sql`
      select id from post_drafts
      where account_id = ${identity.id} and platform = 'linkedin' and status = 'awaiting_review'
      order by created_at limit 1`
    // An approved idea with no posts yet, for "Create 1 post".
    const [spareIdea] = await sql`
      select i.title from ideas i
      where i.account_id = ${identity.id} and i.status = 'approved'
        and not exists (select 1 from post_drafts d where d.idea_id = i.id)
      order by i.created_at limit 1`
    return { identity: identity.id, run: run?.id, post: post?.id, spareIdeaTitle: spareIdea?.title }
  } finally {
    await sql.end()
  }
})()

// ---------------------------------------------------------------------------
// The shots. Each: the page, optional setup (open a dialog or menu), the
// element(s) to box, and the region to crop.
//   targets(page) → Locator[]: one callout box each; `merge` puts one box
//     around them all, `mergeEach` one around every match of each locator.
//   context(page) → Locator[]: what the crop must also show.
//   The crop spans the main area's full width (1160px) and the targets'
//   height plus a margin. Options:
//   header: reach up to the top of the page (its title and buttons).
//   sidebar: start at the left edge, 1000px wide (shots about navigation).
//   narrow: 1000px wide around the targets (when the rest is empty).
//   minHeight: at least this tall. anchor 'bottom-right': for the corner.
//   keep: page furniture left visible ('help' button, 'onboarding' guide).
//   height: a taller window (CSS px) for a target that doesn't fit in 900.

/** The innermost <section> holding the text (a card on most pages). */
const sectionWith = (page, text) => page.locator('section').filter({ has: page.getByText(text, { exact: typeof text === 'string' }) }).last()
const dialogNamed = (page, name) => page.getByRole('dialog', { name })

const SHOTS = [
  {
    name: 'dashboard',
    path: '/',
    keep: ['onboarding'],
    // The getting-started checklist is taller than the usual window.
    height: 1400,
    targets: async page => {
      // The getting-started checklist when the onboarding guide is on; the
      // identity card's setup checklist otherwise.
      const onboarding = page.locator('section[aria-labelledby="onboarding-title"]')
      if (await onboarding.count()) return [onboarding]
      return [page.getByText('Setup checklist', { exact: true }).locator('xpath=../..')]
    },
    context: async page => {
      const onboarding = page.locator('section[aria-labelledby="onboarding-title"]')
      if (await onboarding.count()) return []
      return [page.getByRole('heading', { name: 'Your identity' }).locator('xpath=..')]
    }
  },
  {
    name: 'dashboard-usage',
    path: '/',
    header: true,
    targets: page => [page.getByRole('heading', { name: 'Token usage' }).locator('xpath=../..')]
  },
  {
    name: 'identity-switcher',
    path: '/posts',
    sidebar: true,
    header: true,
    setup: async page => {
      await page.locator('aside button[aria-haspopup="menu"]').first().click()
      await page.getByRole('menu', { name: 'Switch identity' }).waitFor()
    },
    targets: page => [page.getByRole('menu', { name: 'Switch identity' })],
    minHeight: 460
  },
  {
    name: 'profile',
    path: '/identity',
    targets: page => [sectionWith(page, 'Platforms'), sectionWith(page, 'Online presence')],
    merge: true
  },
  {
    name: 'voice',
    path: '/identity/voice',
    header: true,
    targets: page => [page.getByRole('radiogroup', { name: 'Writing style' }).locator('xpath=..')],
    context: page => [page.getByText('Adjust if needed', { exact: true })]
  },
  {
    name: 'knowledge',
    path: '/identity/knowledge',
    header: true,
    setup: async page => {
      const fetchButton = page.getByRole('button', { name: 'Fetch', exact: true })
      if (!(await fetchButton.isVisible())) {
        await page.locator('main header').first().getByRole('button', { name: 'Edit', exact: true }).click()
      }
      await page.getByRole('button', { name: 'Add a link' }).click()
      await fetchButton.waitFor({ state: 'visible' })
    },
    targets: page => [page.getByPlaceholder('https://example.com/article'), page.getByRole('button', { name: 'Fetch', exact: true })],
    merge: true
  },
  {
    name: 'preferences',
    path: '/identity/preferences',
    header: true,
    targets: page => [page.getByText('Ideas per run', { exact: true }).locator('xpath=..')],
    context: page => [page.getByText('What each run suggests.', { exact: true })]
  },
  {
    name: 'runs',
    path: '/identity/runs',
    header: true,
    targets: page => [page.getByRole('button', { name: 'Generate Now' }).or(page.getByRole('link', { name: 'Generate Now' })).first()],
    // The cost tiles and the first run under it.
    context: page => [page.locator('main a[href^="/runs/"]').first()]
  },
  {
    name: 'goals',
    path: '/goals',
    header: true,
    targets: page => [page.locator('main header').first().getByRole('button', { name: /New Goal/ })],
    context: page => [page.getByRole('heading', { name: /Your Goals/ })],
    minHeight: 640
  },
  {
    name: 'generate-ideas',
    path: '/goals',
    setup: async page => {
      await page.locator('main header').first().getByRole('button', { name: /^Generate ideas/ }).click()
      const dialog = dialogNamed(page, 'Generate ideas')
      await dialog.waitFor()
      const selectAll = dialog.getByRole('button', { name: 'Select all' })
      if (await selectAll.count()) await selectAll.click()
    },
    targets: page => {
      const dialog = dialogNamed(page, 'Generate ideas')
      return [dialog.locator('fieldset ul').first(), dialog.getByRole('button', { name: /^Generate for/ })]
    },
    context: page => [dialogNamed(page, 'Generate ideas')],
    margin: 40
  },
  {
    name: 'ideas',
    path: '/ideas',
    header: true,
    targets: page => {
      const waiting = page.locator('article').filter({ has: page.getByRole('button', { name: 'Approve', exact: true }) }).first()
      return [waiting.getByRole('button', { name: 'Reject', exact: true }), waiting.getByRole('button', { name: 'Approve', exact: true })]
    },
    merge: true,
    context: page => [page.locator('article').filter({ has: page.getByRole('button', { name: 'Approve', exact: true }) }).first()]
  },
  {
    name: 'idea-scorecard',
    path: '/ideas',
    narrow: true,
    setup: async page => {
      const waiting = page.locator('article').filter({ has: page.getByRole('button', { name: 'Approve', exact: true }) }).first()
      await waiting.getByRole('button', { name: 'Details' }).click()
      await waiting.getByText('How it scores', { exact: true }).waitFor()
    },
    targets: page => [page.getByText('How it scores', { exact: true }).first().locator('xpath=..')]
  },
  {
    name: 'create-posts',
    path: '/ideas',
    setup: async page => {
      const box = ids.spareIdeaTitle
        ? page.getByRole('checkbox', { name: `Select "${ids.spareIdeaTitle}" for posts` })
        : page.getByRole('checkbox', { name: /^Select ".*" for posts$/ }).first()
      await box.check()
      await page.getByRole('button', { name: /^Create \d+ posts?$/ }).click()
      const dialog = dialogNamed(page, /^Create \d+ posts?$/)
      await dialog.waitFor()
      // LinkedIn picked, so "2. Type of post" lists its types.
      const linkedin = dialog.getByRole('button', { name: /^LinkedIn/ })
      if ((await linkedin.getAttribute('aria-pressed')) !== 'true') await linkedin.click()
    },
    targets: page => {
      const dialog = dialogNamed(page, /^Create \d+ posts?$/)
      return [
        dialog.locator('fieldset').filter({ hasText: '1. Platform' }),
        dialog.locator('fieldset').filter({ hasText: '2. Type of post' })
      ]
    },
    context: page => [dialogNamed(page, /^Create \d+ posts?$/)],
    margin: 40
  },
  {
    name: 'run-details',
    path: () => `/runs/${ids.run}`,
    header: true,
    targets: page => [
      page
        .locator('main header')
        .first()
        .locator('span')
        .filter({ hasText: /^(Ideas to review|Completed|Generating ideas|Researching|Gathering context|Drafting posts|Failed|Stopped|Queued|Waiting to start)/ })
        .first(),
      sectionWith(page, 'Pipeline')
    ]
  },
  {
    name: 'posts',
    path: '/posts',
    header: true,
    targets: page => [
      page.getByRole('group', { name: 'Show posts by status' }),
      page.locator('main article, main li, main div.rounded-2xl').filter({ hasText: 'Awaiting review' }).filter({ has: page.locator('img, button') }).last()
    ]
  },
  {
    name: 'post-editor',
    path: () => `/posts/${ids.post}`,
    header: true,
    // Regenerate and Edit text sit side by side: one box around both.
    targets: page => [
      page.getByRole('button', { name: 'Regenerate', exact: true }).or(page.getByRole('button', { name: 'Edit text' })),
      page.locator('main header').first().getByRole('button', { name: /^Approve/ })
    ],
    mergeEach: true,
    minHeight: 470
  },
  {
    name: 'post-type-picker',
    path: () => `/posts/${ids.post}`,
    header: true,
    targets: page => [page.getByRole('radiogroup', { name: 'Post type' })],
    minHeight: 560
  },
  {
    name: 'brand-theme',
    path: '/brand',
    header: true,
    targets: page => [sectionWith(page, 'Brand Colours'), page.getByRole('radiogroup', { name: 'Image style' })]
  },
  {
    name: 'newsletters-discover',
    path: '/newsletters',
    header: true,
    targets: async page => {
      const signup = page.getByRole('link', { name: /Open signup page/i }).or(page.getByRole('button', { name: /Open signup page/i }))
      if (await signup.count()) return [signup.first()]
      return [page.getByRole('button', { name: 'Discover Newsletters' }).last()]
    },
    minHeight: 460
  },
  {
    name: 'newsletters-inbox',
    path: '/newsletters/inbox',
    header: true,
    targets: page => [page.getByText('Your address', { exact: true }), page.getByRole('button', { name: 'Copy the address' })],
    merge: true,
    minHeight: 460
  },
  {
    name: 'schedule',
    path: '/schedule',
    header: true,
    // Schedule has no auto-publish control (it is under Settings →
    // Integrations once Buffer is connected): the calendar and the list of
    // posts still to plan, with their day pickers, instead.
    // (A six-week month with the month bar above it is taller than the
    // window, so the page scrolls down to the calendar.)
    targets: page => [page.locator('section[aria-label^="Posts planned in"]'), sectionWith(page, /^Not planned yet/)]
  },
  {
    name: 'integrations',
    path: '/settings/integrations',
    header: true,
    targets: page => [page.getByRole('link', { name: 'Connect Buffer' }).or(page.getByRole('button', { name: 'Connect Buffer' })).first()],
    context: page => [sectionWith(page, 'No Buffer account connected')]
  },
  {
    name: 'security',
    path: '/settings',
    header: true,
    targets: page => [page.getByRole('button', { name: 'Add passkey' })],
    context: page => [sectionWith(page, 'Passkeys')]
  },
  {
    name: 'theme',
    path: '/settings/theme',
    header: true,
    setup: async page => {
      const edit = page.getByRole('button', { name: 'Edit', exact: true })
      if (await edit.count()) await edit.click()
    },
    targets: page =>
      ['Light mode', 'Dark mode'].map(mode => page.locator(`section[aria-label="${mode}"]`).locator('label, input')),
    mergeEach: true
  },
  {
    name: 'help-button',
    path: '/posts',
    keep: ['help'],
    setup: async page => {
      await page.getByRole('button', { name: 'Help', exact: true }).last().click()
      const action = helpAction(page)
      await action.waitFor({ state: 'visible' })
      await page.waitForTimeout(300)
      await action.hover()
      await page.waitForTimeout(300)
    },
    targets: page => [helpAction(page)],
    anchor: 'bottom-right',
    scroll: 'none',
    minHeight: 460
  }
]

/** The help button's "Help for this page" action (the first, Documentation, until it is renamed). */
function helpAction(page) {
  return page
    .getByRole('link', { name: /Help for this page/i })
    .or(page.locator('ul[aria-label="Help"] a').first())
    .first()
}

// ---------------------------------------------------------------------------

const onlyArg = process.argv.find(a => a === '--only' || a.startsWith('--only='))
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : process.argv[process.argv.indexOf(onlyArg) + 1] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  : null
if (only) {
  const unknown = only.filter(n => !SHOTS.some(s => s.name === n))
  if (unknown.length) throw new Error(`Unknown shot(s): ${unknown.join(', ')}. Known: ${SHOTS.map(s => s.name).join(', ')}`)
}
const shots = only ? SHOTS.filter(s => only.includes(s.name)) : SHOTS

fs.mkdirSync(OUT_DIR, { recursive: true })
const manifest = only && fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {}

const { browser, page, errors } = await openBrowser({ ...VIEWPORT, deviceScaleFactor: SCALE })
page.setDefaultTimeout(15_000)
const failed = []
try {
  for (const shot of shots) {
    try {
      await page.setViewportSize({ width: VIEWPORT.width, height: shot.height ?? VIEWPORT.height })
      const result = await capture(shot)
      manifest[shot.name] = { width: result.width, height: result.height }
      console.log(`✔ ${shot.name.padEnd(22)} ${result.width}×${result.height}  ${Math.round(result.bytes / 1024)} KB`)
    } catch (err) {
      failed.push(shot.name)
      console.error(`✘ ${shot.name}: ${err.message.split('\n')[0]}`)
      await page.screenshot({ path: `/tmp/docs-shots/failed-${shot.name}.png` }).catch(() => {})
    }
  }
} finally {
  await browser.close()
}

// Keep the manifest in the order of SHOTS, so diffs stay small.
const ordered = Object.fromEntries(
  [...SHOTS.map(s => s.name), ...Object.keys(manifest)]
    .filter((name, i, all) => manifest[name] && all.indexOf(name) === i)
    .map(name => [name, manifest[name]])
)
fs.writeFileSync(MANIFEST, JSON.stringify(ordered, null, 2) + '\n')
console.log(`manifest: ${path.relative(ROOT, MANIFEST)} (${Object.keys(ordered).length} shots)`)
const appErrors = errors.filter(e => !/Download the React DevTools|\[HMR\]|\[Fast Refresh\]/.test(e))
if (appErrors.length) console.log(`browser errors during capture:\n  ${[...new Set(appErrors)].slice(0, 10).join('\n  ')}`)
if (failed.length) {
  console.error(`failed: ${failed.join(', ')} (page at failure: /tmp/docs-shots/failed-<name>.png)`)
  process.exitCode = 1
}

// ---------------------------------------------------------------------------

async function capture(shot) {
  const url = BASE + (typeof shot.path === 'function' ? shot.path() : shot.path)
  if (url.includes('undefined')) throw new Error(`no demo data for ${shot.name} (seed the demo workspace)`)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await settle()
  await tidy(shot)
  if (shot.setup) {
    await shot.setup(page)
    await settle()
    await tidy(shot)
  }

  const targets = await shot.targets(page)
  for (const t of targets) await t.first().waitFor({ state: 'visible' })
  const context = shot.context ? await shot.context(page) : []

  // Bring what matters into view, inside the page's own scroll area.
  if (shot.scroll !== 'none') await scrollIntoFrame([...targets, ...context])
  await finishAnimations()

  // One box per target (or per target group with mergeEach, or one for all with merge).
  const groups = []
  for (const t of targets) groups.push(await boxesOf(t, { all: shot.mergeEach }))
  let boxes = groups.map(union)
  if (shot.merge) boxes = [union(boxes)]
  const contextBoxes = []
  for (const c of context) contextBoxes.push(...(await boxesOf(c.first())))

  const clip = cropFor(shot, boxes, contextBoxes, (await frame()).mainLeft)
  await drawCallouts(boxes)
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
  await page.evaluate(() => document.getElementById('docs-callouts')?.remove())

  const out = path.join(OUT_DIR, `${shot.name}.webp`)
  let quality = QUALITY
  let webp = await sharp(png).webp({ quality, effort: 6 }).toBuffer()
  while (webp.length > MAX_BYTES && quality > 60) {
    quality -= 6
    webp = await sharp(png).webp({ quality, effort: 6 }).toBuffer()
  }
  fs.writeFileSync(out, webp)
  const meta = await sharp(webp).metadata()
  return { width: meta.width, height: meta.height, bytes: webp.length }
}

/** Waits for the page to go quiet: network, fonts, images. */
async function settle() {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
  await page.evaluate(async () => {
    await document.fonts.ready
    const pending = [...document.images].filter(img => !img.complete)
    await Promise.race([
      Promise.all(
        pending.map(
          img =>
            new Promise(done => {
              img.addEventListener('load', done, { once: true })
              img.addEventListener('error', done, { once: true })
            })
        )
      ),
      new Promise(done => setTimeout(done, 5000))
    ])
  })
  await page.waitForTimeout(400)
}

/** Ends finite CSS animations and transitions so nothing is caught half way. */
async function finishAnimations() {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      try {
        if (a.effect?.getTiming().iterations !== Infinity) a.finish()
      } catch {}
    }
  })
  await page.waitForTimeout(150)
}

/** Removes dev tooling and page furniture that would clutter the shot. */
async function tidy(shot) {
  const keep = shot.keep ?? []
  await page.evaluate(
    ({ keepHelp, keepOnboarding }) => {
      document.querySelectorAll('nextjs-portal').forEach(el => el.remove())
      let style = document.getElementById('docs-shot-style')
      if (!style) {
        style = document.createElement('style')
        style.id = 'docs-shot-style'
        document.head.appendChild(style)
      }
      style.textContent = [
        // Toasts (top right).
        '.pointer-events-none.fixed.top-5.right-5 { display: none !important; }',
        keepHelp ? '' : 'ul[aria-label="Help"], button[aria-controls][aria-label="Help"], button[aria-label="Close help"] { visibility: hidden !important; }',
        keepOnboarding
          ? ''
          : 'section[aria-label="Getting started guide"], section[aria-labelledby="onboarding-title"] { display: none !important; }',
        // Blinking carets and scrollbars.
        '* { caret-color: transparent !important; scrollbar-width: none !important; }',
        '*::-webkit-scrollbar { display: none !important; }'
      ].join('\n')
    },
    { keepHelp: keep.includes('help'), keepOnboarding: keep.includes('onboarding') }
  )
}

/** The element's box(es) in viewport coordinates. */
async function boxesOf(locator, { all = false } = {}) {
  const list = all ? await locator.all() : [locator.first()]
  const boxes = []
  for (const l of list) {
    const b = await l.boundingBox()
    if (b && b.width > 0 && b.height > 0) boxes.push(b)
  }
  if (!boxes.length) throw new Error(`no visible box for ${locator}`)
  return boxes
}

function union(boxes) {
  const x = Math.min(...boxes.map(b => b.x))
  const y = Math.min(...boxes.map(b => b.y))
  const right = Math.max(...boxes.map(b => b.x + b.width))
  const bottom = Math.max(...boxes.map(b => b.y + b.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** The main area's left edge, and the top of what its scroll area shows under the page header. */
async function frame() {
  return page.evaluate(() => {
    const main = document.querySelector('main')?.getBoundingClientRect()
    const header = document.querySelector('main header')?.getBoundingClientRect()
    return { mainLeft: main ? Math.round(main.left) : 0, headerBottom: header ? Math.round(header.bottom) : 0 }
  })
}

/**
 * Scrolls the targets' scroll area so all of them (and their context) are in
 * view below the page header: centred when they fit, else from the top.
 * Nothing moves when they are already in view.
 */
async function scrollIntoFrame(locators) {
  const boxes = []
  for (const l of locators) boxes.push(...(await boxesOf(l.first())))
  const want = union(boxes)
  const { headerBottom } = await frame()
  await locators[0].first().evaluate(
    (el, { want, headerBottom }) => {
      let scroller = el.parentElement
      while (scroller && scroller !== document.body) {
        const style = getComputedStyle(scroller)
        if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break
        scroller = scroller.parentElement
      }
      if (!scroller || scroller === document.body) return
      const box = scroller.getBoundingClientRect()
      const top = Math.max(box.top, headerBottom) + 16
      const bottom = Math.min(box.bottom, innerHeight) - 16
      if (want.y >= top && want.y + want.height <= bottom) return
      const room = bottom - top
      const goal = want.height <= room ? top + (room - want.height) / 2 : top
      scroller.scrollTop += want.y - goal
    },
    { want, headerBottom }
  )
  await page.waitForTimeout(250)
}

/**
 * The crop: the main area's full width (1000px from the left edge with
 * `sidebar`, 1000px around the targets with `narrow`), as tall as the
 * targets and their context plus a margin; from the top with `header`.
 */
function cropFor(shot, boxes, contextBoxes, mainLeft) {
  const M = shot.margin ?? 24 // margin around the content
  const C = 14 // room for the callout (6px out + border + glow)
  const all = [...boxes.map(b => grow(b, C)), ...contextBoxes]
  const content = grow(union(all), M)
  let top = shot.header ? 0 : content.y
  let bottom = content.y + content.height
  let left = mainLeft
  let right = VIEWPORT.width

  if (shot.sidebar) {
    left = 0
    right = MIN_WIDTH
  } else if (shot.narrow) {
    const middle = content.x + content.width / 2
    left = Math.max(mainLeft, Math.min(middle - MIN_WIDTH / 2, VIEWPORT.width - MIN_WIDTH))
    right = left + Math.max(MIN_WIDTH, Math.min(content.width, VIEWPORT.width - mainLeft))
  }
  const windowHeight = shot.height ?? VIEWPORT.height
  if (shot.anchor === 'bottom-right') bottom = windowHeight

  const minHeight = shot.minHeight ?? 0
  if (bottom - top < minHeight) {
    if (shot.anchor === 'bottom-right') top = bottom - minHeight
    else bottom = top + minHeight
  }
  top = Math.max(0, top)
  bottom = Math.min(windowHeight, bottom)
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) }
}

function grow(b, by) {
  return { x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 }
}

/** The red callout boxes, drawn over the page 6px outside each target. */
async function drawCallouts(boxes) {
  await page.evaluate(boxes => {
    const layer = document.createElement('div')
    layer.id = 'docs-callouts'
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    for (const b of boxes) {
      const el = document.createElement('div')
      el.style.cssText = [
        'position:absolute',
        `left:${b.x - 6}px`,
        `top:${b.y - 6}px`,
        `width:${b.width + 12}px`,
        `height:${b.height + 12}px`,
        'box-sizing:border-box',
        'border:2.5px solid #e5484d',
        'border-radius:8px',
        'box-shadow:0 0 0 4px rgba(229,72,77,0.15)'
      ].join(';')
      layer.appendChild(el)
    }
    document.body.appendChild(layer)
  }, boxes)
}
