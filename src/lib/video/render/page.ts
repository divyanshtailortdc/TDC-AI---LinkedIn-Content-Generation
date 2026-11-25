import {
  contrastRatio,
  DEFAULT_BACKGROUND,
  DEFAULT_PRIMARY,
  normalizeHex,
  relativeLuminance
} from '@/lib/brand/theme'
import {
  DEFAULT_VIDEO_LOOK,
  formatRhythm,
  type VideoFormat,
  type VideoHighlight,
  type VideoLook,
  type VideoTemplate
} from './look'

/**
 * The page the recorder films (./record.ts), in the identity's brand: its
 * colours, typefaces, logo and website or handle. Slides sit on the page;
 * the title cards and captions are drawn over it by the stage (./stage.ts).
 * Laid out at 540×960 CSS pixels and rendered at twice that, so the video is
 * 1080×1920. Text stays inside the area Reels and Shorts leave clear of their
 * own buttons: the top 14% and the bottom 24% hold no words.
 *
 * Pure: builds strings only, so tests can read it.
 */

export const STAGE_VIEWPORT = { width: 540, height: 960 } as const
export const STAGE_PIXEL_RATIO = 2

export interface VideoFontFace {
  family: string
  weight: number
  /** The font file (TTF), embedded in the page so no font is fetched. */
  data: Uint8Array
}

export interface VideoTheme {
  /** The slides' background and text. */
  background: string
  ink: string
  muted: string
  /** Slide numbers, progress and the pattern: the brand colour where it reads. */
  mark: string
  /** Title cards and the fades between segments: a deep brand colour. */
  card: string
  cardText: string
  cardAccent: string
  headingFont: string
  headingWeight: number
  bodyFont: string
  fonts: VideoFontFace[]
  /** The logo as a data URL; null for none. */
  logo: string | null
  /**
   * The logo's tone, 0 (dark) to 1 (light). A logo that would vanish on a
   * card or slide sits on a plate there (see logoPlates).
   */
  logoTone: number | null
  /** The website or handle; null for none. */
  footer: string | null
  /** The look's template (./look.ts); cards when nothing is known. */
  template: VideoTemplate
  /** The look's format (./look.ts): the video's structure; slides by default. */
  format: VideoFormat
  /** How key words stand out (emphasisOf picks them). */
  highlight: VideoHighlight
  /** A marker's box and its words. */
  highlightBackground: string
  highlightText: string
  /** The colour key words take with the colour highlight. */
  highlightInk: string
  /**
   * Kinetic type turns every other slide to these colours (none over
   * photos): its background, words and highlight.
   */
  alternate: { background: string; ink: string; mark: string } | null
  /** Words set in capitals, as their posts set them. */
  upper: boolean
  /** The caption line in a box, or as plain subtitles. */
  captions: 'badge' | 'subtitles'
  captionBackground: string
  captionText: string
  /** The pattern behind slides, with a soft glow; none for plain. */
  pattern: 'dots' | 'grid' | 'none'
  /**
   * Their photos, one per slide in turn: behind the slides (the photo
   * template), or framed in a meme or a poster whatever the template. A soft
   * one is too small to fill the screen sharply: behind the words it is
   * blurred and shown whole on a card.
   */
  photos: Array<{ dataUrl: string; soft: boolean }>
  /**
   * Pictures made for some scenes (../scenes.ts), by segment key ('intro'
   * or a scene's key), as data URLs: such a scene is its picture, full
   * screen with a slow camera move, its words drawn into it.
   */
  scenePictures: Record<string, string>
}

const INK = '#0f172a'
const MUTED = '#475569'
const NIGHT = '#0b1020'
const WHITE = '#ffffff'

/** `a` mixed toward `b` by `t` (0 to 1), as #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const channels = (hex: string) =>
    [1, 3, 5].map(i =>
      parseInt((normalizeHex(hex) ?? '#000000').slice(i, i + 2), 16)
    )
  const [x, y] = [channels(a), channels(b)]
  return `#${x
    .map((c, i) =>
      Math.round(c + (y[i]! - c) * t)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** The first colour that reads against `on` (WCAG 3:1, for large type). */
const readable = (on: string, ...candidates: string[]) =>
  candidates.find(c => contrastRatio(c, on) >= 3) ??
  candidates[candidates.length - 1]!

/** Words in `preferred` where they read on `on` (4.5:1), else near-black or white. */
const textOn = (on: string, preferred: string) =>
  contrastRatio(preferred, on) >= 4.5
    ? preferred
    : contrastRatio(INK, on) >= contrastRatio(WHITE, on)
      ? INK
      : WHITE

