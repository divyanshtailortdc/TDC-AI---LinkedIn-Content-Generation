# Publishing to Facebook and Instagram (through Buffer)

Facebook and Instagram posts are published the same way as X posts: through the customer's own Buffer account, with the same Buffer app client. Read [PUBLISHING_X.md](PUBLISHING_X.md) first. It covers why the app uses Buffer, the connect flow, tokens, the confirmation worker, error handling and limits, and all of that applies here unchanged. This page covers only what is different.

- [What can be published](#what-can-be-published)
- [What is sent to Buffer](#what-is-sent-to-buffer)
- [Images](#images)
- [Setup](#setup)
- [Trying it end to end](#trying-it-end-to-end)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

## What can be published

| Platform | What Buffer can connect | Format published | Formats copied by hand |
| --- | --- | --- | --- |
| Facebook | A **Facebook Page** | `facebook.post` | none |
| Instagram | An Instagram **business or creator** account (Buffer cannot connect personal accounts) | `instagram.caption`, shown as **Instagram post**: a picture with its caption | `instagram.reel` (posts have no video) |

This is set in `PUBLISHABLE_FORMATS` in `src/lib/publishing/platform.ts`. Each platform has its own connection (one row per identity and platform in `linkedin_connections`), its own Buffer authorization, its own auto-publishing time, and its own **Change account** for picking another Page or Instagram account in the same Buffer account. Disconnecting one leaves the others alone.

## What is sent to Buffer

Both use `createPost` with `mode: shareNow`, like X. Each network has its own `metadata`:

| Platform | `metadata` | First comment field |
| --- | --- | --- |
| Facebook | `{ facebook: { type: "post", firstComment } }` | **Published** as the first comment, inside the same Buffer post (`commentInPost`), so there is no second request |
| Instagram | `{ instagram: { type: "post", shouldShareToFeed: true } }` | **Never published.** For an Instagram post this field is the "Link-in-bio note", a reminder for the author and not a comment |

The text is exactly what Copy gives. Length is checked before Buffer is called: 2,200 characters for an Instagram caption (Instagram's limit) and 63,206 for Facebook (Facebook's limit; drafting aims far shorter).

Delete from the platform is not offered, because Buffer's API cannot remove a published post. As with X, the user deletes it on Facebook or Instagram.

## Images

Buffer downloads the image from the same signed link X uses (`/api/publishing-media/<token>`). The link adds `?for=facebook` or `?for=instagram`, and `src/lib/publishing/buffer/image-variant.ts` re-encodes the image for that network:

| Platform | Image required? | What is served |
| --- | --- | --- |
| Facebook | No | The image unchanged, except WebP, which becomes JPEG. Up to 10 MB |
| Instagram | **Yes** | Always JPEG, at most 1440 px wide, **padded** with white into Instagram's 4:5 to 1.91:1 range. Padding means nothing is cropped. The app's own 2048×1072 images already fit once resized |

Drafting makes each Instagram post's picture, as it does for a LinkedIn post, even for creator identities. An Instagram post without an image is refused when it is queued (`needs_image`). If its image is removed after it was scheduled, it fails before Buffer is called. Auto-publishing skips Instagram posts that have no image.

The variant is not part of the signature. It only changes how the one image the token opens is encoded.

## Setup

This uses the Buffer app client and `TOKEN_ENCRYPTION_KEY` already set up for X ([PUBLISHING_X.md → Setup](PUBLISHING_X.md#setup)). There is no new secret and no migration.

1. **Register the two extra redirect URIs** on the Buffer app client (Buffer → Settings → API → App Clients), exactly, for each environment:
   - `https://<your-domain>/api/integrations/facebook/callback`
   - `https://<your-domain>/api/integrations/instagram/callback`
   - local: the same paths on `https://localhost:3000`

   These callbacks use the origin of `BUFFER_REDIRECT_URI` when that is set, otherwise `BETTER_AUTH_URL`.
2. **Environment** (optional). Facebook and Instagram are on whenever Buffer publishing is set up. To hide one:
   ```bash
   FACEBOOK_PUBLISHING="off"
   INSTAGRAM_PUBLISHING="off"
   ```
3. **Each customer**, once per platform:
   1. In Buffer, connect the Facebook Page, or the Instagram business or creator account, as a channel. Buffer's free plan allows 3 channels in total, X included.
   2. In the app, go to **Settings → Integrations → Facebook (or Instagram) → Connect**, and allow TDC AI on Buffer's screen.

Without `BUFFER_CLIENT_ID`, each card asks for a Buffer API key instead (testing), as X does.

Buffer downloads images from `PUBLISHING_MEDIA_URL`, or from `BETTER_AUTH_URL` when that is unset, so the address must be reachable from the internet. For Instagram this always matters, because every Instagram post has an image. Locally, point `PUBLISHING_MEDIA_URL` at a tunnel ([PUBLISHING_X.md → Local development](PUBLISHING_X.md#local-development)). Without one, the app refuses image posts before calling Buffer and says what to set.

## Trying it end to end

1. Settings → Integrations → **Connect Facebook**, allow TDC AI, and check the card shows the Page's name. Do the same for Instagram.
2. Write a Facebook post for an idea (Identity → Preferences → turn the Facebook format on, then **Add a version**), with a link in the first comment. Approve it, then **Publish now**. It should show "Published on Facebook" with **View post**, and the comment should appear under the post.
3. Create an **Instagram post** from an idea. Drafting makes its picture, from the post's own picture idea. Remove the picture and **Publish now** is refused with "Instagram posts need an image". Put one back, publish again, and check the post on Instagram. The link-in-bio note should not appear anywhere.
4. Disconnect Instagram and check that scheduled Facebook and X posts are still scheduled.

Use test Pages and accounts, because the posts are public.

## Tests

| Test | Covers |
| --- | --- |
| `tests/publishing-units.test.ts` → "Facebook and Instagram through Buffer" | Instagram padding and JPEG output, Facebook WebP to JPEG, the `?for=` link, channels listed per network, network names in Buffer's errors, each network's `metadata` |
| `tests/publishing.test.ts` → "Facebook and Instagram through Buffer" (needs `DATABASE_URL`) | M1–M5: a Facebook post with its first comment in one Buffer post; an Instagram caption refused without an image, then published as a feed post with the note kept back; an image removed after queueing; Reels refused; auto-publishing skipping Instagram posts without an image; separate connections per network |

Buffer, Facebook and Instagram themselves cannot run in CI. Check them by hand with test accounts, as above.

## Troubleshooting

- **"No Instagram account is connected in this Buffer account"**: the Instagram account is not a channel in Buffer, or it is a personal account. Switch it to a business or creator account in Instagram, then connect it in Buffer.
- **"Instagram posts need an image"**: add an image to the post. Instagram does not take text-only posts.
- **Buffer says the redirect URI is invalid** when connecting Facebook or Instagram: register `/api/integrations/facebook/callback` and `/api/integrations/instagram/callback` on the app client (see [Setup](#setup)).
- **"Image could not be read from its URL"**: Buffer could not download the picture. Locally, set `PUBLISHING_MEDIA_URL` to a tunnel and restart. In production, check that `BETTER_AUTH_URL` is publicly reachable and that `/api/publishing-media/…?for=instagram` returns a JPEG. Nothing was posted, so **Try again** is safe.
- **Connecting a second platform logged out the first** (the first connection shows Expired): this would mean Buffer revokes an earlier authorization when the same app client is authorized again. Buffer's documentation does not say either way, and each platform keeps its own grant. If it happens, report it; the fix would be to share one Buffer grant across the three platforms.
