import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Browser } from './browser'

// Recording helpers that live inside the page, adapted from the product-video
// skill's toolkit (.claude/skills/product-video, assets/toolkit/stage.ts): a
// caption badge, a full-screen title card ("curtain") for transitions, and a
// frame recorder that writes the toolkit's ffmpeg concat list.
//
// Changes from the toolkit: styled for a vertical video, with text clear of
// the Reels and Shorts buttons; no fake cursor, because these videos have
// nothing to click; the type on a card shrinks to fit. And frames are not a
// real-time screencast: the page's animations are paused and stepped one
// video frame at a time, with a screenshot of each. On a server's single CPU
// the screencast fell to 13 frames a second while words moved (the
// "busy computer" cause in the skill's references/pitfalls.md); a stepped
// frame cannot be dropped, however slow the machine. A still page takes no
// screenshots: its last frame lasts until something moves.

export type Card = {
  /** Small text above the title, such as a step number or the platform. */
  num?: string
  title?: string
  subtitle?: string
  /** The website or handle, at the card's foot. */
  footer?: string
  /** An image URL; a data URL here, so nothing is fetched. */
  logo?: string
}

export type StageTheme = {
  /** Cards, fades and the caption badge. */
  background: string
  text: string
  /** Step numbers and small text on cards. */
  accent: string
  headingFont: string
  headingWeight: number
  bodyFont: string
  /** A plate behind the logo on cards, when it would vanish there; null for none. */
  logoPlate: string | null
}

export type StageOptions = {
  theme: StageTheme
}

/** One video frame at 30 fps, in milliseconds. */
const FRAME_MS = 1000 / 30