const isLight = (hex: string) => relativeLuminance(hex) >= 0.5
const isDark = (hex: string) => relativeLuminance(hex) <= 0.12

/** Below this a photo's shorter side cannot fill the 1080-pixel frame sharply. */
const SHARP_PHOTO_PX = 720

/** A colour dark enough for white text: the brand colour deepened toward night. */
export function deepen(hex: string): string {
  for (let t = 0; t <= 1; t += 0.05) {
    const color = mixHex(hex, NIGHT, t)
    if (relativeLuminance(color) <= 0.045) return color
  }
  return NIGHT
}

export interface BrandForVideo {
  primaryColor: string | null
  accentColor: string | null
  backgroundColor: string | null
  footerText: string | null
  /** The pattern behind slides, once the Brand Theme is saved; auto lets the look choose. */
  backgroundPattern?: 'auto' | 'dots' | 'grid' | 'plain'
  /** False until the Brand Theme is first saved: its pattern is then a default. */
  saved?: boolean
}

/** What the look's format adds to a template's colours (videoThemeFor). */
type FormatParts =
  | 'format'
  | 'highlight'
  | 'highlightBackground'
  | 'highlightText'
  | 'highlightInk'
  | 'alternate'
  | 'scenePictures'

interface ThemeExtras {
  heading?: string
  body?: string
  headingWeight?: number
  fonts?: VideoFontFace[]
  logo?: string | null
  logoTone?: number | null
  /** Matched to their posts (../look-source.ts); the default look without. */
  look?: VideoLook | null
  /** The look's photos, in its order. */
  photos?: Array<{
    dataUrl: string
    width: number | null
    height: number | null
  }>
  /** Pictures made for some scenes, by segment key, as data URLs. */
  scenePictures?: Record<string, string>
}

const photoList = (photos: ThemeExtras['photos']): VideoTheme['photos'] =>
  (photos ?? []).map(p => ({
    dataUrl: p.dataUrl,
    soft: Math.min(p.width ?? 0, p.height ?? 0) < SHARP_PHOTO_PX
  }))

export function videoThemeFor(
  brand: BrandForVideo,
  extras: ThemeExtras = {}
): VideoTheme {
  const look = extras.look ?? DEFAULT_VIDEO_LOOK
  const scenePictures = extras.scenePictures ?? {}
  // Scenes without a picture of their own sit on one of the pictures,
  // blurred and darkened: white words, in the photo template's colours
  const palette = paletteFor(
    brand,
    Object.keys(scenePictures).length > 0
      ? { ...extras, look: { ...look, template: 'photo' }, photos: [] }
      : extras
  )
  // With pictures made for its scenes, a video shows no old post photo
  // (each scene its own picture, none twice), and its other scenes are type:
  // kinetic for slides and memes, whose own layouts need a photo or numbers
  const pictured = Object.keys(scenePictures).length > 0
  const wanted =
    pictured && (look.format === 'slides' || look.format === 'meme')
      ? 'kinetic'
      : look.format
  // A meme or a poster frames their photos whatever the template; a meme
  // with none to show is kinetic type, as cleanVideoLook makes it
  const framed = wanted === 'meme' || wanted === 'poster'
  const photos = pictured
    ? []
    : framed
      ? photoList(extras.photos)
      : palette.photos
  const format = wanted === 'meme' && photos.length === 0 ? 'kinetic' : wanted
  // Over pictures made like their posts, key words take the brand's own
  // colour where it reads on the darkened picture, as the pictures' words do
  const primary = normalizeHex(brand.primaryColor)
  const key =
    pictured && primary
      ? readable('#2a2a2a', primary, palette.mark)
      : palette.mark
  const alternate =
    format === 'kinetic' && palette.template !== 'photo'
      ? (() => {
          // The card colour where it stands apart from the slides, else the marks'
          const background =
            contrastRatio(palette.card, palette.background) >= 1.6
              ? palette.card
              : palette.mark
          const ink = textOn(
            background,
            background === palette.card ? palette.cardText : palette.background
          )
          return {
            background,
            ink,
            mark: readable(background, palette.cardAccent, palette.mark, ink)
          }
        })()
      : null
  return {
    ...palette,
    // Only story slides keep a pattern behind them
    pattern: format === 'slides' ? palette.pattern : 'none',
    photos,
    scenePictures,
    format,
    highlight: look.highlight,
    highlightBackground: key,
    highlightText: textOn(key, palette.background),
    highlightInk: key,
    alternate
  }
}

