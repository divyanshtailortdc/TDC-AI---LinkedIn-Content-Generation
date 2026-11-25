import {
  contrastRatio,
  DEFAULT_BACKGROUND,
  DEFAULT_PRIMARY,
  normalizeHex,
  relativeLuminance
} from '@/lib/brand/theme'
import { DEFAULT_VIDEO_LOOK, type VideoLook, type VideoTemplate } from './look'

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
  /** Words set in capitals, as their posts set them. */
  upper: boolean
  /** The caption line in a box, or as plain subtitles. */
  captions: 'badge' | 'subtitles'
  captionBackground: string
  captionText: string
  /** The pattern behind slides, with a soft glow; none for plain. */
  pattern: 'dots' | 'grid' | 'none'
  /**
   * Their photos behind the slides (the photo template), one per slide in
   * turn. A soft one is too small to fill the screen sharply: it is blurred
   * behind the words and shown whole on a card.
   */
  photos: Array<{ dataUrl: string; soft: boolean }>
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

export function videoThemeFor(
  brand: BrandForVideo,
  extras: {
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
  } = {}
): VideoTheme {
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
      photos: (extras.photos ?? []).map(p => ({
        dataUrl: p.dataUrl,
        soft: Math.min(p.width ?? 0, p.height ?? 0) < SHARP_PHOTO_PX
      }))
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
} {
  if (!theme.logo) return { card: null, slide: null }
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
    slide: plateOn(theme.template === 'photo' || !isLight(theme.background))
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
  const css = `
${fontFaces(theme.fonts)}
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
body { position: relative; background: ${theme.background}; color: ${theme.ink};
  font-family: ${body}; -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
${patternCss(theme)}
#photo { position: absolute; inset: -2%; z-index: 0; background-size: cover; background-position: center;
  transform: scale(1.04); }
#photo.soft { inset: -8%; filter: blur(18px) saturate(1.1); }
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
#num { font: 700 20px/1 ${heading}; letter-spacing: .14em; color: ${theme.mark}; opacity: 0; }
#headline { margin: 0; font-family: ${heading}; font-weight: ${theme.headingWeight}; font-size: 56px;
  line-height: 1.08; letter-spacing: ${theme.upper ? '0' : '-.02em'}; color: ${theme.ink}; overflow-wrap: anywhere;
  ${theme.upper ? 'text-transform: uppercase;' : ''}
  ${theme.template === 'photo' ? 'text-shadow: 0 2px 24px rgba(0,0,0,.6), 0 0 3px rgba(0,0,0,.35);' : ''} }
#headline .w { display: inline-block; opacity: 0; transform: translateY(.4em); }
body.go #num { animation: pv-rise .5s cubic-bezier(.2,.8,.2,1) .05s both; }
body.go #headline .w { animation: pv-rise .55s cubic-bezier(.2,.8,.2,1) both;
  animation-delay: calc(var(--i) * 60ms + 120ms); }
@keyframes pv-rise { from { opacity: 0; transform: translateY(.4em); } to { opacity: 1; transform: none; } }
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
  const footer = $("footer");
  if (footer) footer.textContent = ${JSON.stringify(theme.footer ?? '')};
  // Shrinks the headline until the slide's words (and photo) fit its area
  const fit = (el, box) => {
    let size = 58;
    el.style.fontSize = size + "px";
    while (size > 24 && (box.scrollHeight > box.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
      size -= 2;
      el.style.fontSize = size + "px";
    }
  };
  window.__slide = (scene, index, total) => {
    document.body.classList.remove("go");
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
    (scene ? scene.headline : "").split(/\\s+/).filter(Boolean).forEach((word, i) => {
      const span = document.createElement("span");
      span.className = "w";
      span.style.setProperty("--i", String(i));
      span.textContent = word;
      headline.append(span, " ");
    });
    document.body.style.setProperty("--hold", (scene ? scene.holdMs : 0) + "ms");
    // Their photo behind the slide, in turn; a small one blurred behind and shown whole
    const photo = scene && photos.length ? photos[index % photos.length] : null;
    const bg = $("photo"), pic = $("pic");
    if (bg) {
      bg.classList.toggle("off", !photo);
      bg.classList.toggle("soft", Boolean(photo && photo.soft));
      bg.style.backgroundImage = photo ? 'url("' + photo.dataUrl + '")' : "none";
      $("shade").classList.toggle("off", !photo);
      pic.classList.toggle("off", !(photo && photo.soft));
      pic.style.display = photo && photo.soft ? "block" : "none";
      if (photo && photo.soft) pic.src = photo.dataUrl;
    }
    const shown = pic && photo && photo.soft ? pic.decode().catch(() => {}) : Promise.resolve();
    return shown.then(() => {
      if (scene) fit(headline, $("slide"));
      return true;
    });
  };
  // Decodes every photo before recording, so none appears late in a frame
  const kept = [];
  window.__ready = () => Promise.all(photos.map(p => {
    const img = new Image();
    img.src = p.dataUrl;
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
<body>
${theme.photos.length > 0 ? '<div id="photo" class="off"></div><div id="shade" class="off"></div>' : ''}
<div id="bars" class="off"></div>
${brandRow ? `<div id="brand">${brandRow}</div>` : ''}
<main id="slide" class="off">${theme.photos.length > 0 ? '<img id="pic" alt="" class="off">' : ''}<div id="num"></div><h1 id="headline"></h1></main>
</body></html>`
  return { html, script }
}
