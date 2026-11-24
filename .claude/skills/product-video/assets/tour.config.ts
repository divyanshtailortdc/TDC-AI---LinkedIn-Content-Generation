// Product video config. It sits in the project's video folder, beside the
// toolkit/ folder it runs with. Keep what you need, delete the rest. Only
// `baseUrl` and `scenes` are required; everything else has a default. Scenes
// are plain code, so anything a browser can do works here: type into forms,
// open menus, inject overlays, trigger animations.
//
// Check for choppiness, record, re-record one scene, re-export, or build the
// silent loop:
//
//   node toolkit/make.ts tour.config.ts --preflight
//   node toolkit/make.ts tour.config.ts
//   node toolkit/make.ts tour.config.ts pricing
//   node toolkit/make.ts tour.config.ts --export
//   node toolkit/make.ts tour.config.ts --loop
//
// Import only types from the project here: Node can't resolve path aliases
// or extensionless imports.

import type { VideoConfig } from "./toolkit/types.ts";

export default {
  // The running app. Record against local or staging, never production data.
  baseUrl: "http://localhost:3000",

  // Layout size in CSS pixels, rendered at pixelRatio for sharp text. Any
  // aspect ratio works: try { width: 390, height: 693 } with a 1080x1920
  // output for vertical video.
  viewport: { width: 1440, height: 810 },
  pixelRatio: 2,

  output: {
    // Relative to this config file: the folder the app serves as static
    // files, such as public/ in Next.js and Vite
    dir: "../../public/video",
    name: "product-tour",
    width: 1920,
    height: 1080,
    formats: ["mp4", "webm"],
    // Poster frame time, in seconds
    posterAt: 2.2,
  },

  theme: {
    background: "#111827", // cards, fades and caption badge
    text: "#ffffff",
    accent: "#a3e635", // step numbers and click ripples
    font: "Inter, ui-sans-serif, system-ui, sans-serif",
    colorScheme: "light", // or "dark", for apps that follow the system
    captionPosition: "bottom-left", // or "bottom-right"
    // Extra CSS to restyle anything: #__pv_curtain (cards), #__pv_caption,
    // #__pv_cursor, or the app itself
    css: "",
  },

  // Selectors to hide while recording (dev tools, debug badges)
  hide: ["nextjs-portal"],
  // Runs after each page loads, before recording: dismiss banners, set state
  async prepare(page) {
    await page.eval(`document.querySelector("#cookie-banner")?.remove(), true`);
  },
  // Anything matching this means the page is still loading
  busy: '[aria-busy="true"], .animate-pulse',

  // Rhythm: multiplier on moves, scrolls and pauses (lower is faster), fade
  // length between cards and screens, and how long step cards stay up
  pace: 0.75,
  fadeMs: 900,
  cardMs: 1000,

  // Signs in once before recording, with a demo account. `page` offers goto,
  // fill, click, press, eval, waitFor, send (raw DevTools Protocol) and
  // setCookies.
  // Read credentials from the environment if they are more than demo data.
  async signIn({ page, baseUrl }) {
    await page.goto(`${baseUrl}/login`);
    await page.fill('input[type="email"]', "demo@example.com");
    await page.fill('input[type="password"]', "demo-password");
    await page.press("Enter");
    // Wait until sign-in finishes: opening another page now would cancel it
    await page.waitFor(`!location.pathname.startsWith("/login")`);
  },

  // Soundtrack, all optional. Paths are relative to this file. Per-segment
  // narration audio goes on each segment as `voiceover`.
  audio: {
    // music: "audio/music.mp3",
    // musicVolume: 0.15,
    // voiceover: "audio/full-narration.mp3", // one file for the whole video
    // voiceoverAt: 0.5,                        // when it starts, in seconds
  },

  // Optional opening and closing cards. `path` is the app page they render on
  // (the card covers it), so `logo` can be a path the app serves.
  intro: {
    path: "/",
    logo: "/logo-dark.svg",
    title: "Your Headline Promise",
    subtitle: "One sentence on what the product does for the viewer.",
    holdMs: 2800,
    narration: "",
    // voiceover: "audio/intro.mp3",
  },
  outro: {
    path: "/",
    logo: "/logo-dark.svg",
    title: "Your Call to Action",
    subtitle: "Start free, or book a demo.",
    holdMs: 3400,
  },

  scenes: [
    {
      key: "dashboard", // lowercase, used to re-record this scene alone
      path: "/dashboard",
      // A title card before the screen, or `card: null` to fade straight in
      card: {
        num: "01",
        title: "See Where You Stand",
        subtitle: "The outcome this screen gives the viewer.",
      },
      // A line that stays on screen during the scene, or omit it
      caption: "A short line shown while the scene plays.",
      // cursor: false,      // hide the fake cursor
      // retake: false,      // one take only, for scenes that change app state
      // minSeconds: 8,      // keep the screen up at least this long
      // Spoken text: feeds the voice-over sheet and the captions file
      narration: "",
      // Audio for this scene; the scene holds until it finishes
      // voiceover: "audio/dashboard.mp3",
      //
      // s: move(x, y, ms), click(x?, y?), scroll(dy, ms, containerSelector?),
      //    pause(ms), find(text) -> { x, y }, caption(card | null)
      // page: goto, eval, waitFor, send, fill, click, press, mouse
      act: async (s, page) => {
        const tile = await s.find("Revenue");
        await s.move(tile.x, tile.y, 900);
        await s.pause(700);
        await s.scroll(400, 1400);
        await s.pause(1200);
      },
    },
  ],

  // Optional silent loop for a hero section: no cursor, captions or cards,
  // crossfaded and seamless. Each clip scrolls by default, or runs its own act.
  loop: {
    seconds: 6,
    crossfade: 0.8,
    clips: [
      { key: "dashboard", path: "/dashboard", scrollFrom: 0, scrollBy: 300 },
      // { key: "reports", path: "/reports", act: async (s) => { … } },
    ],
  },
} satisfies VideoConfig;