const stageScript = (theme: StageTheme) => {
  const css = `
    #__pv_caption { position: fixed; left: 50%; bottom: 236px; z-index: 2147483645; pointer-events: none;
      width: max-content; max-width: 444px; box-sizing: border-box; padding: 13px 18px; border-radius: 16px;
      background: ${theme.background}; color: ${theme.text}; font-family: ${theme.bodyFont}; text-align: center;
      box-shadow: 0 12px 40px rgba(0,0,0,.28); opacity: 0; transform: translate(-50%, 14px);
      transition: opacity .45s ease, transform .45s cubic-bezier(.2,.8,.2,1); }
    #__pv_caption.on { opacity: 1; transform: translate(-50%, 0); }
    #__pv_caption .s { font-size: 20px; font-weight: 600; line-height: 1.32; }
    #__pv_curtain { position: fixed; inset: 0; z-index: 2147483647; background: ${theme.background};
      pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 20px; box-sizing: border-box; padding: 140px 44px 240px; text-align: center;
      font-family: ${theme.bodyFont}; color: ${theme.text}; }
    #__pv_curtain.off { opacity: 0; }
    #__pv_curtain .num { font: 700 15px/1.2 ${theme.bodyFont}; color: ${theme.accent};
      letter-spacing: .18em; text-transform: uppercase; }
    #__pv_curtain .t { font-family: ${theme.headingFont}; font-size: 54px; font-weight: ${theme.headingWeight};
      letter-spacing: -.025em; line-height: 1.08; overflow-wrap: anywhere; max-width: 100%; }
    #__pv_curtain .s { font-size: 22px; line-height: 1.35; color: color-mix(in srgb, currentColor 78%, transparent); }
    #__pv_curtain .f { position: absolute; left: 0; right: 0; bottom: 250px; font-size: 17px; font-weight: 600;
      color: ${theme.accent}; }
    #__pv_curtain img { display: block; height: 64px; width: auto; max-width: 260px; object-fit: contain;
      ${theme.logoPlate ? `background: ${theme.logoPlate}; padding: 12px 18px; border-radius: 16px;` : ''} }
    #__pv_curtain > * { opacity: 0; transform: translateY(12px);
      transition: opacity .5s ease, transform .6s cubic-bezier(.2,.8,.2,1); }
    #__pv_curtain.text > * { opacity: 1; transform: none; }
    #__pv_curtain.text > .t { transition-delay: .06s; }
    #__pv_curtain.text > .s { transition-delay: .16s; }
    #__pv_curtain.text > .f { transition-delay: .26s; }
  `
  return `(() => {
    if (document.getElementById("__pv_curtain")) return true;
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
    const make = (id) => { const el = document.createElement("div"); el.id = id; return el; };
    const caption = make("__pv_caption");
    const curtain = make("__pv_curtain");
    document.body.append(caption, curtain);
    // Shrinks a card's title until the card fits the screen
    const fit = el => {
      let size = 54;
      el.style.fontSize = size + "px";
      while (size > 26 && (curtain.scrollHeight > innerHeight + 1 || el.scrollWidth > el.clientWidth + 1)) {
        size -= 2;
        el.style.fontSize = size + "px";
      }
    };
    // Builds card or caption content as text, so titles never inject markup
    const fill = (el, card, wrapText) => {
      el.replaceChildren();
      const add = (parent, cls, text) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; parent.appendChild(d); return d; };
      if (card.logo) { const img = document.createElement("img"); img.src = card.logo; img.alt = ""; el.appendChild(img); }
      if (card.num) add(el, "num", card.num);
      const box = wrapText ? el.appendChild(document.createElement("div")) : el;
      const title = card.title ? add(box, "t", card.title) : null;
      if (card.subtitle) add(box, "s", card.subtitle);
      if (card.footer) add(el, "f", card.footer);
      if (title && el === curtain) fit(title);
    };
    // The page's clock, stepped by the recorder. Animations still to play:
    const moving = () => document.getAnimations().filter(a => {
      const end = a.effect ? a.effect.getComputedTiming().endTime : 0;
      return (a.currentTime ?? 0) < end;
    });
    // Anything that just started is paused at its first frame
    const hold = () => {
      for (const a of document.getAnimations())
        if (a.playState === "running") { a.pause(); a.currentTime = 0; }
      return true;
    };
    // Moves every animation on by ms; says whether anything was still moving
    const step = ms => {
      const list = moving();
      for (const a of list) a.currentTime = (a.currentTime ?? 0) + ms;
      return list.length > 0;
    };
    // Plays out whatever is left, so a new recording starts from rest
    const settle = () => {
      for (const a of moving()) { try { a.finish(); } catch {} }
      return true;
    };
    window.__pv = { caption, curtain, fill, hold, step, settle };
    return true;
  })()`
}

/** Card and caption helpers for one browser tab, plus a frame recorder. */
export class Stage {
  page: Browser
  options: StageOptions
  #frames: Array<{ file: string; ts: number }> = []
  #dir = ''
  #recording = false
  /** Milliseconds of video recorded so far: the page's own clock. */
  #clock = 0
  #marks: { open?: number; close?: number } = {}

  constructor(page: Browser, options: StageOptions) {
    this.page = page
    this.options = options
  }

  /** Adds the caption and a closed curtain to the current page. */
  async inject() {
    await this.page.eval(stageScript(this.options.theme))
  }