/** A template's colours, the brand's type and logo, and photos behind slides. */
function paletteFor(
  brand: BrandForVideo,
  extras: ThemeExtras
): Omit<VideoTheme, FormatParts> {
  const look = extras.look ?? DEFAULT_VIDEO_LOOK
  const seen = look.colors
  // The Brand Theme's colours as set; what it leaves unset, from their
  // posts (the look), then the defaults.
  const primary =
    normalizeHex(brand.primaryColor) ?? seen?.accent ?? DEFAULT_PRIMARY
  const accent = normalizeHex(brand.accentColor) ?? seen?.accent ?? primary
  const setBackground = normalizeHex(brand.backgroundColor)
  const brandBackground =
    setBackground ??
    (seen && isLight(seen.background) ? seen.background : DEFAULT_BACKGROUND)
  // A saved Brand Theme's pattern; else (or on Auto) the template's own.
  const pattern = (fallback: VideoTheme['pattern']): VideoTheme['pattern'] =>
    !brand.saved ||
    !brand.backgroundPattern ||
    brand.backgroundPattern === 'auto'
      ? fallback
      : brand.backgroundPattern === 'plain'
        ? 'none'
        : brand.backgroundPattern
  const shared = {
    headingFont: extras.heading ?? 'Inter',
    headingWeight: extras.headingWeight ?? 800,
    bodyFont: extras.body ?? 'Inter',
    fonts: extras.fonts ?? [],
    logo: extras.logo ?? null,
    logoTone: extras.logo ? (extras.logoTone ?? null) : null,
    footer: brand.footerText?.trim() || null,
    template: look.template,
    upper: look.textCase === 'upper',
    captions: look.captions,
    photos: [] as VideoTheme['photos']
  }

  if (look.template === 'bold') {
    const background =
      seen && isDark(seen.background) ? seen.background : deepen(primary)
    const ink = textOn(background, seen?.text ?? WHITE)
    const mark = readable(background, accent, mixHex(accent, WHITE, 0.45), ink)
    return {
      ...shared,
      background,
      ink,
      muted: mixHex(ink, background, 0.3),
      mark,
      card: background,
      cardText: ink,
      cardAccent: mark,
      captionBackground: mark,
      captionText: textOn(mark, background),
      pattern: pattern('dots')
    }
  }

  if (look.template === 'minimal') {
    const background = brandBackground
    const ink = textOn(background, seen?.text ?? INK)
    const mark = readable(background, accent, primary, ink)
    return {
      ...shared,
      background,
      ink,
      muted: mixHex(ink, background, 0.4),
      mark,
      card: background,
      cardText: ink,
      cardAccent: mark,
      captionBackground: ink,
      captionText: background,
      pattern: pattern('none')
    }
  }

  if (look.template === 'photo') {
    const card = deepen(
      seen && isDark(seen.background) ? seen.background : primary
    )
    // Marks sit on a darkened photo: judged against a dark grey, not the card.
    const mark = readable('#2a2a2a', accent, mixHex(accent, WHITE, 0.45), WHITE)
    return {
      ...shared,
      background: card,
      ink: WHITE,
      muted: mixHex(WHITE, card, 0.2),
      mark,
      card,
      cardText: WHITE,
      cardAccent: mark,
      captionBackground: card,
      captionText: WHITE,
      // A photo fills the slide: no pattern over it.
      pattern: 'none',
      photos: photoList(extras.photos)
    }
  }

  // cards: with nothing known, exactly the brand look of before.
  const background = brandBackground
  const ink = seen ? textOn(background, seen.text) : INK
  const card = deepen(primary)
  return {
    ...shared,
    background,
    ink,
    muted: ink === INK ? MUTED : mixHex(ink, background, 0.35),
    mark: seen
      ? readable(background, accent, primary, ink)
      : readable(background, primary, accent, INK),
    card,
    cardText: WHITE,
    cardAccent: readable(card, accent, mixHex(accent, WHITE, 0.5), '#e2e8f0'),
    captionBackground: card,
    captionText: WHITE,
    pattern: pattern('dots')
  }
}

/**
 * The plate a logo needs, by where it sits: a white one on a dark card or
 * slide for a logo that is not light, a dark one on a light card or slide
 * for a light logo. Null where it reads as it is. An unknown tone gets a
 * plate on dark ground, where a dark logo would be lost.
 */
