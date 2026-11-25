import type { Browser } from "./browser.ts";
import type { Stage } from "./stage.ts";

// Types for the video config. The config imports them with `import type`, so
// they disappear at runtime.

export type Point = { x: number; y: number };
export type Viewport = { width: number; height: number };

export type Card = { num?: string; title?: string; subtitle?: string; logo?: string };

/** A scene's actions: `s` drives the fake cursor, `page` the browser tab. */
export type Act = (s: Stage, page: Browser) => Promise<void>;

export type Theme = {
  /** Cards, fades and caption badge. */
  background: string;
  text: string;
  /** Step numbers and click ripples. */
  accent: string;
  font: string;
  /** For apps that follow the system theme. */
  colorScheme: "light" | "dark";
  captionPosition: "bottom-left" | "bottom-right";
  /** Extra CSS: #__pv_curtain (cards), #__pv_caption, #__pv_cursor, or the app. */
  css: string;
};

export type Output = {
  /** Relative to the config file. */
  dir: string;
  name: string;
  width: number;
  height: number;
  formats: Array<"mp4" | "webm">;
  /** Poster frame time, in seconds. */
  posterAt: number;
};

export type Audio = {
  music?: string;
  musicVolume?: number;
  /** One voice-over file for the whole video. */
  voiceover?: string;
  /** When the whole-video voice-over starts, in seconds. */
  voiceoverAt?: number;
};

type Sound = {
  /** Spoken text: feeds the voice-over sheet and the captions file. */
  narration?: string;
  /** Audio for this segment, relative to the config. The segment holds until it ends. */
  voiceover?: string;
  /** Keeps the segment up at least this long. */
  minSeconds?: number;
};

/** The intro or outro card. `path` is the app page the card covers. */
export type Bookend = Card & Sound & { path?: string; holdMs?: number };

export type Scene = Sound & {
  /** Lowercase letters, digits and hyphens. Re-record one scene by its key. */
  key: string;
  path: string;
  /** A title card before the screen, or null to fade straight in. */
  card?: Card | null;
  /** A line shown while the scene plays. */
  caption?: string;
  cursor?: boolean;
  /** False when `act` changes app state, because a retake would repeat it. */
  retake?: boolean;
  act: Act;
};

export type LoopClip = {
  key: string;
  path: string;
  scrollFrom?: number;
  scrollBy?: number;
  /** False when `act` changes app state, because a retake would repeat it. */
  retake?: boolean;
  act?: Act;
};

export type Loop = { seconds?: number; crossfade?: number; name?: string; clips: LoopClip[] };

export interface VideoConfig {
  /** The running app: local or staging, never production data. */
  baseUrl: string;
  /** Layout size in CSS pixels. */
  viewport?: Viewport;
  /** Render scale, for sharp text. */
  pixelRatio?: number;
  output?: Partial<Output>;
  theme?: Partial<Theme>;
  /** Selectors to hide while recording. */
  hide?: string[];
  /** Anything matching this means the page is still loading. */
  busy?: string;
  /** Multiplier on moves, scrolls and pauses. Lower is faster. */
  pace?: number;
  fadeMs?: number;
  cardMs?: number;
  /** Runs after each page loads, before recording. */
  prepare?: (page: Browser) => Promise<void>;
  /** Signs in once before recording, with a demo account. */
  signIn?: (context: { page: Browser; baseUrl: string }) => Promise<void>;
  audio?: Audio;
  intro?: Bookend;
  outro?: Bookend;
  scenes: Scene[];
  loop?: Loop;
}
