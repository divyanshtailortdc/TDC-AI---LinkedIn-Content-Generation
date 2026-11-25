# Short videos (Reels and Shorts)

> **Recorded since 2026-11-24.** Videos are made with the [product-video](../.claude/skills/product-video/SKILL.md) skill's method: see [Recording](#recording) and [src/lib/video/render/README.md](../src/lib/video/render/README.md). The AI-clip path (Veo, through the AI Gateway) was removed on 2026-11-25, with the columns only it used (migration `0062_post_videos_recorder_only`). `VIDEO_GENERATION_ENABLED` in `src/lib/video/formats.ts` switches videos off.

The app makes short vertical videos for **Instagram Reels**, **YouTube Shorts** and **Facebook Reels**. Each video post is a script drafted from an idea and a video **recorded on the server** from that script: slides built in the format of the identity's own recent posts (story slides, kinetic type, meme, poster or editorial), in its Brand Theme and the look of those posts, 9:16, 1080×1920 MP4, usually 15 to 30 seconds, silent, published through Buffer like every other post.

- [How a video post is made](#how-a-video-post-is-made)
- [Recording](#recording)
- [Cost](#cost)
- [Publishing](#publishing)
- [Setup](#setup)
- [Operating it](#operating-it)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

| Where | What |
| --- | --- |
| `src/lib/video/formats.ts` | The three video formats and their spec (pure data, also used in the browser) |
| `src/lib/video/models.ts` | The provider and model names stored on each video row |
| `src/lib/video/render/` | The recorder: script → plan → brand page → recorded, encoded MP4 ([its README](../src/lib/video/render/README.md)) |
| `src/lib/video/providers/` | `recorder.ts`: loads the brand and the look, records one video at a time |
| `src/lib/video/look-source.ts` | The format and look of the identity's own recent posts, chosen once per platform |
| `src/lib/video/post-video.ts` | Starting, recording and storing a post's video; what publishing reads |
| `src/jobs/videos.ts` | `runVideoFinishing`, the background pass that records videos nobody is watching |
| `src/app/api/posts/[id]/video/route.ts` | GET (the state) and POST (Record video) for the post page |
| `src/app/api/publishing-media/video/[file]/route.ts` | Serves a ready video to Buffer |
| `src/components/video/video-panel.tsx` | The video card on the post page |
| `post_videos` (migrations `0056_post_videos`, `0062_post_videos_recorder_only`) | One row per recording |

## How a video post is made

1. **Create posts → Short video.** The reviewer picks one or more of the three platforms. `draftSelectedIdeas` (`src/app/(app)/ideas/actions.ts`) writes them to the idea's `target_formats` and to `suggested_media.videoFormats`. Video formats do not have to be turned on in Preferences.
2. **Drafting writes the script.** The video formats are not in `CREATABLE_FORMATS`, so Preferences, ideation and **Add a version** never offer them. `formatsToDraft` drafts one only when the idea's `videoFormats` names it, so an older idea that targets a Reel does not draft a video. The script (`structure: 'script'`, format version 3 for Reels and Shorts, 2 for Facebook Reels) has 3 to 6 shots, each with a line (`say`, the caption) and 2 to 6 words of `onScreenText` (the slide's headline), about 15 seconds of words in all, plus a caption, hashtags and, for a Short, a title of up to 100 characters. Version 2 scripts were for an 8-second AI clip with no overlay text. A video post gets no generated image.
3. **The video starts on its own.** Once drafting has saved the posts, `startDraftedVideos` (`src/lib/ai/pipeline/drafting-run.ts`) starts a video for each Reel and Short, in parallel. If a video cannot start (no bucket), the post is still saved and its page offers **Record video**.
4. **It is recorded in the background**: after the response that started it, or by the next page poll or job pass (see below).
5. **The reviewer can record it again** from the post page: **Record again** records the script as it is now. The current video stays until the new one is ready.

## Recording

```
generating ──► ready ──► superseded   (when a newer video is ready)
     └──────► failed
```

- **Start** (`startPostVideo`): the script is planned into cards and slides (`planVideo`, `render/plan.ts`) and the plan is stored as the row's `prompt`, so a recording that is tried again films the same thing. The row is inserted first: the partial unique index `post_videos_one_running_uq` (one `generating` row per post) is the claim, so a double click or a second tab gets `already_running`. The recording then runs **after the response** (`after()`), so the request answers at once.
- **Record** (`record` in `post-video.ts`): claims the row with a lease on `last_checked_at` (6 minutes, longer than any function runs), counts the attempt in `metadata.renderAttempts`, renders (brand theme, typefaces, logo and look loaded by `providers/recorder.ts`; one recording per process at a time), stores the MP4 under the post's prefix and marks it `ready` with its real length, superseding older ready rows in the same transaction. A page poll that finds a row not yet claimed records it in the background; so does the job pass (`runVideoFinishing`, every minute from the scheduler and on every `/api/cron/jobs` call, beside the publishing pass), which starts no recording after 140 seconds so it ends inside its function's 300.
- **On Vercel**, only `/api/posts/[id]/video` and `/api/cron/jobs` carry the browser and ffmpeg (`next.config.ts`). A recording started elsewhere, such as by drafting inside another function, finds no browser and is handed back (the lease and attempt are released) for one of those routes to pick up: the post page when it is opened, or the next cron call.
- **Gives up** after 3 started attempts, or 30 minutes; a render that fails (bad plan, the browser or ffmpeg failing) fails the row with the reason, and the page offers **Try again**.
- **Rows from before** (an AI clip, `provider` other than `recorder`) still play when ready; one still running is failed with "a video model the app no longer uses" (by migration `0062`, and by `advance` if one slips through).

Deleting a post deletes its `post_videos` rows (cascade) and its files, which sit under the post's bucket prefix.

A recording takes about 25 to 40 seconds of the function's time (about a minute in the photo look, whose zooming photos are captured every frame).

### The look

Before recording, `videoLookFor` (`src/lib/video/look-source.ts`) chooses the video's format and look; `src/lib/video/render/look.ts` holds their type and rules, `page.ts` draws them and `record.ts` plays them.

- **The format: built like their recent posts.** Two identities that post differently get differently built videos, not one layout in other colours. The skill picks one of five structures (`VIDEO_FORMATS`; `formatRhythm` says how each plays):

  | Format | For feeds of | How it plays |
  | --- | --- | --- |
  | `slides` | carousels, tips, lists, explainers; and anyone nothing is known about | title cards, numbered slides under story bars, caption badge, fades (the videos of before) |
  | `kinetic` | punchy one-liners, bold text graphics, hype | no cards: a few huge centred words pop in one by one, slides alternate colours, hard cuts |
  | `meme` | memes, trend riffs, relatable jokes | a band of casual text on top, one of their photos filling the rest, hard cuts; needs a photo (else kinetic) |
  | `poster` | branded graphics, offers, hiring, events, infographics | each slide a designed graphic: framed photo of theirs when there is one, pill tag, body line, contact bar with the footer; pushed in, hard cuts |
  | `editorial` | quotes, reflections, premium brands | centred quieter words between thin rules, caption under them, slow fades |

  Key words stand out where their images mark words (`highlight`: a `marker` box or the accent `color`, picked by `emphasisOf`: numbers, else the closing words). Their photos too small to fill a frame are shown whole over a blurred copy of themselves.

- **Brand Theme first.** Its set colours (primary, accent, background), typefaces, logo, footer and, once saved, background pattern (Auto leaves it to the look) are used as they are. Its image style picks the template where a video has one to match (`brandedLook`): Minimal Graphic Design → minimal; Photorealistic → photo when there are photos; Like my posts, Illustration and 3D → the look's own.
- **The rest from their posts.** The `video_look` skill (`src/lib/ai/skills/video-look`, Sonnet at low effort, vision) reads the profile analysis (`platform_insights`: summary, visual identity, formats, tone, captions), up to 15 of the recent posts that analysis read (`platform_insights.posts`: kind, date, shape and opening words, newest first) and up to 6 example images (`visual_examples`, via `loadLookExamples`) and returns a format, a template (`cards`, `bold`, `minimal`, `photo`: the colours), colours, text case, caption style (badge or subtitles, for slides), pace, highlight and which images are photos to show. `cleanVideoLook` keeps only usable values, and the theme makes every pairing readable.
- **Whose posts.** The video's platform; else Instagram ↔ Facebook; a YouTube Short reads Instagram, then Facebook (`scriptInsightsSource`). The look alone may also read any other analyzed platform's visual identity, since a brand looks alike everywhere (`lookInsightsSource`).
- **Once, then reused.** The look is stored in the video's metadata (`look`, `lookStamp`, `lookFrom`, `template`, `format`). The stamp hashes the analysis, its posts, the example images, the brand colours and the platform (version 2 since formats came in, so every identity's next video chooses afresh); a later video with the same stamp takes the look from there (or from memory in the same process) without a model call. About $0.01 per call, recorded in `ai_usage` (stage `video_look`) against the post.
- **Never fails a video.** No analysis and no images, no AI key, a spending limit or a model error: the default look, with a warning in the metadata.
- **The script follows too.** For video formats, `renderInsightsForVideo` (`src/lib/profile-insights/render.ts`) gives the writer the same analysis, including how their posts look and what they post, so on-screen words are set the way their posts set words. Prompts for other formats, and for identities with nothing learned, are unchanged.

## Cost

- **Recording costs nothing**: no model makes the video, and spending limits don't stop it.
- **Matching the look of their posts** is one `video_look` model call (about $0.01) the first time per platform, recorded in `ai_usage` against the post, so it shows on the post's cost card ([POST_COST.md](POST_COST.md)). Later videos reuse the look (see [The look](#the-look)).

## Publishing

`instagram.reel`, `facebook.reel` and `youtube.short` are in `PUBLISHABLE_FORMATS` (`src/lib/publishing/platform.ts`), and YouTube is a Buffer network (Shorts only). A video post goes out as its caption and hashtags (`videoCaptionText`), with its newest ready video as the one asset; the script is what the video says.

| Network | Buffer `metadata` | Largest video |
| --- | --- | --- |
| Instagram | `{ instagram: { type: 'reel', shouldShareToFeed: true, isAiGenerated: true } }` | 300 MB |
| Facebook | `{ facebook: { type: 'reel', firstComment } }` | 1 GB |
| YouTube | `{ youtube: { title, categoryId: '22', madeForKids: false, isAiGenerated: true } }` | 1 GB |

A Short's title is the script's title, or else its opening line, cut to 100 characters.

Reels and Shorts are still sent with `isAiGenerated: true`, as when every video was an AI clip. A recorded video is text slides whose words an AI drafted, not AI-generated footage; whether to keep the label is a product decision, made in `src/lib/publishing/buffer/provider.ts`.

**Buffer downloads the video from the app, not from the bucket.** The asset URL is `/api/publishing-media/video/<token>.mp4` on `PUBLISHING_MEDIA_URL` (or `BETTER_AUTH_URL`), signed with the same media token as images. Its subject has a `video_` prefix, so an image token never opens a video and a video token never opens an image. The route answers `HEAD` from the database and streams `GET` from the bucket, byte ranges included. A presigned bucket URL does not work: it is signed for GET only, Buffer's HEAD gets 403, and Buffer refuses with "Video could not be read from its URL".

Checks before sending:

- **Queueing** (`requestPublication`) refuses a video post with no ready video: "This Instagram Reel has no video yet. Record its video on the post, then publish it."
- **Publishing** checks again, and also refuses a video over the network's limit.
- **Auto-publishing** skips video posts until their video is ready.

**Not yet verified against live Buffer:** the video publish itself, the YouTube service name `youtube`, the metadata enum casing, and whether streaming a ~7 MB clip through a Vercel function stays within its response limits. A local publish can't test it: the local bucket is private and Buffer can't reach localhost. Try it on a deployed instance with test accounts before relying on it.

## Setup

1. **Environment**
   - Recording needs no key. It needs a browser and ffmpeg, which install with the dependencies; `CHROMIUM_PATH` and `FFMPEG_PATH` override them (see [the recorder's README](../src/lib/video/render/README.md#requirements)). Vercel needs Node.js 22.17 or later.
   - `AI_GATEWAY_API_KEY`: for drafting the scripts, as for every post, and for matching the look of their posts (without it, videos use the default look).
   - `STORAGE_BUCKET` (and the bucket credentials images already use): required. Videos are never kept inline, so without a bucket the app says videos can't be made.
   - `VIDEO_MODEL` is no longer read; remove it where it is set.
   - `YOUTUBE_PUBLISHING`: `buffer` (the default) or `off`. When on, YouTube appears as a connectable network on Settings → Integrations. Consider `off` in production until a Short has been published end to end.
   - `PUBLISHING_MEDIA_URL` or `BETTER_AUTH_URL` must be reachable from the internet, as for images.
2. **Database**: apply `0056_post_videos` (the `post_videos` table), `0057_ai_usage_draft` (per-post cost) and `0062_post_videos_recorder_only` (drops the AI-clip columns) **before deploying this code**: without `0062`, starting a video fails on the old `estimated_cost_usd` column. The build does not migrate. All three migrations are idempotent.
   ```bash
   npm run db:migrate
   ```
3. **The worker**: with a long-running server, nothing more. On Vercel, timers don't run and the Hobby cron in `vercel.json` fires once a day. So a video nobody watches is stored only when someone opens its post, or on the next `/api/cron/jobs` call. Point an external pinger at it every few minutes, as [PUBLISHING.md](PUBLISHING.md#4-the-worker) suggests.

## Operating it

- **Videos running or stuck**:
  ```sql
  SELECT id, draft_id, status, model_id, created_at, last_checked_at, error
  FROM post_videos WHERE status = 'generating' ORDER BY created_at;
  ```
- **Recent failures**: `SELECT id, draft_id, error, completed_at FROM post_videos WHERE status = 'failed' ORDER BY completed_at DESC LIMIT 20;`
- **Spend on video looks**: `SELECT date_trunc('day', created_at) AS day, count(*), sum(cost_usd) FROM ai_usage WHERE stage = 'video_look' GROUP BY 1 ORDER BY 1 DESC;`
- To give up a video stuck in `generating`, set it to `failed`; the reviewer can then record it again.
- The media route logs each HEAD and GET Buffer makes (`Video <id>: HEAD from …`), which shows whether Buffer reached it.

## Tests

| Test | Needs | Covers |
| --- | --- | --- |
| `tests/video.test.ts` | nothing | the video spec, video formats never created another way, the script asking for slides, the recorder's plan (cards, slides, captions, timing, stored plan read back) and page (contrast, no markup from text, embedded fonts), the look (Brand Theme first, nearest platform, readable colours, pace), the formats (a page of its own each, cards or cuts, framed photos, readable alternating colours, highlighted words, recent posts shown to the skill as data), which ideas draft a video, no generated image on a video post |
| `tests/multi-platform.test.ts` → "short videos" | nothing | the script schema, the caption that goes out with the video, the Short's title rule, no URLs in a caption |
| `tests/publishing-units.test.ts` | nothing | video media tokens and links, each network's video metadata |
| `tests/publishing.test.ts` → M3, M3b | `DATABASE_URL` | a Reel without its video is refused (an image is no stand-in); a Reel with its video goes out as a Reel with the video from its link |

Buffer can't run in CI. A recording runs locally with `pnpm video:sample` and is checked with `pnpm video:check` (no database, no cost).

## Troubleshooting

- **"Videos are kept in object storage; set STORAGE_BUCKET to make them."**: no bucket is configured.
- **"Buffer cannot download this post's images or video from …, which only this computer can reach"**: set `PUBLISHING_MEDIA_URL` to a public address (locally, a tunnel).
- **"Video could not be read from its URL"** from Buffer: check that `HEAD` on the `/api/publishing-media/video/….mp4` link answers 200 with `Content-Length`, and look for the route's log lines. Nothing was posted, so **Try again** is safe.
- **"The video could not be recorded: No browser was found…"** or **"…ffmpeg was not found…"**: locally, install a browser or set `CHROMIUM_PATH`/`FFMPEG_PATH`; on Vercel, check that the build included `node_modules/@sparticuz/chromium/bin` and `node_modules/ffmpeg-static/ffmpeg` for the route (see the recorder's README).
- **A recording stays "Recording" on Vercel**: it was started outside the recording routes and is waiting for one; open the post, or call `/api/cron/jobs`.
- **A video stays "Recording" for a long time**: check the row's `last_checked_at`. If it is not moving, nothing is recording it: no page is open and the worker or cron is not running.
- **"…column "estimated_cost_usd" … violates not-null constraint"** when starting a video: migration `0062` has not been applied to this database.