export function logoPlates(theme: VideoTheme): {
  card: string | null
  slide: string | null
  /** On kinetic type's alternate slides. */
  alternate: string | null
} {
  if (!theme.logo) return { card: null, slide: null, alternate: null }
  const tone = theme.logoTone
  const darkPlate = isLight(theme.card) ? INK : theme.card
  const plateOn = (dark: boolean) =>
    dark
      ? tone === null || tone < 0.55
        ? WHITE
        : null
      : tone !== null && tone > 0.65
        ? darkPlate
        : null
  return {
    card: plateOn(!isLight(theme.card)),
    // A photo behind the slide is darkened, so it counts as dark ground.
    slide: plateOn(theme.template === 'photo' || !isLight(theme.background)),
    alternate: theme.alternate
      ? plateOn(!isLight(theme.alternate.background))
      : null
  }
}

/** A family name as CSS: quoted, with the fallbacks after it. */
export const fontStack = (family: string) =>
  `"${family.replace(/["\\]/g, '')}", Inter, ui-sans-serif, system-ui, sans-serif`

function fontFaces(fonts: VideoFontFace[]): string {
  return fonts
    .map(
      f =>
        `@font-face{font-family:"${f.family.replace(/["\\]/g, '')}";font-weight:${f.weight};font-style:normal;font-display:block;src:url(data:font/ttf;base64,${Buffer.from(f.data).toString('base64')}) format("truetype")}`
    )
    .join('\n')
}

/**
 * How the caption line is drawn: in its box, or as subtitles straight on the
 * slide, in the slide's own text colour, with a shadow over photos and dark
 * slides.
 */
export function captionLook(theme: VideoTheme): {
  style: 'badge' | 'subtitles'
  background: string
  text: string
  shadow: boolean
} {
  // A meme's line sits on its photo, as subtitles do on a clip
  if (theme.format === 'meme')
    return {
      style: 'subtitles',
      background: 'transparent',
      text: WHITE,
      shadow: true
    }
  if (theme.captions === 'badge')
    return {
      style: 'badge',
      background: theme.captionBackground,
      text: theme.captionText,
      shadow: false
    }
  return {
    style: 'subtitles',
    background: 'transparent',
    text: theme.ink,
    shadow: theme.template === 'photo' || !isLight(theme.background)
  }
}

/**
 * The words of a headline that stand out when the look highlights: those
 * with a number in them, else its closing words (a third of them, one to
 * three). Indexes into the headline split at spaces, as the page splits it.
 */
export function emphasisOf(headline: string): number[] {
  const words = headline.split(/\s+/).filter(Boolean)
  const numbers = words.flatMap((w, i) => (/\d/.test(w) ? [i] : []))
  if (numbers.length > 0) return numbers
  const count = Math.min(3, Math.max(1, Math.round(words.length / 3)))
  return words.map((_, i) => i).slice(-count)
}

/** The pattern behind slides and its glow, in the slide marks' colour. */
function patternCss(theme: VideoTheme): string {
  if (theme.pattern === 'none') return ''
  const tint = (pct: number) =>
    `color-mix(in srgb, ${theme.mark} ${pct}%, transparent)`
  const layer =
    theme.pattern === 'grid'
      ? `background-image: linear-gradient(${tint(10)} 1px, transparent 1px), linear-gradient(90deg, ${tint(10)} 1px, transparent 1px);
  background-size: 32px 32px;`
      : `background-image: radial-gradient(${tint(18)} 1.3px, transparent 1.5px);
  background-size: 24px 24px;`
  return `body::before { content: ""; position: absolute; inset: 0; ${layer} opacity: .8; }
body::after { content: ""; position: absolute; width: 560px; height: 560px; right: -220px; top: -200px;
  border-radius: 50%; background: radial-gradient(${tint(20)}, transparent 68%); }`
}

/**
 * A framed photo too small to fill its frame sharply: shown whole over a
 * blurred copy of itself, as the photo template shows one behind words.
 */
const FRAMED_SOFT_CSS = `#frame b { position: absolute; inset: 0; display: none; background-size: contain;
  background-repeat: no-repeat; background-position: center; }
#frame.soft i { inset: -8%; filter: blur(18px) saturate(1.1); }
#frame.soft b { display: block; }`

/** The largest a headline starts at, by format, before it shrinks to fit. */
const HEADLINE_MAX_PX: Record<VideoFormat, number> = {
  slides: 58,
  kinetic: 96,
  meme: 46,
  poster: 54,
  editorial: 48
}

