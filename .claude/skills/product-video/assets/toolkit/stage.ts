import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { type Browser, sleep } from "./browser.ts";
import type { Card, Point, Theme, Viewport } from "./types.ts";

// Recording helpers that live inside the page: a fake cursor, a caption
// badge, a full-screen title card ("curtain") for transitions, and a frame
// recorder. Nothing here changes the app being filmed.

export type StageOptions = {
  theme: Theme;
  hide: string[];
  pace: number;
  pixelRatio: number;
  viewport: Viewport;
  /** Size of the finished video. Frames arrive at this size, not the render size. */
  capture: Viewport;
};

/** How steadily a take was captured. */
export type Smoothness = {
  /** Fewest frames captured in any one second of the clip. */
  worstFps: number;
  /** Where that second starts, in seconds from the clip start. */
  worstAt: number;
  /** Longest wait between two frames. */
  longestGapMs: number;
  /** Longest time the app blocked its own page. */
  pageFreezeMs: number;
};

type Frame = { sessionId: number; data: string; metadata: { timestamp: number } };

const stageScript = (theme: Theme, hide: string[]) => {
  const css = `
    ${hide.length ? `${hide.join(", ")} { display: none !important; }` : ""}
    html { scroll-behavior: auto !important; }
    *::-webkit-scrollbar { display: none; }
    #__pv_cursor { position: fixed; left: 0; top: 0; z-index: 2147483646; pointer-events: none;
      transform: translate(-100px, -100px); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    #__pv_cursor .ring { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px;
      border-radius: 999px; background: ${theme.accent}; opacity: 0; transform: scale(0); }
    #__pv_cursor.click .ring { animation: __pv_ring .45s ease-out; }
    @keyframes __pv_ring { 0% { transform: scale(.3); opacity: .55 } 100% { transform: scale(1.6); opacity: 0 } }
    #__pv_caption { position: fixed; ${theme.captionPosition === "bottom-right" ? "right" : "left"}: 28px; bottom: 28px;
      z-index: 2147483645; pointer-events: none; display: flex; align-items: center; gap: 14px;
      padding: 14px 22px 14px 16px; border-radius: 16px; background: ${theme.background}; color: ${theme.text};
      font-family: ${theme.font}; box-shadow: 0 12px 40px rgba(0,0,0,.3); opacity: 0; transform: translateY(14px);
      transition: opacity .45s ease, transform .45s cubic-bezier(.2,.8,.2,1); }
    #__pv_caption.on { opacity: 1; transform: none; }
    #__pv_caption .num { font: 600 13px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: ${theme.background};
      background: ${theme.accent}; border-radius: 8px; padding: 7px 8px; }
    #__pv_caption .t { font-weight: 650; font-size: 19px; letter-spacing: -.01em; }
    #__pv_caption .s { font-size: 14.5px; color: color-mix(in srgb, currentColor 72%, transparent); margin-top: 3px; }
    #__pv_curtain { position: fixed; inset: 0; z-index: 2147483647; background: ${theme.background};
      pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 18px; padding: 0 8%; text-align: center; font-family: ${theme.font}; color: ${theme.text}; }
    #__pv_curtain.off { opacity: 0; }
    #__pv_curtain .num { font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: ${theme.accent};
      letter-spacing: .2em; }
    #__pv_curtain .t { font-size: 54px; font-weight: 700; letter-spacing: -.025em; line-height: 1.1; }
    #__pv_curtain .s { font-size: 21px; color: color-mix(in srgb, currentColor 70%, transparent); }
    #__pv_curtain img { display: block; height: 72px; width: auto; }
    #__pv_curtain > * { opacity: 0; transform: translateY(10px);
      transition: opacity .5s ease, transform .6s cubic-bezier(.2,.8,.2,1); }
    #__pv_curtain.text > * { opacity: 1; transform: none; }
    #__pv_curtain.text > .s { transition-delay: .12s; }
    ${theme.css ?? ""}
  `;
  return `(() => {
    if (window.__pv) return true;
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
    const make = (id, html) => { const el = document.createElement("div"); el.id = id; el.innerHTML = html; return el; };
    const cursor = make("__pv_cursor", '<div class="ring"></div><svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2.5v19.2l5.1-4.9 3.3 7.5 3.4-1.5-3.3-7.4h7.1z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>');
    const caption = make("__pv_caption", "");
    const curtain = make("__pv_curtain", "");
    // A 1px element that repaints every frame, so frames keep coming when nothing moves
    const tick = make("__pv_tick", "");
    tick.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;z-index:2147483647;pointer-events:none";
    document.body.append(cursor, caption, curtain, tick);
    let i = 0, last = 0;
    const paint = now => {
      if (last) __pv.freeze = Math.max(__pv.freeze, now - last);
      last = now;
      tick.style.background = i++ % 2 ? "#000" : "#010101";
      requestAnimationFrame(paint);
    };
    // Builds card or caption content as text, so titles never inject markup
    const fill = (el, card, wrapText) => {
      el.replaceChildren();
      const add = (parent, cls, text) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; parent.appendChild(d); return d; };
      if (card.logo) { const img = document.createElement("img"); img.src = card.logo; img.alt = ""; const w = document.createElement("div"); w.appendChild(img); el.appendChild(w); }
      if (card.num) add(el, "num", card.num);
      const box = wrapText ? el.appendChild(document.createElement("div")) : el;
      if (card.title) add(box, "t", card.title);
      if (card.subtitle) add(box, "s", card.subtitle);
    };
    // A transform animation runs off the main thread, so a busy app can't stall the cursor
    const glide = (frames, ms) => {
      const place = p => "translate(" + (p.x - 4) + "px, " + (p.y - 2) + "px)";
      const end = frames[frames.length - 1];
      cursor.animate(frames.map(p => ({ transform: place(p) })), { duration: ms, easing: "linear" });
      cursor.style.transform = place(end);
      __pv.x = end.x;
      __pv.y = end.y;
    };
    window.__pv = { cursor, caption, curtain, fill, glide, x: -100, y: -100, freeze: 0 };
    requestAnimationFrame(paint);
    return true;
  })()`;
};

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/** Scores frame arrival times, in seconds. Assumes at least one frame. */
function measure(times: number[], pageFreezeMs: number): Smoothness {
  let longestGap = 0;
  for (let i = 1; i < times.length; i++) longestGap = Math.max(longestGap, times[i] - times[i - 1]);
  const clip = times[times.length - 1] - times[0];
  // Clips under a second have no full window, so score the rate over the clip
  let worstFps = clip < 1 ? Math.round(times.length / Math.max(clip, 0.001)) : Infinity;
  let worstAt = 0;
  let end = 0;
  for (let start = 0; times[start] + 1 <= times[times.length - 1]; start++) {
    while (times[end] < times[start] + 1) end++;
    if (end - start < worstFps) {
      worstFps = end - start;
      worstAt = times[start] - times[0];
    }
  }
  return { worstFps, worstAt, longestGapMs: Math.round(longestGap * 1000), pageFreezeMs: Math.round(pageFreezeMs) };
}

