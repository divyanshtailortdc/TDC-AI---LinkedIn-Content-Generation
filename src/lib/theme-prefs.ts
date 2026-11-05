/**
 * The user's own app colours: a primary and a secondary colour for each of
 * light and dark mode. Kept in a cookie so the server renders the page in
 * them and the default colours never flash first. Client-safe: no imports.
 *
 * Primary is the --accent token (main buttons, links, focus rings) and
 * secondary is --brand (the active nav item, highlights); globals.css has
 * the defaults.
 */
export const THEME_PREFS_COOKIE = 'theme-prefs'

export type ThemeMode = 'light' | 'dark'
export type ModeColors = { primary: string; secondary: string }
export type ThemePrefs = Record<ThemeMode, ModeColors>

/** The colours of globals.css, so "reset" and "unchanged" mean the same. */
export const DEFAULT_THEME_PREFS: ThemePrefs = {
  light: { primary: '#09090b', secondary: '#159bb2' },
  dark: { primary: '#fafafa', secondary: '#22b5cd' }
}

/** Each mode's page background: the text colour on primary buttons. */
export const MODE_BACKGROUND: Record<ThemeMode, string> = {
  light: '#fafafa',
  dark: '#09090b'
}

const HEX = /^#[0-9a-f]{6}$/

/** A `#rrggbb` colour in lower case, or null for anything else. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().toLowerCase()
  return HEX.test(hex) ? hex : null
}

/**
 * The preferences in a cookie value. Anything missing or not a `#rrggbb`
 * colour falls back to the default, so the value never reaches CSS unchecked.
 */
export function parseThemePrefs(raw: string | undefined): ThemePrefs {
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  const source = (parsed ?? {}) as Partial<Record<ThemeMode, unknown>>
  const read = (mode: ThemeMode): ModeColors => {
    const colors = (source[mode] ?? {}) as Partial<Record<string, unknown>>
    return {
      primary:
        normalizeHex(colors.primary) ?? DEFAULT_THEME_PREFS[mode].primary,
      secondary:
        normalizeHex(colors.secondary) ?? DEFAULT_THEME_PREFS[mode].secondary
    }
  }
  return { light: read('light'), dark: read('dark') }
}

export function isDefaultThemePrefs(prefs: ThemePrefs) {
  return (['light', 'dark'] as const).every(
    mode =>
      prefs[mode].primary === DEFAULT_THEME_PREFS[mode].primary &&
      prefs[mode].secondary === DEFAULT_THEME_PREFS[mode].secondary
  )
}

/**
 * The tokens one mode's colours set. Hover and -strong shades are mixed from
 * the chosen colour the way the defaults relate: in light mode hover is a
 * little lighter and -strong (text on a pale secondary fill) much darker; in
 * dark mode the other way round. Only changed colours are written, so the
 * defaults keep their hand-picked shades.
 */
export function themeTokens(mode: ThemeMode, colors: ModeColors) {
  const tokens: Record<string, string> = {}
  const light = mode === 'light'
  if (colors.primary !== DEFAULT_THEME_PREFS[mode].primary) {
    tokens['--accent'] = colors.primary
    tokens['--accent-hover'] = light
      ? `color-mix(in oklab, ${colors.primary} 85%, white)`
      : `color-mix(in oklab, ${colors.primary} 88%, black)`
  }
  if (colors.secondary !== DEFAULT_THEME_PREFS[mode].secondary) {
    tokens['--brand'] = colors.secondary
    tokens['--brand-strong'] = light
      ? `color-mix(in oklab, ${colors.secondary} 60%, black)`
      : `color-mix(in oklab, ${colors.secondary} 65%, white)`
  }
  return tokens
}

/**
 * The stylesheet that applies the preferences, or '' when nothing differs.
 * Each mode's block applies in that mode only: by next-themes' class, or by
 * the system setting before a class is set. Its selectors are more specific
 * than globals.css (html.dark over .dark, html:root:not(.light) over
 * :root:not(.light)), so they win wherever the sheet ends up. Only checked
 * hex colours reach it (parseThemePrefs).
 */
export function themePrefsCss(prefs: ThemePrefs): string {
  const body = (tokens: Record<string, string>) =>
    Object.entries(tokens)
      .map(([name, value]) => `${name}:${value};`)
      .join('')
  const forMode = (mode: ThemeMode) => {
    const tokens = body(themeTokens(mode, prefs[mode]))
    if (!tokens) return ''
    const other = mode === 'light' ? 'dark' : 'light'
    return (
      `html.${mode}{${tokens}}` +
      `@media (prefers-color-scheme: ${mode}){html:root:not(.${other}){${tokens}}}`
    )
  }
  return forMode('light') + forMode('dark')
}

/** WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(a: string, b: string) {
  const channel = (hex: string, at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = (hex: string) =>
    0.2126 * channel(hex, 1) +
    0.7152 * channel(hex, 3) +
    0.0722 * channel(hex, 5)
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
