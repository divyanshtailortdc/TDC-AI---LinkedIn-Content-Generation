# Publishing

How users connect their accounts for publishing, and how approved posts are published: now, at a scheduled time, or automatically. Six platforms publish, **all through each user's own Buffer account**: **LinkedIn**, **X**, **Threads**, **Facebook**, **Instagram** and **YouTube** (Shorts only). Each user connects Buffer once (OAuth) and picks the account each network publishes to; how that works, and its setup, is in [BUFFER_OAUTH.md](BUFFER_OAUTH.md). Network specifics: [PUBLISHING_X.md](PUBLISHING_X.md), [PUBLISHING_FACEBOOK_INSTAGRAM.md](PUBLISHING_FACEBOOK_INSTAGRAM.md); Reels and Shorts, which go out with an AI video: [SHORT_VIDEOS.md](SHORT_VIDEOS.md#publishing). Until 2026-11-16 LinkedIn published through its own API; that code is gone. The pipeline, states, retries and security below apply to every network.

- [Platforms and providers](#platforms-and-providers)
- [Sign-in and publishing are separate](#sign-in-and-publishing-are-separate)
- [How it works](#how-it-works)
- [Duplicates, retries and failures](#duplicates-retries-and-failures)
- [Security](#security)
- [Setup](#setup)
- [Local development](#local-development)
- [Tests](#tests)
- [Operating it](#operating-it)

## Platforms and providers

Two layers keep the app independent of any one platform:

| Layer | Where | What it holds |
| --- | --- | --- |
| Platform registry | `src/lib/platforms/index.ts` | Every platform posts can be written for: name, length limits, fold, plain-text rules, link policy. Prompts, the linter, Copy, the preview and the UI read a post's platform (`post_drafts.platform`) from here. |
| Publishing providers | `src/lib/publishing/buffer/` | One provider per network, all over Buffer's API, behind one shape (`PublishingProvider`). Generic code finds one with `providerFor(platform)` in `src/lib/publishing/provider.ts`. |

`src/lib/publishing/platform.ts` lists the platforms the engine publishes to. A post is published to the platform it was written for (`post_drafts.platform`); each publication records it (`linkedin_publications.platform`), and each identity has one connection per platform (`linkedin_connections.platform`, unique with `account_id` since `0044_many_identities`): a user's professional identity and their persona connect separate accounts, and each identity's posts go out only through its own connection. The tables keep their original names. Every message, route and settings screen takes the platform's name from the registry.

**Adding a platform** (Instagram, Facebook, …):

1. Add its id to `PLATFORM_IDS` and its spec to `PLATFORMS` in `src/lib/platforms/index.ts`, and its mark to `src/components/platform-mark.tsx`. Posts can then be written, previewed, checked and copied for it.
2. To publish it through Buffer as well: add a network to `NETWORKS` in `src/lib/publishing/buffer/provider.ts` (Buffer's service name, limits, image variant, metadata), export its provider and add it to `PROVIDERS` in `src/lib/publishing/provider.ts`, add its id to `PUBLISHING_PLATFORM_IDS`, `BUFFER_PLATFORM_IDS` and `BUFFER_SERVICES` in `src/lib/publishing/platform.ts`, and its `*_PUBLISHING` switch to `src/env.ts` and `src/lib/publishing/config.ts`. The Buffer card in Settings, a post's Publish controls and the worker pick it up from there.

## Sign-in and publishing are separate

Signing in (Google or a passkey, see [AUTHENTICATION.md](AUTHENTICATION.md)) only gives a person access to their TDC AI account. It never lets TDC AI post anywhere: sign-in tokens in `auth_accounts` are never read by publishing.

To publish, the signed-in user connects their **Buffer** account in **Settings → Integrations**, a second OAuth flow with its own app, routes, tables and tokens:

| | Sign-in | Publishing |
| --- | --- | --- |
| Started from | `/login` | Settings → Integrations → Connect Buffer |
| Handled by | Better Auth, `/api/auth/callback/google` | `/api/integrations/buffer/connect` → `/api/integrations/buffer/callback` |
| App | `GOOGLE_CLIENT_ID` | the Buffer app client, `BUFFER_CLIENT_ID` |
| Scopes | `openid profile email` | `account:read posts:read posts:write offline_access` |
| Stored in | `auth_accounts` | `buffer_connections` (encrypted), `buffer_channels`, `linkedin_connections` |
| Affects the session | Yes | No |

So a user who signs in with Google can publish to LinkedIn, and a user who signs in with LinkedIn must still connect Buffer and pick a LinkedIn account there. The LinkedIn account published to may differ from the one they sign in with.

## How it works

| Piece | File |
| --- | --- |
| Tables `buffer_connections`, `buffer_channels`, `linkedin_connections` (one per identity and network), `linkedin_publications` | `src/db/schema.ts`; the names are historical |
| States and error codes | `src/lib/publishing/status.ts` |
| The provider, under platform-neutral names | `src/lib/publishing/provider.ts` |
| The platform published to | `src/lib/publishing/platform.ts` |
| Buffer OAuth: authorization URL, code exchange, refresh | `src/lib/publishing/buffer/oauth.ts` |
| Signed OAuth state and PKCE verifier | `src/lib/publishing/oauth-state.ts` |
| The Buffer connection: tokens, sync, channel picking, disconnect | `src/lib/publishing/buffer/token.ts`, `src/lib/publishing/buffer/connection.ts` |
| Token encryption (AES-256-GCM) | `src/lib/publishing/token-crypto.ts` |
| A network's connection: disconnect, switch account, a usable token | `src/lib/publishing/connection.ts` |
| Buffer's GraphQL API and error classification | `src/lib/publishing/buffer/api.ts` |
| Each network's provider (limits, images, metadata) | `src/lib/publishing/buffer/provider.ts` |
| Queueing, claiming, publishing, recovery, auto-publishing | `src/lib/publishing/engine.ts` |
| Config from the environment | `src/lib/publishing/config.ts` |
| OAuth routes | `src/app/api/integrations/buffer/{connect,callback}/route.ts` |
| Settings → Integrations: the Buffer card (accounts, Publish here, Stop, auto-publishing) | `src/app/(app)/settings/integrations/` |
| Publish now / Schedule / Cancel on Posts | `src/app/(app)/posts/publish-actions.ts`, `publish-controls.tsx` |
| Worker | `src/jobs/publishing.ts`, called by `src/jobs/scheduler.ts` (every minute) and `/api/cron/jobs` |

### Connecting

The user connects Buffer once ([BUFFER_OAUTH.md → The flow](BUFFER_OAUTH.md#the-flow)), then picks the account each network publishes to on the Buffer card (**Publish here**); connecting sets up the first usable account of each network for the active identity by itself.

One network connection per identity and platform (`UNIQUE (account_id, platform)`); `user_id` stays as its owner. It names a Buffer channel (`member_id`) and borrows the owner's Buffer connection's token (`buffer_connection_id`). Picking a *different* account for a network turns its auto-publishing off and cancels that identity's scheduled publications for it (and in-flight ones whose create request was not sent yet), so nothing queued for the old account goes out as the new one.

**Stop** (one network) turns auto-publishing off and cancels every `scheduled` publication for that network; the others are untouched. **Disconnect Buffer** does that for every network of every identity of the user and deletes the Buffer tokens. Rows stay as `disconnected` so earlier publications keep their history. Sign-in is untouched.

### Publishing

All three ways go through one pipeline:

```
requestPublication   checks: post is the user's (via accounts.user_id), approved, not posted;
                     its identity's connection exists and is not expired → INSERT status 'scheduled'
claimPublication     UPDATE … SET status='publishing', attempts+1 WHERE status='scheduled' AND due
executePublication   checks everything again, then:
                       Buffer token (refreshed under a row lock, or marked expired)
                       image, slides or video → signed links to this app that Buffer downloads
                       metadata.postRequestedAt = now        ← from here the post may exist
                       Buffer createPost (text, images, network metadata, first comment)
                       sent at once: status 'published', its link, publishedAt; post_drafts.posted_at set
                       still pending: stays 'publishing'; confirmPendingPublications follows it
```

- **Publish now** (Posts, on an approved post): asks for confirmation, then requests, claims and publishes in the same request. The result shows at once: a "View post" link, or the error.
- **Schedule**: a date and time in the viewer's zone, sent as an instant. It must be at least a minute ahead and within a year. The worker publishes it when due and it can be cancelled until then.
- **Auto-publishing** (Settings → Integrations, off by default, asks for confirmation when turned on): every approved post *planned for today* on the Schedule page is queued at the chosen time in the chosen zone. It never publishes posts in review, never sweeps up a slot that passed before it was turned on (each save restarts that clock), and never touches a post that already has any publication (failed, cancelled or done). A slot the worker missed (server down, no cron call) is caught up if it runs within 2 hours of it, even after midnight: a 23:30 slot caught at 00:30 still publishes that day's posts. Turning it on is the only way to publish without a click per post.

A published post also gets `post_drafts.posted_at` (and a planned day if it had none), so the Schedule page shows it as Posted. Rejecting a post, or marking it posted on Schedule, cancels its scheduled publication; a post published (or being published) through the API cannot be rejected, and Schedule refuses "Not posted yet" for it. The text sent is exactly what Copy produces (for LinkedIn: the hook in Unicode bold, then body, call to action and hashtags), as plain text. A post longer than its network allows (LinkedIn 3,000 characters) is refused before calling Buffer. Network specifics (image shapes, carousels, threads, first comments) are in `src/lib/publishing/buffer/provider.ts`.

### Deleting

- **Delete from the platform** is not offered: Buffer's API documents no delete for a post it has already sent, so no provider has `deletePost` and the button is hidden (`canDelete` false). Delete the post on the network itself. The engine still supports it for a provider that can (`deletePublishedPost`: the publication sets `deleted_at` but stays `published`, and the post is unlocked to be edited and published again).
- **Delete** on Posts deletes the post from the app for good. Its scheduled publication is cancelled, and the delete is refused while it is being published. Its publications are not deleted: `linkedin_publications.draft_id` is `ON DELETE SET NULL`, so they stay as the record of what was published and where.
- **Hide** on Posts (`post_drafts.hidden_at`) only takes the post out of the Posts list (Filters → Hidden posts shows it). A scheduled publication still goes out.

## Duplicates, retries and failures

Creating a LinkedIn post is not idempotent, and a member token cannot read posts back (`r_member_social` is restricted), so a request that might have reached LinkedIn can never be verified afterwards. The rules:

1. **One live publication per post.** A partial unique index on `linkedin_publications(draft_id) WHERE status IN ('scheduled','publishing','published')` refuses a second one, from a double click, two tabs or a second worker. A published post can never be queued again, and Schedule will not undo its "posted".
2. **One worker per row.** Claiming is a conditional `UPDATE … WHERE status = 'scheduled'`; only one claimer gets the row back.
3. **Only certain failures are retried.** Up to 3 attempts, 1 then 5 minutes apart. A rate limit waits as long as Buffer's `Retry-After` asks (plus a second), or 15 minutes then an hour when it gives none. If Buffer asks for more than 24 hours (its daily or 30-day limit), the publication fails at once rather than going out days late. The stored error ends with "It will be tried again." only when a retry is actually queued; once retries run out it says so and points to Try again.

   | Failure | Retried? | Why |
   | --- | --- | --- |
   | Anything before the create request (token, image download/upload, LinkedIn 5xx on the image) | Yes | Nothing is published yet |
   | Connection refused / DNS failure | Yes | The request never left |
   | 429, 503, 409 on the post | Yes | LinkedIn processed nothing |
   | 500, 502, 504, timeout, dropped connection on the post, or 201 without an id | **No**: `unknown_outcome` | The post may exist |
   | 400/422 (rejected), 401 (reconnect), 403 (permission), post not approved/already posted | No | Retrying cannot help |

4. **Interrupted processes.** A row left `publishing` for 10 minutes is recovered by the worker: back to `scheduled` if `postRequestedAt` was never set, otherwise `failed` as `unknown_outcome`.
5. **After `unknown_outcome`** the post shows "Try again", which first asks the user to check their LinkedIn profile. The server refuses to publish it again until that confirmation is sent.
6. The **first comment** is never retried: it could appear twice. If it fails, the post is still published and the UI says the comment was not added.

## Security

- **Tokens** are encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), each with a fresh IV, and with the owning user's id bound in as associated data: a ciphertext copied to another user's row fails to decrypt. They are decrypted only in the server-side publishing code, and never sent to the browser (pages get `ConnectionSummary`, which has no token fields).
- **The client secret** is used only in the server-side token request body, never in a URL or the browser.
- **CSRF on the callback**: the state is random, kept in an httpOnly cookie that is HMAC-signed together with the user id and an expiry, and is single-use (the callback always deletes it). A callback is refused when the state differs from the cookie, the cookie is missing, forged or expired, or it belongs to another user. That last case covers an attacker sending a victim their own callback link to attach the attacker's Buffer account to the victim's. Buffer's flow adds PKCE (S256), with a verifier only this server can derive.
- **Ownership**: every action takes only a post or publication id. The owner is always the session user, the post must belong to one of that user's identities, and the connection is that identity's, never one named in the request. The worker checks the same at publish time, so even a row forged directly into the database cannot publish another user's post or use another user's connection (`tests/publishing.test.ts`, scenario 12).
- **Remote images** (stock or reviewer-pasted links) are fetched with `safeFetch`, which refuses private and internal addresses on every redirect.
- New actions and routes follow [the rules for new code](AUTHENTICATION.md#rules-for-new-code); `tests/auth-guards.test.ts` covers them.

## Setup

### 1. The Buffer app client, and 2. Environment

See [BUFFER_OAUTH.md → Setup](BUFFER_OAUTH.md#setup): one Buffer app client with the redirect URI `{BETTER_AUTH_URL}/api/integrations/buffer/callback`, `BUFFER_CLIENT_ID` (and `BUFFER_CLIENT_SECRET` for a confidential client), and `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`; changing it makes every stored token unreadable, and users reconnect). `BUFFER_TOKEN_ENCRYPTION_KEY` is optional. Each network is on by default; `LINKEDIN_PUBLISHING`, `X_PUBLISHING`, `THREADS_PUBLISHING`, `FACEBOOK_PUBLISHING`, `INSTAGRAM_PUBLISHING` or `YOUTUBE_PUBLISHING` set to `off` hides it. `BETTER_AUTH_URL` (or `PUBLISHING_MEDIA_URL`) must be reachable from the internet: Buffer downloads post images and videos from it.

### 3. Database

Apply every migration, including `0049_buffer_oauth` (the Buffer connection and channel tables) and `0050_linkedin_via_buffer` (disconnects the old direct LinkedIn connections and cancels their waiting posts):

```bash
npm run db:migrate
```

**The Posts page reads `linkedin_publications`, so apply the migration before deploying this code**, or Posts fails with "relation does not exist". The same goes for `0056_post_videos` (Reels and Shorts, [SHORT_VIDEOS.md](SHORT_VIDEOS.md#setup)) and `0057_ai_usage_draft` (per-post cost, [POST_COST.md](POST_COST.md)): without 0057, every AI call fails to record and the Posts page fails.

### 4. The worker

- **Long-running server / `next dev`**: the scheduler runs a publishing pass every minute (`APP_ROLE` `all` or `worker`), and beside it a pass that stores finished AI videos ([SHORT_VIDEOS.md](SHORT_VIDEOS.md#generation-start-then-check)).
- **Vercel**: timers do not run. `/api/cron/jobs` runs both passes, side by side, each time it is called, so scheduled posts go out as late as the calls are apart. Vercel Hobby cron runs once a day, so point an external pinger at it every 1–5 minutes (`Authorization: Bearer $CRON_SECRET`).

## Local development

Buffer requires an HTTPS redirect URI, even on localhost: run `npm run dev:https`, set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to `https://localhost:3000`, open the app there (the session and state cookies belong to that origin), and register `https://localhost:3000/api/integrations/buffer/callback` on the Buffer app client. Google sign-in redirects to `BETTER_AUTH_URL` too, so add `https://localhost:3000/api/auth/callback/google` to the Google app, or sign in with a passkey. Buffer downloads post images from `PUBLISHING_MEDIA_URL`: point it at a tunnel (`cloudflared tunnel --url http://localhost:3000`). Restart `next dev` after changing `.env`. Once Buffer is connected, plain `npm run dev` over http publishes too (sign in again there); only connecting needs https.

### Trying it end to end

1. Sign in and open **Settings → Integrations** → **Connect Buffer**; allow it on Buffer's screen. You land back with your Buffer channels listed.
2. On a LinkedIn (or X, …) channel, **Publish here** if it is not already the one in use.
3. On **Posts**, approve a post. **Publish now** → confirm → **View post**. Use a test account: the post is public.
4. **Schedule** another approved post a few minutes ahead; it publishes within a minute of that time (`next dev` runs the worker).

## Tests

| Test | Needs | Covers |
| --- | --- | --- |
| `tests/publishing-units.test.ts` | nothing | encryption (round trip, tamper, wrong user/key), OAuth state (match, mismatch, other user, forged, expired), image links and variants, and which Buffer answers are retryable or ambiguous |
| `tests/buffer-oauth.test.ts` | nothing | the Buffer authorization URL and PKCE, code exchange and refresh, scopes, token encryption, reading the account and channels, rate limits |
| `tests/publishing.test.ts` | `DATABASE_URL` | publishing every network against a real database with Buffer stubbed: connecting, no connection, disconnect, switching accounts, expired, revoked and refreshed tokens, errors, scheduling, retries without duplicates, concurrent claims, double clicks, crash recovery, auto-publishing, carousels, several identities, and user A against user B |
| `tests/buffer-connection.test.ts` | `DATABASE_URL` | the Buffer connection: connect, sync, picking channels, concurrent refresh, isolation between users, moving older connections onto it, disconnect |
| `tests/auth-guards.test.ts` | nothing | actions start with `requireUser()`, routes with `getSessionUser()` |

The database tests read `DATABASE_URL` only from the environment, never `.env`. Use a scratch database, and run the files one at a time: in parallel, one file's worker can claim another's publications.

```bash
docker exec tdc-linkedin-pg psql -U postgres -c 'CREATE DATABASE li_scratch'
export DATABASE_URL="postgresql://postgres:<password>@127.0.0.1:5433/li_scratch"
npx drizzle-kit migrate
npx tsx --conditions=react-server --test --test-concurrency=1 tests/publishing-units.test.ts tests/buffer-oauth.test.ts tests/publishing.test.ts tests/buffer-connection.test.ts
docker exec tdc-linkedin-pg psql -U postgres -c 'DROP DATABASE li_scratch'
```

The real Buffer consent screen and API cannot run in CI; check them by hand with a test account as above.

## Operating it

- **Who is connected**: `SELECT u.email, b.name, b.status, b.last_synced_at FROM buffer_connections b JOIN auth_users u ON u.id = b.user_id;` and, per network, `SELECT u.email, c.platform, c.name, c.status, c.auto_publish FROM linkedin_connections c JOIN auth_users u ON u.id = c.user_id;`
- **Stuck or failed publications**: `SELECT id, status, error_code, error, attempts, next_attempt_at FROM linkedin_publications WHERE status IN ('failed','publishing') ORDER BY updated_at DESC;`
- **`unknown_outcome`**: never retry these by editing the database. Ask the user to check their profile, then use Try again in the app.
- **Token lifetime**: Buffer access tokens last about an hour and are refreshed automatically (single-use refresh tokens, under a row lock). When Buffer refuses a refresh or the user removes the app in Buffer, the Buffer connection and its networks become `expired`, scheduled posts fail with "reconnect", and the user clicks **Reconnect Buffer** in Settings.