/** Scene helpers for one browser tab, plus a frame recorder. */
export class Stage {
  page: Browser;
  options: StageOptions;
  #frames: Array<{ file: string; ts: number }> = [];
  #dir = "";
  #recording = false;
  #skipFirst = false;
  #marks: { open?: number; close?: number } = {};
  #writes: Promise<void>[] = [];

  constructor(page: Browser, options: StageOptions) {
    this.page = page;
    this.options = options;
    page.on("Page.screencastFrame", (frame: Frame) => {
      page.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      if (!this.#recording) return;
      // The first frame can be the last one painted before the curtain
      // closed, which would flash the app for one frame
      if (this.#skipFirst) {
        this.#skipFirst = false;
        return;
      }
      const file = path.join(
        this.#dir,
        `${String(this.#frames.length).padStart(6, "0")}.jpg`,
      );
      this.#frames.push({ file, ts: frame.metadata.timestamp });
      this.#writes.push(writeFile(file, Buffer.from(frame.data, "base64")));
    });
  }

  /** Adds the cursor, caption and a closed curtain to the current page. */
  async inject({ cursor = true }: { cursor?: boolean } = {}) {
    await this.page.eval(stageScript(this.options.theme, this.options.hide));
    if (!cursor) await this.page.eval(`__pv.cursor.style.display = "none"`);
  }

  /** Starts saving painted frames into `dir`. */
  async record(dir: string) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    this.#dir = dir;
    this.#frames = [];
    this.#writes = [];
    this.#marks = {};
    // Wait until the closed curtain is on screen before capturing
    await this.page.eval(
      "new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => { __pv.freeze = 0; done(true); })))",
    );
    this.#skipFirst = true;
    this.#recording = true;
    // Capturing above the video size drops frames and adds no visible sharpness
    await this.page.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: this.options.capture.width,
      maxHeight: this.options.capture.height,
      everyNthFrame: 1,
    });
  }

  /**
   * Stops recording and writes an ffmpeg concat list in which each frame
   * lasts until the next one arrived. The list names frames relative to its
   * own folder, so quotes or spaces in the temp path can't break it. Returns
   * the clip length, when the curtain opened and closed, in seconds from the
   * clip start, and how steadily frames arrived.
   */
  async stop() {
    await sleep(120);
    this.#recording = false;
    await this.page.send("Page.stopScreencast");
    const pageFreezeMs = await this.page.eval<number>("window.__pv?.freeze ?? 0").catch(() => 0);
    await sleep(200);
    await Promise.all(this.#writes);
    const frames = this.#frames;
    if (!frames.length)
      throw new Error("No frames were captured, so this clip is empty.");
    // Each image gets a 1 ms clock. Without it, ffmpeg snaps frames to its 25 fps
    // default, which repeats every sixth frame of the 30 fps video
    const entry = (f: { file: string }) => [`file '${path.basename(f.file)}'`, "option framerate 1000"];
    const lines = frames.flatMap((f, i) => {
      const next = frames[i + 1];
      const duration = next ? Math.max(next.ts - f.ts, 0.001) : 1 / 30;
      return [...entry(f), `duration ${duration.toFixed(4)}`];
    });
    const last = frames[frames.length - 1];
    lines.push(...entry(last));
    writeFileSync(path.join(this.#dir, "list.txt"), ["ffconcat version 1.0", ...lines].join("\n"));
    const since = (t?: number) => (t === undefined ? undefined : Math.max(0, t - frames[0].ts));
    return {
      seconds: last.ts - frames[0].ts,
      marks: { open: since(this.#marks.open), close: since(this.#marks.close) },
      smoothness: measure(frames.map((f) => f.ts), pageFreezeMs),
    };
  }

  /** Waits, scaled by the configured pace. */
  pause(ms: number) {
    return sleep(ms * this.options.pace);
  }

  /**
   * Opens or closes the curtain instantly, optionally showing a card on it.
   * Recording notes the moment so the export can draw a smooth fade there.
   */
  async curtain(open: boolean, card?: Card, ms = 0) {
    // Noted before the switch, so no bright frame lands before a fade
    const now = Date.now() / 1000;
    if (this.#recording && open) this.#marks.open = now;
    else if (this.#recording && this.#marks.open !== undefined)
      this.#marks.close = now;
    await this.page.eval(`(async () => {
      ${card ? `__pv.fill(__pv.curtain, ${JSON.stringify(card)}, false);` : ""}
      // Show the logo only once it has loaded
      await __pv.curtain.querySelector("img")?.decode().catch(() => {});
      __pv.curtain.classList.toggle("off", ${open});
      return true;
    })()`);
    await sleep(ms);
  }

  /** Fades the card text on the curtain in or out. */
  async curtainText(show: boolean, ms = 600) {
    await this.page.eval(`__pv.curtain.classList.toggle("text", ${show}), true`);
    await sleep(ms);
  }

  /** Shows the caption badge, or hides it when `card` is null. */
  async caption(card: Card | null) {
    await this.page.eval(`(() => {
      ${card ? `__pv.fill(__pv.caption, ${JSON.stringify(card)}, true);` : ""}
      __pv.caption.classList.toggle("on", ${!!card});
      return true;
    })()`);
  }

  /** Glides the cursor to a point, sending real mouse moves so hover states show. */
  async move(x: number, y: number, ms = 700) {
    ms *= this.options.pace;
    const from = await this.page.eval<Point>("({ x: __pv.x, y: __pv.y })");
    // The first move of a scene starts just off to the lower right
    const start = from.x < 0 ? { x: x + 180, y: y + 140 } : from;
    const at = (p: number): Point => {
      const e = ease(p);
      // A slight arc looks more like a hand than a straight line
      return {
        x: start.x + (x - start.x) * e + Math.sin(Math.PI * e) * (y - start.y) * 0.06,
        y: start.y + (y - start.y) * e - Math.sin(Math.PI * e) * (x - start.x) * 0.06,
      };
    };
    const steps = Math.max(8, Math.round(ms / 16));
    const frames = Array.from({ length: steps + 1 }, (_, i) => at(i / steps));
    const t0 = performance.now();
    await this.page.eval(`__pv.glide(${JSON.stringify(frames)}, ${ms}), true`);
    for (let p = 0; p < 1; ) {
      await sleep(33);
      p = Math.min(1, (performance.now() - t0) / ms);
      const point = at(p);
      await this.page.mouse("mouseMoved", point.x, point.y);
    }
  }

  /** Clicks where the cursor is, or moves there first. */
  async click(x?: number, y?: number) {
    if (x !== undefined && y !== undefined) await this.move(x, y);
    const pos = await this.page.eval<Point>("({ x: __pv.x, y: __pv.y })");
    await this.page.eval(
      `(() => { const c = __pv.cursor; c.classList.remove("click"); void c.offsetWidth; c.classList.add("click"); return true; })()`,
    );
    await this.page.mouse("mousePressed", pos.x, pos.y);
    await sleep(70);
    await this.page.mouse("mouseReleased", pos.x, pos.y);
  }

  /**
   * Smoothly scrolls by `dy` CSS pixels. Scrolls the page, or the element
   * matching `container` for apps that scroll inside a panel.
   */
  async scroll(dy: number, ms = 1400, container?: string) {
    ms *= this.options.pace;
    await this.page.eval(`new Promise(done => {
      const el = ${container ? `document.querySelector(${JSON.stringify(container)})` : "document.scrollingElement"};
      const from = el.scrollTop;
      const to = Math.max(0, Math.min(from + ${dy}, el.scrollHeight - el.clientHeight));
      const t0 = performance.now();
      const ease = p => p < .5 ? 4*p*p*p : 1 - Math.pow(-2*p + 2, 3) / 2;
      (function step(now) {
        const p = Math.min(1, (now - t0) / ${ms});
        el.scrollTop = from + (to - from) * ease(p);
        p < 1 ? requestAnimationFrame(step) : done(true);
      })(t0);
    })`);
  }

  /**
   * Viewport position of the smallest visible element whose text starts with
   * `text`, so scenes point at things without fixed coordinates.
   */
  async find(text: string) {
    const point = await this.page.eval<Point | null>(`(() => {
      const t = ${JSON.stringify(text)};
      const starts = e => (e.textContent || "").trim().startsWith(t);
      const el = [...document.querySelectorAll("body *")].find(e => {
        if (e.closest("#__pv_caption, #__pv_curtain")) return false;
        const b = e.getBoundingClientRect();
        return starts(e) && b.width > 0 && b.height > 0 && ![...e.children].some(starts);
      });
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left + Math.min(b.width / 2, 120), y: b.top + b.height / 2 };
    })()`);
    if (!point) throw new Error(`The text "${text}" is not on the page.`);
    return point;
  }
}
