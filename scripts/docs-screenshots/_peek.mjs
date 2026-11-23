import { openBrowser, BASE } from './lib.mjs'
const paths = process.argv.slice(2)
const { browser, page, errors } = await openBrowser()
try {
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil: 'networkidle' }).catch(e => console.log('goto', e.message))
    await page.waitForTimeout(800)
    const name = p.replace(/\W+/g, '_') || 'root'
    await page.screenshot({ path: `/tmp/docs-shots/peek-${name}.png` })
    console.log(p, '→', page.url(), `/tmp/docs-shots/peek-${name}.png`)
  }
} finally { if (errors.length) console.log(errors.join('\n')); await browser.close() }
