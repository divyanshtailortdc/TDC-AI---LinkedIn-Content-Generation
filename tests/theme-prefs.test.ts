import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  contrastRatio,
  DEFAULT_THEME_PREFS,
  parseThemePrefs,
  themePrefsCss
} from '../src/lib/theme-prefs'

describe('theme preferences', () => {
  it('falls back to the defaults for a missing or broken cookie', () => {
    assert.deepEqual(parseThemePrefs(undefined), DEFAULT_THEME_PREFS)
    assert.deepEqual(parseThemePrefs('not json'), DEFAULT_THEME_PREFS)
    assert.deepEqual(parseThemePrefs('null'), DEFAULT_THEME_PREFS)
  })

  it('keeps only #rrggbb colours, so nothing else reaches the CSS', () => {
    const prefs = parseThemePrefs(
      JSON.stringify({
        light: { primary: '#FF0000', secondary: 'red;}body{display:none' },
        dark: { primary: '</style><script>', secondary: '#00ff00' }
      })
    )
    assert.deepEqual(prefs, {
      light: { primary: '#ff0000', secondary: '#159bb2' },
      dark: { primary: '#fafafa', secondary: '#00ff00' }
    })
    const css = themePrefsCss(prefs)
    assert.ok(!css.includes('<') && !css.includes('display'))
  })

  it('writes no CSS for the defaults', () => {
    assert.equal(themePrefsCss(DEFAULT_THEME_PREFS), '')
  })

  it('keeps a light colour out of dark mode', () => {
    const css = themePrefsCss({
      ...DEFAULT_THEME_PREFS,
      light: { ...DEFAULT_THEME_PREFS.light, primary: '#ff0000' }
    })
    assert.ok(css.includes('html.light{--accent:#ff0000;'))
    assert.ok(css.includes('html:root:not(.dark){--accent:#ff0000;'))
    assert.ok(!css.includes('html.dark'))
    assert.ok(!css.includes('html:root{'))
  })

  it('measures contrast as WCAG does', () => {
    assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21)
    assert.equal(contrastRatio('#123456', '#123456'), 1)
  })
})