  /**
   * Saves what the page shows now as the frame at the current time: the
   * viewport at its pixel ratio, which is the video's size.
   */
  async #capture() {
    const shot = await this.page.send<{ data: string }>(
      'Page.captureScreenshot',
      { format: 'jpeg', quality: 90, optimizeForSpeed: true }
    )
    const ts = this.#clock / 1000
    // Two changes at one moment: only the later picture is ever seen
    const last = this.#frames[this.#frames.length - 1]
    const file =
      last && last.ts === ts
        ? last.file
        : path.join(
            this.#dir,
            `${String(this.#frames.length).padStart(6, '0')}.jpg`
          )
    if (!last || last.ts !== ts) this.#frames.push({ file, ts })
    await writeFile(file, Buffer.from(shot.data, 'base64'))
  }

  /**
   * Runs page code that changes what is shown, pauses whatever it started,
   * and, while recording, saves the new picture.
   */
  async change(expression: string) {
    await this.page.eval(expression)
    await this.page.eval('__pv.hold()')
    if (this.#recording) await this.#capture()
  }

  /** Starts saving frames into `dir`, from a page at rest. */
  async record(dir: string) {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    this.#dir = dir
    this.#frames = []
    this.#marks = {}
    this.#clock = 0
    await this.page.eval('__pv.settle()')
    this.#recording = true
    await this.#capture()
  }

  /**
   * Lets `ms` of video pass: animations move one frame at a time, each
   * frame saved; once nothing moves, the last frame simply lasts.
   */
  async wait(ms: number) {
    let left = Math.max(0, ms)
    while (left > 0.5) {
      const step = Math.min(FRAME_MS, left)
      const moved = await this.page.eval<boolean>(`__pv.step(${step})`)
      this.#clock += moved ? step : left
      left = moved ? left - step : 0
      if (moved && this.#recording) await this.#capture()
    }
  }

  /**
   * Stops recording and writes an ffmpeg concat list in which each frame
   * lasts until the next one, the last until the end of the recording. The
   * list names frames relative to its own folder, so quotes or spaces in the
   * temp path can't break it. Returns the clip length and when the curtain
   * opened and closed, in seconds from the clip start.
   */
  async stop() {
    this.#recording = false
    const frames = this.#frames
    const last = frames[frames.length - 1]
    if (!last)
      throw new Error('No frames were captured, so this clip is empty.')
    const end = Math.max(this.#clock / 1000, last.ts + 1 / 30)
    // Each image gets a 1 ms clock. Without it, ffmpeg snaps frames to its 25 fps
    // default, which repeats every sixth frame of the 30 fps video
    const entry = (f: { file: string }) => [
      `file '${path.basename(f.file)}'`,
      'option framerate 1000'
    ]
    const lines = frames.flatMap((f, i) => {
      const next = frames[i + 1]
      const duration = Math.max((next ? next.ts : end) - f.ts, 0.001)
      return [...entry(f), `duration ${duration.toFixed(4)}`]
    })
    lines.push(...entry(last))
    await writeFile(
      path.join(this.#dir, 'list.txt'),
      ['ffconcat version 1.0', ...lines].join('\n')
    )
    return {
      seconds: end,
      frames: frames.length,
      marks: { ...this.#marks }
    }
  }

  /**
   * Opens or closes the curtain instantly, optionally showing a card on it,
   * then lets `ms` pass. Recording notes the moment so the export can draw a
   * smooth fade there.
   */
  async curtain(open: boolean, card?: Card, ms = 0) {
    // Noted before the switch, so no bright frame lands before a fade
    const now = this.#clock / 1000
    if (this.#recording && open) this.#marks.open = now
    else if (this.#recording && this.#marks.open !== undefined)
      this.#marks.close = now
    await this.change(`(async () => {
      ${card ? `__pv.fill(__pv.curtain, ${JSON.stringify(card)}, false);` : ''}
      // Show the logo only once it has loaded
      await __pv.curtain.querySelector("img")?.decode().catch(() => {});
      __pv.curtain.classList.toggle("off", ${open});
      return true;
    })()`)
    await this.wait(ms)
  }

  /** Fades the card text on the curtain in or out, over `ms`. */
  async curtainText(show: boolean, ms = 600) {
    await this.change(`__pv.curtain.classList.toggle("text", ${show}), true`)
    await this.wait(ms)
  }

  /** Shows the caption badge, or hides it when `card` is null. */
  async caption(card: Card | null) {
    await this.change(`(() => {
      ${card ? `__pv.fill(__pv.caption, ${JSON.stringify(card)}, true);` : ''}
      __pv.caption.classList.toggle("on", ${!!card});
      return true;
    })()`)
  }
}