/** Key words in a marker box or the accent colour, on plain and alternate slides. */
function highlightCss(theme: VideoTheme): string {
  if (theme.highlight === 'none') return ''
  const alt = theme.alternate
  if (theme.highlight === 'color')
    return `#headline .hl { color: ${theme.highlightInk}; }
${alt ? `body.alt #headline .hl { color: ${alt.mark}; }` : ''}`
  // A box behind each key word, its edges joining it to the next one
  const box = (bg: string, ink: string) =>
    `background: ${bg}; color: ${ink}; text-shadow: none; border-radius: .12em;
  box-shadow: .12em 0 0 ${bg}, -.12em 0 0 ${bg};`
  return `#headline .hl { ${box(theme.highlightBackground, theme.highlightText)} }
${alt ? `body.alt #headline .hl { ${box(alt.ink, alt.background)} }` : ''}`
}

/**
 * What a format changes on the page; slides, the first format, changes
 * nothing. Words stay inside the area clear of the platforms' buttons.
 */
function formatCss(theme: VideoTheme, body: string): string {
  const sub = (
    font: string
  ) => `#sub { margin: 0; max-width: 100%; font: ${font} ${body};
  color: ${theme.muted}; opacity: 0;
  ${theme.template === 'photo' ? 'text-shadow: 0 2px 14px rgba(0,0,0,.6);' : ''} }`
  switch (theme.format) {
    case 'kinetic': {
      const alt = theme.alternate
      const plate = logoPlates(theme).alternate
      return `#bars { display: none; }
#brand { justify-content: center; }
#slide { left: 28px; right: 28px; align-items: center; text-align: center; gap: 24px; }
#headline { line-height: 1.02; letter-spacing: ${theme.upper ? '0' : '-.035em'}; }
body.v1 #slide { align-items: flex-start; text-align: left; justify-content: flex-end; }
body.v2 #slide { align-items: flex-start; text-align: left; justify-content: flex-start; }
#headline .w { opacity: 0; transform: scale(.35); }
body.go #headline .w { animation: pv-pop .42s cubic-bezier(.3,1.5,.5,1) both;
  animation-delay: calc(var(--i) * 140ms + 60ms); }
@keyframes pv-pop { 0% { opacity: 0; transform: scale(.35); } 55% { opacity: 1; } 100% { opacity: 1; transform: none; } }
${sub('600 22px/1.35')}
body.go #sub { animation: pv-rise .5s cubic-bezier(.2,.8,.2,1) var(--sub-delay, 500ms) both; }
${
  alt
    ? `body.alt { background: ${alt.background}; }
body.alt::before, body.alt::after { display: none; }
body.alt #headline { color: ${alt.ink}; }
body.alt #sub, body.alt #brand { color: ${mixHex(alt.ink, alt.background, 0.25)}; }
body.alt #brand img { ${plate ? `background: ${plate}; padding: 5px 9px; border-radius: 8px;` : 'background: none; padding: 0;'} }`
    : ''
}`
    }
    case 'meme':
      return `body::before, body::after { display: none; }
#bars { display: none; }
#slide { top: 136px; bottom: auto; max-height: 300px; overflow: hidden; left: 30px; right: 30px; gap: 0; }
#headline { font-family: ${body}; font-weight: 600; line-height: 1.18; letter-spacing: 0; text-shadow: none; }
#frame { position: absolute; left: 0; right: 0; top: 420px; bottom: 0; z-index: 1; overflow: hidden; }
#frame.off { display: none; }
#frame i { position: absolute; inset: 0; background-size: cover; background-position: center; transform: scale(1.02); }
body.go #frame i { animation: pv-zoom var(--hold, 4000ms) linear both; }
${FRAMED_SOFT_CSS}
body:not(.pic) #slide { top: 150px; bottom: 250px; max-height: none; justify-content: center; }`
    case 'poster': {
      const bar =
        contrastRatio(theme.card, theme.background) >= 1.6
          ? theme.card
          : theme.mark
      return `#bars, #footer { display: none; }
#brand img { height: 34px; max-width: 190px; }
#frame { position: absolute; left: 40px; right: 40px; top: 140px; height: 226px; z-index: 2; overflow: hidden;
  border-radius: 22px; box-shadow: 0 16px 40px rgba(0,0,0,.22); opacity: 0; }
#frame i { position: absolute; inset: 0; background-size: cover; background-position: center; }
${FRAMED_SOFT_CSS}
#slide { bottom: 296px; gap: 14px; opacity: 0; }
body.pic #slide { top: 390px; justify-content: flex-start; }
body.go #slide, body.go #frame { animation: pv-push .55s cubic-bezier(.2,.8,.2,1) both; }
@keyframes pv-push { from { opacity: 0; transform: translateX(56px); } to { opacity: 1; transform: none; } }
${sub('500 21px/1.38')}
body.go #sub { animation: pv-rise .5s cubic-bezier(.2,.8,.2,1) .3s both; }
#bar { position: absolute; left: 0; right: 0; top: 664px; height: 56px; z-index: 2; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center; padding: 0 24px; background: ${bar};
  color: ${textOn(bar, theme.cardText)}; font: 700 18px/1.2 ${body}; letter-spacing: .02em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`
    }
    case 'editorial':
      return `#bars { display: none; }
#brand { justify-content: center; }
#slide { left: 50px; right: 50px; align-items: center; text-align: center; gap: 24px; }
#slide .rule { flex: none; width: 52px; height: 2px; background: ${theme.mark}; transform: scaleX(0); }
body.go #slide .rule { animation: pv-rule .9s cubic-bezier(.2,.8,.2,1) .05s both; }
@keyframes pv-rule { from { transform: scaleX(0); } to { transform: none; } }
#headline { font-weight: 600; line-height: 1.22; letter-spacing: -.01em; opacity: 0; }
body.go #headline { animation: pv-soft 1.1s ease .12s both; }
${sub('400 20px/1.45')}
body.go #sub { animation: pv-soft 1s ease .75s both; }
@keyframes pv-soft { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }`
    default:
      return `#headline .w { opacity: 0; transform: translateY(.4em); }
body.go #headline .w { animation: pv-rise .55s cubic-bezier(.2,.8,.2,1) both;
  animation-delay: calc(var(--i) * 60ms + 120ms); }`
  }
}

