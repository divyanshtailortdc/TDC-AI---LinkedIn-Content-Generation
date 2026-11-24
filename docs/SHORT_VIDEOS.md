# Short videos (Reels and Shorts)

> **On again since 2026-11-24, recorded rather than AI-generated.** Videos are made with the [product-video](../.claude/skills/product-video/SKILL.md) skill's method by default (`VIDEO_MODEL` unset): see [Recording](#recording-the-default) and [src/lib/video/render/README.md](../src/lib/video/render/README.md). The Veo path below still works when `VIDEO_MODEL` names a Veo model. `VIDEO_GENERATION_ENABLED` in `src/lib/video/formats.ts` switches all of it off again.

The app makes short vertical videos for **Instagram Reels**, **YouTube Shorts** and **Facebook Reels**. Each video post is a script drafted from an idea and a video made from that script, 9:16, 1080×1920 MP4, published through Buffer like every other post. By default the video is **recorded on the server**: the script as title cards and slides in the identity's Brand Theme, usually 15 to 30 seconds, silent, at no cost. With `VIDEO_MODEL` set to a Veo model it is instead one AI-generated 8-second clip with a voiceover, through the Vercel AI Gateway.

- [How a video post is made](#how-a-video-post-is-made)
- [Recording (the default)](#recording-the-default)
- [AI clips: start, then check](#ai-clips-start-then-check)
- [Cost](#cost)
- [Models](#models)  
- [Publishing](#publishing)
- [Setup](#setup)
- [Operating it](#operating-it)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

| Where | What |
| --- | --- |
| `src/lib/video/formats.ts` | The three video formats and their spec (pure data, also used in the browser) |
| `src/lib/video/models.ts` | The recorder and the AI video models, their per-second prices and `VIDEO_MODEL` |
| `src/lib/video/render/` | The recorder: script → plan → brand page → recorded, encoded MP4 ([its README](../src/lib/video/render/README.md)) |
| `src/lib/video/prompt.ts` | The prompt sent to an AI video model, built from the script (Veo only) |
| `src/lib/video/providers/` | `VideoProvider`: local (`recorder.ts`, render) or remote (`gateway.ts`, start and check) |
| `src/lib/video/post-video.ts` | Starting, advancing and storing a post's video; what publishing reads |
| `src/jobs/videos.ts` | `runVideoFinishing`, the background pass that finishes videos nobody is watching |
| `src/app/api/posts/[id]/video/route.ts` | GET (the state, moving a running video on) and POST (start one) for the post page |
| `src/app/api/video/estimate/route.ts` | The cost of one video, for Create posts |
| `src/app/api/publishing-media/video/[file]/route.ts` | Serves a ready video to Buffer |
| `src/components/video/video-panel.tsx` | The video card on the post page |
| `post_videos` (migration `0056_post_videos`) | One row per generation |

## How a video post is made

1. **Create posts → Short video.** The reviewer picks one or more of the three platforms. `draftSelectedIdeas` (`src/app/(app)/ideas/actions.ts`) writes them to the idea's `target_formats` and to `suggested_media.videoFormats`. Video formats do not have to be turned on in Preferences.
2. **Drafting writes the script.** The video formats are not in `CREATABLE_FORMATS`, so Preferences, ideation and **Add a version** never offer them. `formatsToDraft` drafts one only when the idea's `videoFormats` names it, so an older idea that targets a Reel does not draft a video. The script (`structure: 'script'`, format version 3 for Reels and Shorts, 2 for Facebook Reels) has 3 to 6 shots, each with a line (`say`, the caption) and 2 to 6 words of `onScreenText` (the slide's headline), about 15 seconds of words in all, plus a caption, hashtags and, for a Short, a title of up to 100 characters. Version 2 scripts were for an 8-second AI clip with no overlay text. A video post gets no generated image.
3. **The video starts on its own.** Once drafting has saved the posts, `startDraftedVideos` (`src/lib/ai/pipeline/drafting-run.ts`) starts a video for each Reel and Short, in parallel, with no confirmed estimate. If a video cannot start (a spending limit for an AI clip, no provider, no bucket), the post is still saved and its page offers **Record video** (or **Generate video**).
4. **It finishes in the background.** A recording is made after the response that started it, or by the next page poll or job pass; an AI clip is stored by whichever gets there first (see below).
5. **The reviewer can make it again** from the post page: **Record again** records the script as it is now; with an AI model, **Regenerate video** takes an optional direction of up to 500 characters after the estimated cost is confirmed. The current video stays until the new one is ready.

## Recording (the default)

`VIDEO_MODEL` unset (or `product-video/recorder`) selects the `recorder` provider, a `LocalVideoProvider`: it has `render` instead of `start` and `check`.

- **Start** (`startPostVideo`): the script is planned into cards and slides (`planVideo`, `render/plan.ts`) and the plan is stored as the row's `prompt`, so a recording that is tried again films the same thing. The row is the claim, as for AI clips. No spending limit applies (it costs nothing), and no direction is taken. The recording then runs **after the response** (`after()`), so the request answers at once.
- **Record** (`record` in `post-video.ts`): claims the row with a lease on `last_checked_at` (6 minutes, longer than any function runs), counts the attempt in `metadata.renderAttempts`, renders (brand theme, typefaces and logo loaded by `providers/recorder.ts`; one recording per process at a time), stores the MP4 under the post's prefix and marks it `ready` with its real length and `cost_usd` 0. A page poll that finds a row not yet claimed records it in the background; so does the job pass, which starts no recording after 140 seconds so it ends inside its function's 300.
- **On Vercel**, only `/api/posts/[id]/video` and `/api/cron/jobs` carry the browser and ffmpeg (`next.config.ts`). A recording started elsewhere, such as by drafting inside another function, finds no browser and is handed back (the lease and attempt are released) for one of those routes to pick up: the post page when it is opened, or the next cron call.
- **Gives up** after 3 started attempts, or 30 minutes; a render that fails (bad plan, the browser or ffmpeg failing) fails the row with the reason, and the page offers **Try again**.

A recording takes about 25 to 40 seconds of the function's time.

## AI clips: start, then check

A clip takes 1 to 3 minutes, longer than a serverless request should run. So generation is split into short steps, and the state lives in `post_videos`:

```
generating ──► finishing ──► ready ──► superseded   (when a newer video is ready)
     │              │
     └──────────────┴──► failed
```

- **Start** (`startPostVideo`): the row is inserted *before* the provider is called. The partial unique index `post_videos_one_running_uq` (one `generating` or `finishing` row per post) is the claim, so a double click or a second tab gets `already_running` and is never billed twice. The provider's `operation` is then saved on the row. The provider call has `maxRetries: 0`, because a retried start could bill a second clip.
- **Advance** (`advance`): called by `GET /api/posts/[id]/video`, which the panel polls every 5 seconds while a video runs, and by `finishPendingVideos` (up to 20 per pass). A check first claims `last_checked_at`, so the provider is asked at most every 4 seconds however many pages poll. When the provider reports done, one caller moves the row to `finishing`, downloads the clip, uploads it to the bucket under the post's prefix (`storeDraftFile`), and marks it `ready`, superseding older ready rows in the same transaction.
- **Background pass** (`runVideoFinishing`): every minute from the scheduler (`APP_ROLE` `all` or `worker`), and on every call to `/api/cron/jobs`. It runs side by side with the publishing pass, never ahead of it, so a stuck video can't hold up publishing. A pass still running is joined, not doubled.

Timeouts:

| What | After | Then |
| --- | --- | --- |
| The Gateway start call | 90 s | The start fails and the row is marked failed |
| A Gateway status call | 30 s | Logged; checked again on the next poll or pass |
| Downloading the finished clip | 60 s, or over 200 MB | Counts as a failed save |
| A row with no `operation` (its start died) | 2 min | `failed` |
| A row stuck in `finishing` (its caller died) | 3 min | Back to `generating`, so another caller stores it |
| A clip the provider still calls pending | 30 min | `failed`, but only after asking the provider, so a clip that finished while nobody looked is kept |
| Storing the clip | 3 attempts | `failed` |

Deleting a post deletes its `post_videos` rows (cascade) and its files, which sit under the post's bucket prefix.

## Cost

- **A recording costs nothing.** Its estimate is $0, the page starts it without a confirm step, it records no `ai_usage` row, and spending limits don't stop it. Create posts says so instead of a price.
- **An AI clip's estimate comes first.** `estimateVideoCostUsd` prices the clip from `models.ts` (seconds × the per-second rate at 1080p with audio): **$0.64** with Veo 3.1 Lite and $0.96 with Veo 3.1 Fast. Create posts shows it (`GET /api/video/estimate`), and so does the post page before **Generate**. A reviewer's request carries the estimate they saw. If it no longer matches, the server answers 409 with the new figure and starts nothing.
- **Limits are checked before starting** (`assertWithinAiSpendLimit`). The cost is recorded when the clip lands: one `ai_usage` row with stage `video`, source `posts`, tagged with the post's `draft_id`, so it shows under **Post editing** on the dashboard and on the post's own cost card ([POST_COST.md](POST_COST.md)). Videos already running when a limit is reached still finish.
- **The Gateway reports no billed cost for Veo** (`providerMetadata.gateway.cost` is null), so the recorded cost is the estimate, with `costSource: 'estimate'` in the row's metadata. If the Gateway starts reporting a cost, that is recorded instead.

## Models

| `VIDEO_MODEL` | Label | 1080p with audio | Notes |
| --- | --- | --- | --- |
| unset, or `product-video/recorder` | Product video recorder | free | The default: recorded on the server, silent |
| `google/veo-3.1-lite-generate-001` | Veo 3.1 Lite | $0.08/s, so $0.64 per clip | |
| `google/veo-3.1-fast-generate-001` | Veo 3.1 Fast | $0.12/s, so $0.96 per clip | |

The prices come from Google's published Vertex AI rates, checked 2026-11-19; the Gateway's model list prices video at "0". A `VIDEO_MODEL` that is not listed in `models.ts` disables videos with a message, rather than generating at an unknown price. To add a model, add its entry (id, label, durations, prices, `resolutionParam`) to `VIDEO_MODELS`; a model from a provider other than the Gateway also needs a `VideoProvider` in `src/lib/video/providers/`.

Two things learnt from live runs:

- **Veo names a resolution by its landscape size.** Send `'1920x1080'` with `aspectRatio: '9:16'` to get a 1080×1920 portrait clip; `'1080x1920'` is rejected with "Invalid resolution". `resolutionParam` maps each tier per model.
- **Never say "framed for a phone" in the prompt.** Veo then drew a phone bezel around the footage. The prompt says the picture fills the whole vertical frame and bans device mockups.

## Publishing

`instagram.reel`, `facebook.reel` and `youtube.short` are in `PUBLISHABLE_FORMATS` (`src/lib/publishing/platform.ts`), and YouTube is a Buffer network (Shorts only). A video post goes out as its caption and hashtags (`videoCaptionText`), with its newest ready video as the one asset; the script is what the video says.

| Network | Buffer `metadata` | Largest video |
| --- | --- | --- |
| Instagram | `{ instagram: { type: 'reel', shouldShareToFeed: true, isAiGenerated: true } }` | 300 MB |
| Facebook | `{ facebook: { type: 'reel', firstComment } }` | 1 GB |
| YouTube | `{ youtube: { title, categoryId: '22', madeForKids: false, isAiGenerated: true } }` | 1 GB |

A Short's title is the script's title, or else its opening line, cut to 100 characters.

Reels and Shorts are still sent with `isAiGenerated: true`, as when every video was a Veo clip. A recorded video is text slides whose words an AI drafted, not AI-generated footage; whether to keep the label is a product decision, made in `src/lib/publishing/buffer/provider.ts`.

**Buffer downloads the video from the app, not from the bucket.** The asset URL is `/api/publishing-media/video/<token>.mp4` on `PUBLISHING_MEDIA_URL` (or `BETTER_AUTH_URL`), signed with the same media token as images. Its subject has a `video_` prefix, so an image token never opens a video and a video token never opens an image. The route answers `HEAD` from the database and streams `GET` from the bucket, byte ranges included. A presigned bucket URL does not work: it is signed for GET only, Buffer's HEAD gets 403, and Buffer refuses with "Video could not be read from its URL".

Checks before sending:

- **Queueing** (`requestPublication`) refuses a video post with no ready video: "This Instagram Reel has no video yet. Generate its video on the post, then publish it."
- **Publishing** checks again, and also refuses a video over the network's limit.
- **Auto-publishing** skips video posts until their video is ready.

**Not yet verified against live Buffer:** the video publish itself, the YouTube service name `youtube`, the metadata enum casing, and whether streaming a ~7 MB clip through a Vercel function stays within its response limits. A local publish can't test it: the local bucket is private and Buffer can't reach localhost. Try it on a deployed instance with test accounts before relying on it.

## Setup

1. **Environment**
   - Recording needs no key. It needs a browser and ffmpeg, which install with the dependencies; `CHROMIUM_PATH` and `FFMPEG_PATH` override them (see [the recorder's README](../src/lib/video/render/README.md#requirements)). Vercel needs Node.js 22.17 or later.
   - `AI_GATEWAY_API_KEY`: required for AI clips only (and for drafting the scripts, as for every post).
   - `STORAGE_BUCKET` (and the bucket credentials images already use): required. Videos are never kept inline, so without a bucket the app says videos can't be made.
   - `VIDEO_MODEL`: optional, see [Models](#models).
   - `YOUTUBE_PUBLISHING`: `buffer` (the default) or `off`. When on, YouTube appears as a connectable network on Settings → Integrations. Consider `off` in production until a Short has been published end to end.
   - `PUBLISHING_MEDIA_URL` or `BETTER_AUTH_URL` must be reachable from the internet, as for images.
2. **Database**: apply `0056_post_videos` (the `post_videos` table) and `0057_ai_usage_draft` (per-post cost) **before deploying this code**. The build does not migrate. Both migrations are idempotent.
   ```bash
   npm run db:migrate
   ```
3. **The worker**: with a long-running server, nothing more. On Vercel, timers don't run and the Hobby cron in `vercel.json` fires once a day. So a video nobody watches is stored only when someone opens its post, or on the next `/api/cron/jobs` call. Point an external pinger at it every few minutes, as [PUBLISHING.md](PUBLISHING.md#4-the-worker) suggests.

## Operating it

- **Videos running or stuck**:
  ```sql
  SELECT id, draft_id, status, model_id, created_at, last_checked_at, error
  FROM post_videos WHERE status IN ('generating', 'finishing') ORDER BY created_at;
  ```
- **Recent failures**: `SELECT id, draft_id, error, completed_at FROM post_videos WHERE status = 'failed' ORDER BY completed_at DESC LIMIT 20;`
- **Spend on videos**: `SELECT date_trunc('day', created_at) AS day, count(*), sum(cost_usd) FROM ai_usage WHERE stage = 'video' GROUP BY 1 ORDER BY 1 DESC;`
- Don't move a row out of `generating` by hand while its provider job may still finish: the 30-minute timeout asks the provider first. To give one up, set it to `failed`; the reviewer can then generate again.
- The media route logs each HEAD and GET Buffer makes (`Video <id>: HEAD from …`), which shows whether Buffer reached it.

## Tests

| Test | Needs | Covers |
| --- | --- | --- |
| `tests/video.test.ts` | nothing | the video spec, video formats never created another way, the script asking for slides, the recorder as the free default and Veo prices, the recorder's plan (cards, slides, captions, timing, stored plan read back) and page (contrast, no markup from text, embedded fonts), the Veo prompt, which ideas draft a video, no generated image on a video post |
| `tests/multi-platform.test.ts` → "short videos" | nothing | the script schema, the caption that goes out with the video, the Short's title rule, no URLs in a caption |
| `tests/publishing-units.test.ts` | nothing | video media tokens and links, each network's video metadata |
| `tests/publishing.test.ts` → M3, M3b | `DATABASE_URL` | a Reel without its video is refused (an image is no stand-in); a Reel with its video goes out as a Reel with the video from its link |

The real Gateway and Buffer can't run in CI. A live generation costs real money (about $0.64 with Lite). A recording runs locally with `pnpm video:sample` and is checked with `pnpm video:check` (no database, no cost).

## Troubleshooting

- **"Invalid resolution"** from the Gateway: a model's `resolutionParam` is in portrait order. Use the landscape label (see [Models](#models)).
- **"VIDEO_MODEL "…" has no price on record"**: the model is not in `models.ts`. Add it, or unset `VIDEO_MODEL`.
- **"Videos are kept in object storage; set STORAGE_BUCKET to make them."**: no bucket is configured.
- **"Buffer cannot download this post's images or video from …, which only this computer can reach"**: set `PUBLISHING_MEDIA_URL` to a public address (locally, a tunnel).
- **"Video could not be read from its URL"** from Buffer: check that `HEAD` on the `/api/publishing-media/video/….mp4` link answers 200 with `Content-Length`, and look for the route's log lines. Nothing was posted, so **Try again** is safe.
- **"The video could not be recorded: No browser was found…"** or **"…ffmpeg was not found…"**: locally, install a browser or set `CHROMIUM_PATH`/`FFMPEG_PATH`; on Vercel, check that the build included `node_modules/@sparticuz/chromium/bin` and `node_modules/ffmpeg-static/ffmpeg` for the route (see the recorder's README).
- **A recording stays "Recording" on Vercel**: it was started outside the recording routes and is waiting for one; open the post, or call `/api/cron/jobs`.
- **A video stays "Generating" for a long time**: check the row's `last_checked_at`. If it is not moving, nothing is advancing it: no page is open and the worker or cron is not running.
