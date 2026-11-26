# Recording Pitfalls

Each problem below happened while building this method. The toolkit handles all of them; this file explains the symptoms so you keep those fixes when you adapt the toolkit, and can debug a new app.

## The Video Won't Play in Some Browsers

**Symptom:** the video starts, then stops at 0:00. The console shows `PIPELINE_ERROR_DECODE: video decode error`, often only in one browser.

**Cause:** screencast frames are full-range JPEGs. Encoding them as-is tags the video as full range, and some GPU decoders reject that. The browser doesn't fall back to the next `<source>` once a file has started loading.

**Fix:** convert to limited-range BT.709 while encoding (`out_range=tv`, `out_color_matrix=bt709`) and tag the output. `make.ts` does this. Verify with `ffprobe -show_entries stream=color_range,color_space`: expect `tv` and `bt709`.

## A One-Frame Flash of the App Before a Step

**Symptom:** a bright frame blinks between two dark cards.

**Cause:** the screencast's first frame is the last frame painted before the card covered the page.

**Fix:** wait two animation frames after showing the card, then start the screencast and drop its first frame. `Stage.record` does both.

## Harsh or Stuttering Fades

**Symptom:** the move from the dark card to a bright screen feels like a flicker. `check.ts` reports jumps of 30 or more brightness levels during a fade.

**Cause:** the browser drops frames when it fades a full-screen overlay at high resolution, so brightness jumps in uneven steps.

**Fix:** switch the card instantly while recording, note the moment, and draw the fade with ffmpeg afterwards at a steady frame rate. `Stage.curtain` records the moments; `make.ts` draws the fades.

## Blurry Text

**Cause:** screencast frames arrive at 1x CSS pixels unless the browser is launched with `--force-device-scale-factor`.

**Fix:** `browser.ts` passes the pixel ratio at launch and in device emulation. A 1440x810 viewport renders at 2880x1620, and the browser downscales each frame to the 1920x1080 video size.

## Choppy Motion

**Symptom:** motion stutters or drops to 12 to 17 frames per second in places, yet the file reports a steady 30 fps. The export fills gaps with repeated frames, so the file's frame rate proves nothing.

The screencast only sends frames when the page repaints, at irregular times. `stage.ts` keeps a 1px element repainting every frame and writes an ffmpeg concat list with each frame's real duration. Expect 50 to 60 captured frames per second, resampled to 30.

Choppy motion has five separate causes, and each has its own fix:

- **A coarse ffmpeg clock:** ffmpeg gives each image in a concat list a 25 fps clock, and snaps frames to its 40 ms grid. That repeats every sixth frame of the 30 fps video, even from a perfect recording. `Stage.stop` sets `option framerate 1000` on each image to prevent it. Keep that line.
- **Capturing too many pixels:** sending 2880x1620 frames drops the worst second as low as 22 fps on a laptop. `Stage.record` caps frames at the video size, which held 54 fps or better on the same page.
- **A busy computer:** other programs take processor time from the browser. Preflight lists them.
- **An app that blocks its own page:** development builds and heavy work on load freeze the page. The cursor runs off the main thread to survive this. Scrolling doesn't: scroll gestures and wheel input both looked worse in the finished video than the current scroll, so fix the page instead. Preflight reports the longest freeze for each page.
- **A one-off hiccup:** the first scroll of a take sometimes freezes for about 270 ms, and a heavy page can dip for a second. `make.ts` scores each take and records it again, up to 3 takes.

Frame counts don't show every stutter, because frames keep arriving while the content sits still. To check motion, read the check script's `choppySeconds`. It counts repeated frames between moving ones, and treats longer holds as deliberate pauses. Typing can show up there and is fine.

## Dev Overlays in the Shot

Framework dev tools (the Next.js button, screen-size badges) appear in development builds. Add their selectors to `hide` in the config, or record against a production build of the app on a local database.

## Spinners and Half-Loaded Screens

Set `busy` to a selector that matches loading UI. `goto` waits until nothing matches, fonts are ready, then settles for 900 ms.

## A Broken File While a Page Is Open

Overwriting a video while a browser streams it breaks playback, because the byte ranges no longer match. `make.ts` writes each output under a temporary name and renames it into place. After re-exporting, hard-refresh any open page.

## Verifying Playback

Headless Chromium decodes in software, so it can pass files a real browser's GPU decoder rejects. After exporting, play the video in the user's real browser (for example with the use-my-browser skill): press play, wait 8 seconds, seek to the middle, and confirm `currentTime` advances with no `video.error`.

## The Toolkit Won't Start

**Symptom:** `make.ts` stops with `Cannot find module`, `Unknown file extension ".ts"` or a syntax error on a type annotation.

**Cause:** Node runs `.ts` files by stripping their types. That needs Node 22.18 or later, and only works on erasable syntax: no enums, namespaces or constructor parameter properties. Node also resolves imports without the bundler's help: no `@/` path aliases, no extensionless paths.

**Fix:** use Node 22.18+ or Bun, or the project's TypeScript runner such as `tsx`. Keep adapted toolkit code to erasable syntax, and keep the config's imports type-only. A `MODULE_TYPELESS_PACKAGE_JSON` warning in projects without `"type": "module"` is harmless; `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` hides it.