/**
 * The page, with no slide on it yet, and the script that runs on it once it
 * is open: `window.__slide(scene, index, total)` puts a slide's text on it
 * (null clears it, under a card), and `window.__go()` plays the slide's
 * entrance as the curtain opens.
 */
export function stageDocument(theme: VideoTheme): {
  html: string
  script: string
} {
  const heading = fontStack(theme.headingFont)
  const body = fontStack(theme.bodyFont)
  const slidePlate = logoPlates(theme).slide
  // A meme or a poster frames their photo; other formats put it behind the words
  const framed = theme.format === 'meme' || theme.format === 'poster'
  const inPage = formatRhythm(theme.format).captionInPage
  const css = `
${fontFaces(theme.fonts)}
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
body { position: relative; background: ${theme.background}; color: ${theme.ink};
  font-family: ${body}; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
${patternCss(theme)}
#photo { position: absolute; inset: -2%; z-index: 0; background-size: cover; background-position: center;
  transform: scale(1.04); }
#photo.soft { inset: -8%; filter: blur(18px) saturate(1.1); }
#photo.backdrop { inset: -14%; background-size: 180%; filter: blur(36px) saturate(1.3); }
body.bd #shade { opacity: .72; }
#shade { position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg,
  rgba(0,0,0,.62) 0%, rgba(0,0,0,.42) 30%, rgba(0,0,0,.5) 60%, rgba(0,0,0,.82) 100%); }
body.go #photo { animation: pv-zoom var(--hold, 4000ms) linear both; }
@keyframes pv-zoom { from { transform: scale(1.04); } to { transform: scale(1.14); } }
#pic { display: block; align-self: flex-start; height: 230px; width: auto; max-width: 100%; border-radius: 18px;
  box-shadow: 0 18px 50px rgba(0,0,0,.45); opacity: 0; }
body.go #pic { animation: pv-rise .6s cubic-bezier(.2,.8,.2,1) .05s both; }
#bars { position: absolute; top: 58px; left: 36px; right: 36px; display: flex; gap: 6px; z-index: 2; }
#bars i { position: relative; flex: 1; height: 4px; border-radius: 4px; overflow: hidden;
  background: color-mix(in srgb, ${theme.ink} 12%, transparent); }
#bars i.done::after, #bars i.now::after { content: ""; position: absolute; inset: 0;
  background: ${theme.mark}; }
#bars i.now { background: color-mix(in srgb, ${theme.mark} 35%, transparent); }
#brand { position: absolute; top: 78px; left: 36px; right: 36px; display: flex; align-items: center;
  gap: 10px; z-index: 2; font: 600 15px/1.2 ${body}; color: ${theme.muted}; }
#brand img { height: 26px; width: auto; max-width: 140px; object-fit: contain;
  ${slidePlate ? `background: ${slidePlate}; padding: 5px 9px; border-radius: 8px;` : ''} }
#slide { position: absolute; left: 40px; right: 40px; top: 150px; bottom: 250px; z-index: 2;
  display: flex; flex-direction: column; justify-content: center; gap: 18px; }
#num { display: none; }
#headline { margin: 0; font-family: ${heading}; font-weight: ${theme.headingWeight}; font-size: 56px;
  line-height: 1.08; letter-spacing: ${theme.upper ? '0' : '-.02em'}; color: ${theme.ink}; overflow-wrap: anywhere;
  ${theme.upper ? 'text-transform: uppercase;' : ''}
  ${theme.template === 'photo' ? 'text-shadow: 0 2px 24px rgba(0,0,0,.6), 0 0 3px rgba(0,0,0,.35);' : ''} }
#headline .w { display: inline-block; }
@keyframes pv-rise { from { opacity: 0; transform: translateY(.4em); } to { opacity: 1; transform: none; } }
${formatCss(theme, body)}
${highlightCss(theme)}
#shot { position: absolute; inset: 0; z-index: 5; overflow: hidden; background: ${theme.card}; }
#shot.off { display: none; }
#shot i { position: absolute; inset: 0; background-size: cover; background-position: center; }
body.go #shot i { animation: var(--move, mv-in) var(--hold, 4000ms) cubic-bezier(.33,.1,.4,1) both; }
@keyframes mv-in { from { transform: scale(1); } to { transform: scale(1.08); } }
@keyframes mv-out { from { transform: scale(1.08); } to { transform: scale(1); } }
@keyframes mv-up { from { transform: scale(1.07) translateY(2%); } to { transform: scale(1.07) translateY(-2%); } }
@keyframes mv-side { from { transform: scale(1.07) translateX(-2%); } to { transform: scale(1.07) translateX(2%); } }
.off { visibility: hidden; }
`
  const brandRow = [
    theme.logo ? `<img alt="" src="${theme.logo}">` : '',
    theme.footer ? `<span id="footer"></span>` : ''
  ].join('')
  // Text goes in with textContent, so a script's words never become markup.
  const script = `(() => {
  if (window.__slide) return true;
  const $ = id => document.getElementById(id);
  const photos = ${JSON.stringify(theme.photos)};
  const alternate = ${theme.alternate ? 'true' : 'false'};
  const kinetic = ${theme.format === 'kinetic' ? 'true' : 'false'};
  // Pictures made for some scenes, by segment key; each moves its own way
  const pictures = ${JSON.stringify(theme.scenePictures)};
  const moves = ["mv-in", "mv-up", "mv-out", "mv-side"];
  const crops = ["30% 25%", "75% 70%", "50% 90%", "20% 65%"];
  const meme = ${theme.format === 'meme' ? 'true' : 'false'};
  for (const el of [$("footer"), $("bar")]) if (el) el.textContent = ${JSON.stringify(theme.footer ?? '')};
  // Shrinks the headline until the slide's words (and photo) fit its area
  const fit = (el, box) => {
    let size = ${HEADLINE_MAX_PX[theme.format]};
    el.style.fontSize = size + "px";
    while (size > 24 && (box.scrollHeight > box.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
  };
  window.__slide = (scene, index, total) => {
    document.body.classList.remove("go");
    // Kinetic type turns every other slide to its alternate colours
    document.body.classList.toggle("alt", alternate && Boolean(scene) && index % 2 === 1);
    // Kinetic type sets its words in a different place slide by slide
    document.body.classList.toggle("v1", kinetic && Boolean(scene) && index % 3 === 1);
    document.body.classList.toggle("v2", kinetic && Boolean(scene) && index % 3 === 2);
    // A scene with its own picture is that picture, full screen, moving slowly
    const picture = scene ? pictures[scene.key] : null;
    const shot = $("shot");
    if (shot) {
      shot.classList.toggle("off", !picture);
      shot.firstChild.style.backgroundImage = picture ? 'url("' + picture + '")' : "none";
      document.body.style.setProperty("--move", moves[index % moves.length]);
    }
    const bars = $("bars");
    bars.replaceChildren();
    for (let i = 0; i < total; i++) {
      const bar = document.createElement("i");
      if (scene && i < index) bar.className = "done";
      if (scene && i === index) bar.className = "now";
      bars.appendChild(bar);
    }
    bars.classList.toggle("off", !scene);
    $("slide").classList.toggle("off", !scene);
    $("num").textContent = scene ? scene.num : "";
    const headline = $("headline");
    headline.replaceChildren();
    const key = new Set(scene && scene.hl ? scene.hl : []);
    const words = (scene ? scene.headline : "").split(/\\s+/).filter(Boolean);
    words.forEach((word, i) => {
      const span = document.createElement("span");
      span.className = key.has(i) ? "w hl" : "w";
      span.style.setProperty("--i", String(i));
      span.textContent = word;
      headline.append(span, " ");
    });
    // The caption line as part of the slide, after its words are in
    const sub = $("sub");
    if (sub) {
      sub.textContent = scene && scene.caption ? scene.caption : "";
      sub.style.display = sub.textContent ? "" : "none";
    }
    document.body.style.setProperty("--sub-delay", (words.length * 140 + 450) + "ms");
    document.body.style.setProperty("--hold", (scene ? scene.holdMs : 0) + "ms");
    // Their photo behind the slide, in turn; a small one blurred behind and shown whole
    // Each photo shows once: a slide past the last has none
    const photo = scene && index < photos.length ? photos[index] : null;
    // Or framed, in a meme or a poster
    const frame = $("frame");
    if (frame) {
      frame.classList.toggle("off", !photo);
      frame.classList.toggle("soft", Boolean(photo && photo.soft));
      for (const layer of frame.children)
        layer.style.backgroundImage = photo ? 'url("' + photo.dataUrl + '")' : "none";
      document.body.classList.toggle("pic", Boolean(photo));
    }
    // Or, in a video with pictures made for its scenes, one of those
    // pictures blurred behind the words, cropped its own way each time
    const backdrop = scene && !picture && scene.backdrop ? pictures[scene.backdrop] : null;
    const behind = photo ? photo.dataUrl : backdrop;
    const bg = $("photo"), pic = $("pic");
    if (bg) {
      bg.classList.toggle("off", !behind);
      bg.classList.toggle("soft", Boolean(photo && photo.soft));
      bg.classList.toggle("backdrop", Boolean(!photo && backdrop));
      document.body.classList.toggle("bd", Boolean(!photo && backdrop));
      bg.style.backgroundImage = behind ? 'url("' + behind + '")' : "none";
      bg.style.backgroundPosition = !photo && backdrop ? crops[index % crops.length] : "";
      $("shade").classList.toggle("off", !behind);
    }
    if (pic) {
      pic.classList.toggle("off", !(photo && photo.soft));
      pic.style.display = photo && photo.soft ? "block" : "none";
      if (photo && photo.soft) pic.src = photo.dataUrl;
    }
    const shown = pic && photo && photo.soft ? pic.decode().catch(() => {}) : Promise.resolve();
    return shown.then(() => {
      if (scene) fit(headline, $("slide"));
      // A meme's photo fills the screen from just under its words
      if (scene && frame && meme)
        frame.style.top = Math.round($("slide").getBoundingClientRect().bottom + 24) + "px";
      return true;
    });
  };
  // Decodes every photo before recording, so none appears late in a frame
  const kept = [];
  window.__ready = () => Promise.all([...photos.map(p => p.dataUrl), ...Object.values(pictures)].map(src => {
    const img = new Image();
    img.src = src;
    kept.push(img);
    return img.decode().catch(() => {});
  })).then(() => true);
  window.__go = () => {
    void document.body.offsetWidth;
    document.body.classList.add("go");
    return true;
  };
  return true;
})()`
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head>
<body class="f-${theme.format}">
${(theme.photos.length > 0 && !framed) || Object.keys(theme.scenePictures).length > 0 ? '<div id="photo" class="off"></div><div id="shade" class="off"></div>' : ''}
${theme.photos.length > 0 && framed ? '<div id="frame" class="off"><i></i><b></b></div>' : ''}
<div id="bars" class="off"></div>
${brandRow ? `<div id="brand">${brandRow}</div>` : ''}
<main id="slide" class="off">${theme.photos.length > 0 && !framed ? '<img id="pic" alt="" class="off">' : ''}${theme.format === 'editorial' ? '<i class="rule"></i>' : ''}<div id="num"></div><h1 id="headline"></h1>${inPage ? '<p id="sub"></p>' : ''}${theme.format === 'editorial' ? '<i class="rule"></i>' : ''}</main>
${theme.format === 'poster' && theme.footer ? '<div id="bar"></div>' : ''}
${Object.keys(theme.scenePictures).length > 0 ? '<div id="shot" class="off"><i></i></div>' : ''}
</body></html>`
  return { html, script }
}
