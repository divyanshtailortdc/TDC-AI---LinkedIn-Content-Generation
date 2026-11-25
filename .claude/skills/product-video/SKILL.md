---
name: product-video
description: Use when the user wants a demo or promo video of their app, a product walkthrough, or a voice-over script for one.
license: MIT
compatibility: The toolkit the skill copies into a project needs Node.js 22.18+ or Bun, ffmpeg 5 or later, and Chrome, Chromium, Brave or Edge. Any other tools are up to the agent and the user.
metadata:
  author: ejekanshjain
  version: '1.1.0'
---

# Product Video

Help the user make a video that shows their product at its best. There is no required length, structure or style: a 15-second feature clip, a 3-minute narrated walkthrough, a vertical social cut and a silent homepage loop are all good answers to different requests. Decide with the user, then choose the approach that serves the video.

`SKILL_DIR` is the directory that contains this file.

## Work With the User

Before building, agree on what matters, and offer a recommendation for each:

- **Goal and audience:** who watches, where (homepage, sales call, social feed, docs, app store), and what they should do after.
- **Format:** length, aspect ratio, pacing, sound on or off, captions, languages.
- **Style:** calm product tour, energetic launch trailer, step-by-step tutorial, before-and-after story, or something else they describe. Reference videos they like help.
- **Story:** which moments of the product prove the value. Start from the customer's problem, not the feature list.
- **Voice:** silent with on-screen text, a narration script only, or finished narration audio. Ask who records or generates the voice.
- **Data:** what appears on screen. Real customer data never should.

Confirm anything destructive (wiping a database, overwriting published files) and anything that costs money or sends data to a third party (paid voice services, stock music) before doing it.

## Choose How to Make It

The bundled toolkit is one way, not the only way. Pick what fits the request:

- **The toolkit** (below): records the real app with a scripted cursor, title cards, captions and fades, then adds narration and music. Fast to re-record after UI changes.
- **Other tools** the user already has or approves: Playwright, a motion graphics or video framework, a screen recorder, a video editor project, design exports. Combine them: for example, record screens with the toolkit and compose them elsewhere.

Whatever you use, everything that builds the video lives in the project: tools, config, audio and docs. A teammate without this skill must be able to rebuild the video, change a scene or make a new one from the repository alone.

## The Toolkit Belongs to the Project

`assets/toolkit/` is reference code, not a program to run from here. Never run anything inside `SKILL_DIR`. Copy the toolkit into the project, adapt it, and run only that copy.

| File                   | What it does                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `toolkit/make.ts`      | Records segments from a config, then exports video, poster, captions, audio mix, timeline and voice-over sheet |
| `toolkit/preflight.ts` | Finds what would make a recording choppy, before you record                                                    |
| `toolkit/snap.ts`      | Screenshots app pages at the recording size, for planning and checking data                                    |
| `toolkit/check.ts`     | Finds one-frame flashes, choppy motion and harsh brightness jumps, writes a contact sheet                      |
| `toolkit/browser.ts`   | A dependency-free DevTools Protocol driver for headless Chrome, Chromium, Brave or Edge                        |
| `toolkit/stage.ts`     | The fake cursor, captions, title cards and frame recorder injected into the page                               |
| `toolkit/types.ts`     | Config types                                                                                                   |
| `tour.config.ts`       | Config template with every option explained                                                                    |
| `video-readme.md`      | Template for the video folder's README                                                                         |

The toolkit is TypeScript with erasable syntax only, so Node 22.18+ and Bun run it without a build step or dependencies. It needs ffmpeg 5 or later and a Chromium-based browser.

If the project already has a toolkit copy without `preflight.ts`, update it from `assets/toolkit/` first and keep the project's own changes. Older copies repeat every sixth frame, however cleanly they record.

### Fit the Project

Before creating any file, read `package.json`, `tsconfig.json` if present, the lint and format config, and the folders where the project keeps its own scripts (seeds, migrations, tooling). Everything you add should look like the team wrote it.

- **Location:** put the video folder beside the project's own tooling. Seeds in `src/db/` or scripts in `src/scripts/` mean `src/video/`. Scripts in a top-level `scripts/` mean a top-level `video/`. With no precedent, use `src/video/` when `src` exists, else `video/`. In a monorepo, stay inside the app's package.
- **Language:** a TypeScript project keeps the toolkit as TypeScript. A JavaScript project gets `.mjs` files: remove the type annotations and `types.ts`, and change `.ts` import paths to `.mjs`.
- **Imports:** the toolkit imports its own files with `.ts` paths, which Node needs. If the project type-checks the video folder, enable `allowImportingTsExtensions` when `tsconfig.json` has `noEmit` (Next.js and Vite apps do). Otherwise drop the extensions and run the toolkit with the project's TypeScript runner, such as `tsx` or Bun.
- **Style:** apply the project's quote, semicolon and naming conventions, then run its formatter, linter and type check on every new file.
- **Output:** point `output.dir` at the folder the app serves as static files, such as `public/video`, relative to the config.

### Set It Up

