# Publishing to X (through Buffer)

How approved X posts are published, and how to set it up. The generic parts (states, retries, duplicates, security, the worker) are in [PUBLISHING.md](PUBLISHING.md); this page covers only what is different for X.

- [Why Buffer](#why-buffer)
- [How it works](#how-it-works)
- [Limits](#limits)
- [Setup](#setup)
- [Trying it end to end](#trying-it-end-to-end)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

## Why Buffer

The app does not call the X API, and it does not go through Zapier:

- **Zapier has no working X integration.** Zapier dropped it on 31 Aug 2023, brought it back in Feb 2026 (each user had to bring their own X developer app), and removed it again on 4 Mar 2026 because X said the use case is not allowed under its developer program. Zapier itself points users to Buffer.
- **Buffer posts to X on every plan, the free one included**, and has a public GraphQL API (since May 2026) with one API key on the free plan.
- **No X developer app or X API costs.** Each customer connects their X account inside their own Buffer account and authorizes TDC AI on Buffer's consent screen (a Buffer **app client**, OAuth with PKCE). The app keeps only that customer's Buffer tokens, encrypted.

So for X, the "connection" is the customer's Buffer authorization plus the Buffer channel of their X account. Without an app client set up, each user can paste a personal Buffer API key instead (meant for testing). LinkedIn is unchanged: it still uses its own OAuth flow and REST API.

## How it works

| Piece | File |
| --- | --- |
| X's formats (`x.post`, `x.thread`), limits and X's weighted length | `src/lib/formats/registry.ts`, `src/lib/formats/count.ts` |
| Buffer's GraphQL calls (list X channels, create a post, read a post) and error classification | `src/lib/publishing/buffer/api.ts` |
| X as a publishing provider | `src/lib/publishing/buffer/provider.ts` |
| Provider lookup by platform (LinkedIn, X) | `src/lib/publishing/provider.ts` |
| Signed image links Buffer fetches | `src/lib/publishing/media-token.ts`, `src/app/api/publishing-media/[token]/route.ts` |
| Waiting for Buffer to confirm (`confirmPendingPublications`) | `src/lib/publishing/engine.ts` |
| Buffer OAuth (authorization URL with PKCE, code exchange, refresh) | `src/lib/publishing/buffer/oauth.ts`, `src/lib/publishing/oauth-state.ts` |
| Connect and callback routes (shared with LinkedIn) | `src/app/api/integrations/[platform]/connect/route.ts`, `callback/route.ts` |
| Refreshing under a row lock (single-use refresh tokens) | `usableAccessToken` in `src/lib/publishing/connection.ts` |
| Changing the X account, or connecting with a key (testing) | `src/app/(app)/settings/integrations/actions.ts` (`switchXAccount`, `connectXWithBuffer`), `buffer-connect-form.tsx` |
| Database: `platform` on `linkedin_connections` and `linkedin_publications` | migration `0041_x_publishing.sql` |

### Writing posts for X

X posts are written by the multi-platform content engine (`src/lib/formats`): turn X on under the identity's formats (Identity → Preferences), then pick it when creating posts from ideas, or use **Add a version** on any post of an idea (in review, approved or already posted) to write the same idea for X. Each post has a format (`post_drafts.format_id`); an X post is its own `post_drafts` row with `platform = 'x'`, reviewed, approved, planned and published like a LinkedIn post.

**Both X formats are published through Buffer** (`PUBLISHABLE_FORMATS` in `src/lib/publishing/platform.ts`):

| Format | What goes out |
|---|---|
| `x.post` | One post; its **Reply** (`post_drafts.first_comment`, where X posts keep their link) goes out as a reply under it |
| `x.thread` | Every post of the thread in order (stored in `hook` and `body`, split on `---` lines; hashtags on the last), each a reply to the one before, then the Reply |

Both go out in **one** Buffer post: `createPost` with `metadata.twitter.thread` holding every post, the first included (Buffer requires the top-level `text` and image to be the first post's). The image goes on the first post. Each post, and the reply, must fit **280 characters as X counts them** (a link is 23, an emoji 2): Approve refuses an X post over that (`overLimitMessage` in `src/lib/formats/text.ts`), and so does Publish (`assertPublishable`), with the same count as the editor (`countChars(…, 'x_weighted')`). The texts are exactly what Copy gives (`postTexts` / `copyText`). Instagram, Threads, Facebook and YouTube formats are copied and posted by hand; Publish is not offered for them.

### Connecting

```
Settings → Integrations → X → "Connect X"
  → GET /api/integrations/x/connect                      (signed-in user required)
      state = 32 random bytes; cookie tdc_publish_state = userId.state.expiry.HMAC("x-publish-state")
      code_verifier = HMAC(key, "pkce:" + state)          ← nothing else to store
  → 302 https://auth.buffer.com/auth?response_type=code&client_id&redirect_uri&scope&state
                                    &code_challenge=S256(code_verifier)&code_challenge_method=S256
  → the customer signs in to Buffer and allows TDC AI (or cancels: access_denied → "cancelled")
  → GET /api/integrations/x/callback?code&state
      state ≠ cookie, other user, other platform's flow, expired, forged → "state_error"
      POST https://auth.buffer.com/token  (client_secret and code_verifier in the body, server only)
      granted scopes lack posts:write → "missing_permission"
      query account / channels → the first X channel (service "twitter") that is not locked
      none → "no_account" (connect X in Buffer first)
      saveConnection(platform 'x'): member_id = Buffer channel id, tokens encrypted (AES-256-GCM, bound to the user)
  → 303 /settings/integrations?connection=connected&platform=x
```

With several X accounts in the Buffer account, **Change account** on the X card lists them and switches without connecting again (scheduled X posts are cancelled, as when connecting a different account).

**Tokens.** Buffer's access token lasts about an hour; `offline_access` gives a refresh token, and the app renews the access token by itself before it runs out. Buffer's refresh tokens are **single-use**: each refresh returns a new one, and sending an old one again revokes the whole grant. So `usableAccessToken` refreshes with the connection's row locked (`SELECT … FOR UPDATE`): a worker, Publish now and the confirmation pass take turns, and whoever waited uses the token the first one got. If Buffer refuses the refresh (`invalid_grant`, the customer removed the app in Buffer), the X connection is marked expired and the customer clicks **Reconnect**.

A user can have a LinkedIn connection and an X connection at the same time (one row each, `UNIQUE(user_id, platform)`). Disconnecting X deletes the saved tokens, turns X auto-publishing off and cancels only the scheduled **X** posts; LinkedIn is untouched, and the other way round. Buffer has no revoke endpoint: to remove TDC AI in Buffer too, the customer removes it from the apps in their Buffer account settings.

**Testing without an app client:** with `BUFFER_CLIENT_ID` unset, the X card asks for a personal Buffer API key instead (Buffer → Settings → API), checks it by listing the X channels, and saves it encrypted. A key does not expire; if Buffer refuses it (`UNAUTHORIZED`), the connection is marked expired and the user pastes a new one.

### Publishing

Publish now, Schedule and auto-publishing use the same pipeline as LinkedIn (`requestPublication` → `claimPublication` → `executePublication`), with the X provider:

```
executePublication
  image?  → a signed link https://<app>/api/publishing-media/<postId>.<expiry>.<hmac>   (24 h, this post only)
  metadata.postRequestedAt = now                          ← from here the post may exist
  mutation createPost(input: { channelId, text, mode: shareNow, schedulingType: automatic, assets })
    sent at once      → 'published', X link from Buffer (externalLink)
    still sending     → stays 'publishing' with Buffer's post id (Publish now waits up to 6 s first)
    MutationError     → 'failed', rejected_by_platform (nothing was created)

worker, every minute: confirmPendingPublications
  query post(input: { id })
    sent              → 'published', X link, post marked posted
    error             → 'failed', rejected_by_platform, with X's reason (e.g. duplicate content)
    still sending     → looked at again next minute
    2 hours, no answer, or X disconnected meanwhile → 'failed', unknown_outcome
```

Scheduling stays in the app: a scheduled X post is handed to Buffer with `shareNow` when it is due, so Cancel, Schedule and auto-publishing work exactly as for LinkedIn, and Buffer's queue is never filled ahead.

### Duplicates, retries and status

The rules in [PUBLISHING.md](PUBLISHING.md#duplicates-retries-and-failures) apply, with Buffer's answers mapped like this:

| Buffer answer | Code | Retried? |
| --- | --- | --- |
| HTTP 429 / `RATE_LIMIT_EXCEEDED` (Buffer documents that it consumes nothing) | `rate_limited` | Yes, 1 then 5 minutes later |
| HTTP 503, or a refused connection / DNS failure | `platform_unavailable` | Yes |
| `UNAUTHORIZED` | `reauth_required` (X connection marked expired) | No |
| `FORBIDDEN` | `missing_permission` | No |
| A typed mutation error (`InvalidInputError`, `LimitReachedError`, …), validation errors | `rejected_by_platform` | No |
| `UNEXPECTED`, HTTP 500/502/504, a timeout or dropped connection **while creating** | `unknown_outcome` | **No**: the user checks X first |
| Post status `error` after Buffer took it | `rejected_by_platform` | No |

A post handed to Buffer is never sent again by the app on its own. The one-live-publication index still stops a second click, tab or worker from queuing it twice while Buffer is sending it.

**Deleting:** Buffer's API cannot remove a post from X, so X publications have no "Delete from X" (the Posts page hides it, and the server refuses it with `not_supported`). The user deletes it on X; **Delete** in the app still removes the post from the app.

## Limits

Check these before relying on X publishing at volume.

| Limit | Free plan | Where |
| --- | --- | --- |
| X post length | 280 (X Premium accounts allow more; the app keeps to 280) | X |
| Buffer channels | 3 (the 4th is locked; a locked channel cannot post) | Buffer |
| Buffer scheduled posts | 10 per channel at a time (the app sends with `shareNow`, so it never queues ahead) | Buffer |
| Buffer API requests (API key) | 150 per 15 min, 600 per 24 h, 1,000 per channel per 30 days, per Buffer account | Buffer API |
| Buffer API requests (app client) | The app client's own limits: a base of 100 per 15 min, 500 per 24 h, 15,000 per 30 days, plus 10, 25 and 100 for each customer who authorized it | Buffer API |
| Buffer API keys / app clients | 1 / 1 | Buffer |
| Image | JPEG, PNG, GIF or WebP, up to 5 MB | X |

Each published X post uses about 2–5 API requests (create, then a few status reads), well inside the free limits for normal use. Zapier is not used, so Zapier's task limits do not apply.

## Setup

1. **A Buffer app client** (once, by the TDC AI team):
   1. In Buffer, **Settings → API → App Clients → New Client** ([publish.buffer.com/settings/api](https://publish.buffer.com/settings/api)).
   2. Name "TDC AI" (shown on the consent screen), logo and privacy policy link optional. Choose **private** (the app has a server that keeps the secret).
   3. Permissions: `account:read`, `posts:read`, `posts:write`, `offline_access`.
   4. Redirect URIs, exactly (Buffer compares them character for character and requires HTTPS, even on localhost):
      - local: `https://localhost:3000/api/integrations/x/callback`
      - production: `https://<your-domain>/api/integrations/x/callback`
   5. Save, then copy the client ID and secret. A **public** client has no secret: set only `BUFFER_CLIENT_ID` and leave `BUFFER_CLIENT_SECRET` unset. Never pair one client's ID with another's secret; Buffer answers `401 client authentication failed`.
2. **Environment.** `TOKEN_ENCRYPTION_KEY` must be set (the same key LinkedIn uses), plus:
   ```bash
   BUFFER_CLIENT_ID="…"
   BUFFER_CLIENT_SECRET="…"          # confidential client only; server only, never in the browser or git
   # BUFFER_REDIRECT_URI defaults to {BETTER_AUTH_URL}/api/integrations/x/callback
   # BUFFER_SCOPES defaults to "account:read posts:read posts:write offline_access"
   ```
   X publishing is on whenever `TOKEN_ENCRYPTION_KEY` is set (`X_PUBLISHING="off"` hides it); without `BUFFER_CLIENT_ID`, users paste API keys instead. `BETTER_AUTH_URL` must be the app's public HTTPS address in production: Buffer downloads post images from it.
3. **Database.** Apply migration `0041_x_publishing` (adds columns and swaps one unique constraint; existing rows become LinkedIn's):
   ```bash
   npm run db:migrate
   ```
   Apply it before deploying this code: Posts, Settings and the worker read the new columns.
4. **Each customer**, once:
   1. Create a Buffer account (free) and connect their X account as a channel.
   2. In the app, **Settings → Integrations → X → Connect X**, sign in to Buffer and allow TDC AI.
   3. With several X accounts in Buffer, pick the one to publish as with **Change account**.

### Local development

Buffer requires an HTTPS redirect URI even on localhost, so run the app over HTTPS:

```bash
# .env
BETTER_AUTH_URL="https://localhost:3000"
NEXT_PUBLIC_APP_URL="https://localhost:3000"
BUFFER_CLIENT_ID="…"
BUFFER_CLIENT_SECRET="…"

npm run dev:https        # next dev --experimental-https: a self-signed certificate in ./certificates
```

Open **https://localhost:3000** (accept the certificate warning once) and sign in there: the session and the OAuth state cookies belong to that address. Google and LinkedIn sign-in redirect to `BETTER_AUTH_URL` too, so add `https://localhost:3000/api/auth/callback/{google,linkedin}` to those apps, or sign in with a passkey.

Without a public URL, Buffer cannot download images, so image posts fail with Buffer's error ("rejected"); text posts work. For images, use a tunnel instead and register its callback URL on the app client too (see [PUBLISHING.md](PUBLISHING.md#local-development)):

```bash
cloudflared tunnel --url http://localhost:3000
BETTER_AUTH_URL="https://<tunnel-host>"
# register https://<tunnel-host>/api/integrations/x/callback on the Buffer app client
```

## Trying it end to end

1. Settings → Integrations → X → **Connect X** → allow TDC AI on Buffer's screen → back with "X is connected".
2. Write an X post (format **X post**, not a thread), approve it.
3. Posts → approve one → **Publish now**: "Published on X" with **View post**, or "Publishing…" that turns into it within a minute (the worker confirms it). Use a test X account: the post is public.
4. **Schedule** another a few minutes ahead; the worker hands it to Buffer when due.
5. Disconnect X and check that scheduled LinkedIn posts are still scheduled.

## Tests

| Test | Covers |
| --- | --- |
| `tests/publishing-units.test.ts` → "X through Buffer" | X's weighted length, signed image links (expiry, tampering, another post), Buffer error classification (what is retried, what may have posted) |
| `tests/publishing.test.ts` → "X through Buffer" (needs `DATABASE_URL`, see [PUBLISHING.md](PUBLISHING.md#tests)) | X1–X8: no X connection, LinkedIn and X side by side, plain text and signed image to Buffer, pending then confirmed, X refusing after Buffer took it, the 2-hour timeout as `unknown_outcome`, Buffer refusals, rate limits and a revoked key, too long as X counts it, disconnecting X cancelling only X posts, no delete from X |
| `tests/auth-guards.test.ts` | the image route checks its signed token before anything else |

Buffer's real API and X itself cannot run in CI; check them by hand with a test account as above.

## Troubleshooting

- **"No X account is connected in this Buffer account"**: connect X as a channel in Buffer first.
- **"Your X channel is locked in Buffer"**: the free plan allows 3 channels; remove one or upgrade in Buffer.
- **"The request could not be verified"** after Buffer's screen: the app was opened on a different address than `BETTER_AUTH_URL` (the state cookie belongs to one host), or more than 10 minutes passed. Open the app at exactly `BETTER_AUTH_URL` and connect again.
- **Buffer says the redirect URI is invalid**: the callback URL registered on the app client differs from `BUFFER_REDIRECT_URI` / `{BETTER_AUTH_URL}/api/integrations/x/callback` (scheme, port and trailing slash all count).
- **Connection shows Expired**: the customer removed TDC AI in Buffer, or the refresh token was refused; click **Reconnect** (with an API key: paste a new one).
- **"Publishing…" for a long time**: the worker confirms every minute (`APP_ROLE` `all` or `worker`, or `/api/cron/jobs`). After 2 hours without an answer it fails as `unknown_outcome`: check X and the Buffer queue before **Try again**.
- **Image posts fail, text posts work**: `BETTER_AUTH_URL` is not reachable from the internet (local development), or the image is over 5 MB.
- Stuck or failed X publications: `SELECT id, status, error_code, error, linkedin_post_urn AS buffer_post_id FROM linkedin_publications WHERE platform = 'x' AND status IN ('failed','publishing') ORDER BY updated_at DESC;`
