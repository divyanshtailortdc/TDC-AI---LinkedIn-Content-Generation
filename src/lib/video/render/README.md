# Recorded videos (Reels and Shorts)

This folder records every Reel and Short the app makes. It follows the [product-video](../../../../.claude/skills/product-video/SKILL.md) skill's method (installed from `ejekanshjain/skills`, pinned in `skills-lock.json`): a page is played in a headless browser with title cards and captions, recorded, and encoded with ffmpeg. Here the page is the post's script, as slides in the identity's Brand Theme. There is no AI model and no per-video cost.

The code is the skill's toolkit, copied in and adapted. Each file says what it kept and what it changed, and why.

| File | What it does |
| --- | --- |
| `plan.ts` | The script → an opening card (the hook), one slide per line (its on-screen text big, its line as a caption), a closing card (the call to action). Timed for reading; under a minute. Stored as the video's prompt. |
| `page.ts` | The page: brand colours, embedded typefaces (no fetch while recording), logo, website or handle; 540×960 CSS pixels at 2×, so 1080×1920. Text stays clear of the Reels and Shorts buttons. |
| `stage.ts` | The toolkit's stage: title-card curtain, caption badge, frame recorder. Frames are stepped, not screencast (below). |
| `record.ts` | The toolkit's `make.ts`: records each segment, encodes it with its fades, joins them and adds a silent soundtrack. |
| `browser.ts` | The toolkit's dependency-free DevTools Protocol driver. |
| `binaries.ts` | Finds the browser and ffmpeg, locally and on Vercel. |
| `scripts/sample.ts` | Records a sample (or your own script) with no database. |
| `scripts/check.ts` | The toolkit's check: flashes, choppy motion, harsh jumps, a contact sheet. |

The app side is `src/lib/video/providers/recorder.ts` (loads the brand, records one video at a time) and `src/lib/video/post-video.ts` (starts it, records it after the response, stores it). See [docs/SHORT_VIDEOS.md](../../../../docs/SHORT_VIDEOS.md).

## Requirements

- Node.js 22.17 or later (`@sparticuz/chromium` needs it; the driver needs `fetch` and `WebSocket`).
- ffmpeg: `ffmpeg-static` downloads it on install (pnpm runs its install script because `pnpm-workspace.yaml` allows it). Set `FFMPEG_PATH` to use another. No ffprobe needed.
- A browser: an installed Chrome, Chromium, Brave or Edge, or `CHROMIUM_PATH`. On Vercel, and on Linux x64 with none installed, the Chromium build in `@sparticuz/chromium` is unpacked into `/tmp`.

## Make a video

```bash
pnpm video:sample                                  # sample script, default brand → /tmp/post-video-sample.mp4
pnpm video:sample -- --out reel.mp4                # write it somewhere else
pnpm video:sample -- --script post.json            # your script: { hook, body, cta, payload: { shots } }
pnpm video:sample -- --brand brand.json            # { primaryColor, accentColor, backgroundColor, footerText }
pnpm video:sample -- --keep                        # keep each segment's frames, frame list and clip
pnpm video:check /tmp/post-video-sample.mp4        # flashes, choppy motion, contact sheet
```

In the app, **Record video** on a Reel's or Short's page does the same with the post's script and the identity's brand, and stores the MP4 in the bucket.

To try the Vercel browser locally: `AWS_LAMBDA_FUNCTION_NAME=local pnpm video:sample` (Linux x64). Add `taskset -c 0` in front to see it on one CPU, as a Hobby function has.

## Change the video

- **Look:** `page.ts` (slides) and the CSS in `stage.ts` (cards, captions). Keep text out of the top 14% and bottom 24%.
- **Rhythm:** the reading pace and limits at the top of `plan.ts`; the fade length in `record.ts`.
- **What the writer produces:** the video formats' rules in `src/lib/formats/registry.ts` and the shots instruction in `src/lib/ai/skills/variant-drafting/prompt.ts`.
- **Sound:** the soundtrack is silent. Music or a voice-over goes in `record.ts`'s last ffmpeg step; the skill's `references/voiceover.md` explains both. Use only audio you have the rights to, and ask before sending scripts to a paid voice service.

## Why frames are stepped, not screencast

The toolkit records a real-time screencast. On one CPU (a Vercel Hobby function) that fell to 13 frames a second while words moved, and three takes didn't fix it: the "busy computer" cause in the skill's `references/pitfalls.md`. So `stage.ts` pauses the page's animations and steps them one video frame at a time, with a screenshot each. A still page takes no screenshot; its frame lasts until something moves. A frame can't be dropped however slow the machine, and a video records in about 25 to 40 seconds.

The toolkit's other fixes are kept: fades drawn by ffmpeg where the curtain opens and closes, frames on a 1 ms clock in the concat list, full-range JPEGs converted to limited-range BT.709. One more: every clip is encoded at 30 fps (`-r 30`), because the concat filter that draws a fade drops the frame rate, and a clip at ffmpeg's 25 fps default left a 4-second hole where clips joined.

`scripts/check.ts` measures frames itself rather than with ffmpeg's `signalstats`, which reported 8-level changes between identical frames in these videos.

## On Vercel

`next.config.ts` deploys the Chromium build, the ffmpeg binary and the bundled typeface with the two routes that record: `/api/posts/[id]/video` and `/api/cron/jobs` (both `maxDuration = 300`). A recording started anywhere else, such as by drafting, is handed back and recorded by the next page poll or job pass.

Each binary is deployed once, in its package's own folder in pnpm's store (`node_modules/.pnpm/…`), which is where the code finds it: `@sparticuz/chromium` locates its own `bin/`, and `binaries.ts` looks for ffmpeg there when the `node_modules/ffmpeg-static` link is absent. Two things to keep:

- **Never name the binaries through the `node_modules/<name>` link** in `next.config.ts`: the build then lists each binary twice, and the recording functions would pass Vercel's 250 MB.
- **Never import `ffmpeg-static`** from app code: the bundler then traces its 80 MB binary into every route that reaches the recorder.

A local `pnpm build` (2026-11-24) traced 177 MB for `/api/posts/[id]/video` and 184 MB for `/api/cron/jobs`, every file counted once, with every other route unchanged at about 30 MB. **Not yet verified on a Vercel deploy:** the packaged size and the first recording there.
