import {
  contrastRatio,
  DEFAULT_BACKGROUND,
  DEFAULT_PRIMARY,
  normalizeHex,
  relativeLuminance
} from '@/lib/brand/theme'

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
  } = {}
): VideoTheme {
  const primary = normalizeHex(brand.primaryColor) ?? DEFAULT_PRIMARY
  const accent = normalizeHex(brand.accentColor) ?? primary
  const background = normalizeHex(brand.backgroundColor) ?? DEFAULT_BACKGROUND
  const card = deepen(primary)
  return {
    background,
    ink: INK,
    muted: MUTED,
    mark: readable(background, primary, accent, INK),
    card,
    cardText: WHITE,
    cardAccent: readable(card, accent, mixHex(accent, WHITE, 0.5), '#e2e8f0'),
    headingFont: extras.heading ?? 'Inter',
    headingWeight: extras.headingWeight ?? 800,
    bodyFont: extras.body ?? 'Inter',
    fonts: extras.fonts ?? [],
    logo: extras.logo ?? null,
    logoTone: extras.logo ? (extras.logoTone ?? null) : null,
    footer: brand.footerText?.trim() || null
  }
}

/**
 * The plate a logo needs, by where it sits: a white one on the dark cards
 * for a logo that is not light, a card-coloured one on the light slides for
 * a light logo. Null where it reads as it is. An unknown tone gets a plate
 * on the cards, where a dark logo would be lost.
 */
export function logoPlates(theme: VideoTheme): {
  card: string | null
  slide: string | null
} {
  if (!theme.logo) return { card: null, slide: null }
  const tone = theme.logoTone
  return {
    card: tone === null || tone < 0.55 ? WHITE : null,
    slide: tone !== null && tone > 0.65 ? theme.card : null
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
body::before { content: ""; position: absolute; inset: 0;
  background-image: radial-gradient(color-mix(in srgb, ${theme.mark} 18%, transparent) 1.3px, transparent 1.5px);
  background-size: 24px 24px; opacity: .8; }
body::after { content: ""; position: absolute; width: 560px; height: 560px; right: -220px; top: -200px;
  border-radius: 50%; background: radial-gradient(color-mix(in srgb, ${theme.mark} 20%, transparent), transparent 68%); }
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
  line-height: 1.08; letter-spacing: -.02em; color: ${theme.ink}; overflow-wrap: anywhere; }
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
  const footer = $("footer");
  if (footer) footer.textContent = ${JSON.stringify(theme.footer ?? '')};
  const fit = (el, box) => {
    let size = 58;
    el.style.fontSize = size + "px";
    while (size > 24 && (el.scrollHeight > box.clientHeight - 48 || el.scrollWidth > el.clientWidth + 1)) {
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
    if (scene) fit(headline, $("slide"));
    return true;
  };
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
<div id="bars" class="off"></div>
${brandRow ? `<div id="brand">${brandRow}</div>` : ''}
<main id="slide" class="off"><div id="num"></div><h1 id="headline"></h1></main>
</body></html>`
  return { html, script }
}