1. Copy `assets/toolkit/` to `<video folder>/toolkit/`, and `assets/tour.config.ts` to `<video folder>/tour.config.ts`. Adapt them as above.
2. Add package scripts with the project's package manager conventions. For example, with the video folder in `src/video`:

   ```json
   {
     "video": "node src/video/toolkit/make.ts src/video/tour.config.ts",
     "video:preflight": "node src/video/toolkit/make.ts src/video/tour.config.ts --preflight",
     "video:snap": "node src/video/toolkit/snap.ts src/video/tour.config.ts",
     "video:check": "node src/video/toolkit/check.ts public/video/product-tour.mp4"
   }
   ```

   Use `bun` or `tsx` in place of `node` if that is how the project runs TypeScript. In a package without `"type": "module"`, add `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` after `node` to silence a harmless warning.

3. Write `<video folder>/README.md` from `assets/video-readme.md`, filled in with this project's paths, commands, demo login and seed command. Add one line to the project's main README or agent instructions pointing to it.
4. Keep the fixes the reference code carries. Each odd-looking step, such as dropping the first frame or converting color range, prevents a bug described in [references/pitfalls.md](references/pitfalls.md).

Change the project's copy freely: add zooms, transitions, overlays, ffmpeg filters or scene helpers when the video needs them. Small additions also fit inside a scene's `act` or the config's `prepare` hook.

### Make the Video

Run everything through the project's scripts. With npm:

```bash
npm run video:snap -- /dashboard --full   # look before you script
npm run video:preflight                   # find what would make it choppy
npm run video                             # record everything, export
npm run video -- pricing                  # re-record one segment
npm run video -- --export                 # new narration or music, no re-recording
npm run video -- --loop                   # the silent loop
npm run video:check
```

What a config controls, all optional beyond `baseUrl` and `scenes`:

- **Look:** viewport and output size (any aspect ratio, such as a phone viewport for vertical video), theme colors and font, `theme.css` to restyle cards, captions and cursor completely.
- **Segments:** an optional intro and outro card, then scenes. Each scene can have a title card or none (`card: null`), a caption or none, the cursor or none (`cursor: false`), and a minimum screen time.
- **Action:** each scene's `act(s, page)` is plain async code. Use the helpers (`s.move`, `s.click`, `s.scroll`, `s.find`, `s.pause`, `s.caption`) or anything the browser allows through `page.eval` and `page.send` (raw DevTools Protocol): type into forms, open menus, trigger animations, inject overlays, highlight elements.
- **Sound:** `narration` text per segment, `voiceover` audio per segment (the scene holds until it ends), one whole-video voice-over file, background music.
- **Timing:** `pace`, `cardMs` and `fadeMs` tune the rhythm. The config template explains each.

Every export also writes, next to the config, a timeline of each segment's start and end, and a voice-over sheet with each segment's speaking window and word budget. Read [references/voiceover.md](references/voiceover.md) when the video has narration.

Never click anything during recording that changes real data, sends messages or spends money.

### Keep Motion Smooth

Choppy motion is the most common way a recording fails. Follow these steps for every recording:

1. Run preflight before the first recording and after any app change. It takes a few seconds per page, and exits 1 when something needs fixing.
2. Apply each item in its `fixes` list. Ask the user before you quit or pause any of their programs.
3. Record a production build of the app when you can. Development builds compile on demand and block the page.
4. Start nothing else heavy during recording: no builds, test suites, or second recordings.
5. Read the `Recorded` line for each segment. A choppy take is redone automatically, up to 3 takes, and the smoothest one stays.
6. If a line ends in `CHOPPY`, run preflight again and fix the cause. More retakes won't help a page that blocks itself.
7. Trust the check script, not the file's frame rate. Every export reports 30 fps, because repeated frames fill any gaps.

Set `retake: false` on a scene whose `act` changes app state, such as creating a record. A retake repeats everything in `act`, so that scene gets one take. Reset the demo data before you run it again.

[references/pitfalls.md](references/pitfalls.md) explains each cause of choppy motion.

## Guides

Read these when they apply. They collect what worked, not rules:

- [references/sample-data.md](references/sample-data.md): building a believable fictional dataset safely.
- [references/storyboard.md](references/storyboard.md): story shapes, scene ideas and pacing for different kinds of video.
- [references/voiceover.md](references/voiceover.md): writing narration to the timeline, producing audio, music and captions.
- [references/pitfalls.md](references/pitfalls.md): recording problems already solved (decode errors, flashes, stutter, blur) and how.
- [references/embedding.md](references/embedding.md): publishing on a website: autoplay rules, posters, sound, captions.

## Check Before Calling It Done

- Watch it, or look at the check script's contact sheet: no spinners, empty states, errors, debug overlays or real people's data.
- The check script reports no one-frame flashes and no choppy seconds. Harsh jumps are fine when they are deliberate cuts.
- Every claim on screen and in the narration is true of the product.
- Play the published file in a real browser, not only headless: press play, seek, and listen if it has sound.

## Report to the User

Describe what the viewer sees and hears: length, story, where it appears, file sizes, anything you couldn't verify, and the commands that rebuild it. Mention real bugs you noticed in the product while filming.
