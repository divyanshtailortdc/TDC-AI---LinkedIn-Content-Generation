# Publishing

How users connect a platform account for publishing, and how approved posts are published to it: now, at a scheduled time, or automatically. Four platforms have a publishing provider: **LinkedIn** (its own API, described on this page), **X** (through Buffer, see [PUBLISHING_X.md](PUBLISHING_X.md)), and **Facebook** and **Instagram** (through Buffer too, see [PUBLISHING_FACEBOOK_INSTAGRAM.md](PUBLISHING_FACEBOOK_INSTAGRAM.md)). The pipeline, states, retries and security below apply to all of them.

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
| Publishing providers | `src/lib/publishing/linkedin/`, `src/lib/publishing/buffer/` | Each platform's API client, connection method and text format, behind one shape (`PublishingProvider`). Generic code finds one with `providerFor(platform)` in `src/lib/publishing/provider.ts`. |

`src/lib/publishing/platform.ts` lists the platforms the engine publishes to. A post is published to the platform it was written for (`post_drafts.platform`); each publication records it (`linkedin_publications.platform`), and each user has one connection per platform (`linkedin_connections.platform`, unique with `user_id`). The tables keep their original names. Every message, route and settings screen takes the platform's name from the registry.

**Adding a platform** (Instagram, Facebook, …):

1. Add its id to `PLATFORM_IDS` and its spec to `PLATFORMS` in `src/lib/platforms/index.ts`, and its mark to `src/components/platform-mark.tsx`. Posts can then be written, previewed, checked and copied for it.
2. To publish through its API as well, add a provider folder beside `src/lib/publishing/linkedin/` that exports a `PublishingProvider`, add it to `PROVIDERS` in `src/lib/publishing/provider.ts` and its id to `src/lib/publishing/platform.ts`, and add its config to `src/env.ts` and `src/lib/publishing/config.ts`. Settings → Integrations, the header, Posts and the worker pick it up from there.

## Sign-in and publishing are separate

Signing in (Google, LinkedIn or a passkey, see [AUTHENTICATION.md](AUTHENTICATION.md)) only gives a person access to their TDC AI account. It never lets TDC AI post on LinkedIn, **including LinkedIn sign-in**: that flow asks only for `openid profile email`, and its tokens in `auth_accounts` are never read by publishing.

To publish, the signed-in user connects a LinkedIn account in **Settings → Integrations**. That is a second OAuth flow, with its own LinkedIn app, routes, tables and tokens:

| | Sign-in | Publishing |
| --- | --- | --- |
| Started from | `/login` | Settings → Integrations → Connect LinkedIn |
| Handled by | Better Auth, `/api/auth/callback/linkedin` | `/api/integrations/linkedin/connect` → `/api/integrations/linkedin/callback` |
| LinkedIn app | `LINKEDIN_CLIENT_ID` | `LINKEDIN_PUBLISH_CLIENT_ID` |
| Scopes | `openid profile email` | `openid profile w_member_social` |
| Stored in | `auth_accounts` | `linkedin_connections` (encrypted) |
| Affects the session | Yes | No |

So a user who signs in with Google can connect LinkedIn and publish. A user who signs in with LinkedIn must still connect LinkedIn here before anything is published. The publishing connection may even be a different LinkedIn member from the one they sign in with.

**Why a separate LinkedIn app.** LinkedIn invalidates a member's earlier access tokens when the *same app* is authorized again with *different scopes*. If publishing shared the sign-in app, every "Sign in with LinkedIn" would silently invalidate that member's publishing token. A separate app keeps the two independent. The publishing variables may hold the sign-in app's values if you accept that trade-off: the user then sees "expired" and reconnects after each LinkedIn sign-in.

## How it works

| Piece | File |
| --- | --- |
| Tables `linkedin_connections`, `linkedin_publications` | `src/db/schema.ts`, migration `0036_linkedin_publishing.sql` |
| States and error codes | `src/lib/publishing/status.ts` |
| The provider, under platform-neutral names | `src/lib/publishing/provider.ts` |
| The platform published to | `src/lib/publishing/platform.ts` |
| OAuth: authorization URL, signed state, code exchange, refresh, profile | `src/lib/publishing/linkedin/oauth.ts` |
| Token encryption (AES-256-GCM) | `src/lib/publishing/token-crypto.ts` |
| Connection: save, disconnect, a usable token | `src/lib/publishing/connection.ts` |
| LinkedIn REST calls and error classification | `src/lib/publishing/linkedin/api.ts` |
| Post text in LinkedIn's "little" format | `src/lib/publishing/linkedin/commentary.ts` |
| Queueing, claiming, publishing, recovery, auto-publishing | `src/lib/publishing/engine.ts` |
| Config from the environment | `src/lib/publishing/config.ts` |
| OAuth routes | `src/app/api/integrations/[platform]/connect/route.ts`, `src/app/api/integrations/[platform]/callback/route.ts` |
| Settings → Integrations (connect, disconnect, auto-publishing) | `src/app/(app)/settings/integrations/` |
| Publish now / Schedule / Cancel on Posts | `src/app/(app)/posts/publish-actions.ts`, `publish-controls.tsx` |
| Worker | `src/jobs/publishing.ts`, called by `src/jobs/scheduler.ts` (every minute) and `/api/cron/jobs` |

### Connecting

```
Settings → "Connect LinkedIn"
  → GET /api/integrations/linkedin/connect             (signed-in user required)
      state = 32 random bytes
      cookie tdc_publish_state = userId.state.expiry.HMAC   (httpOnly, SameSite=Lax, Path=/api/integrations, 10 min)
  → 302 linkedin.com/oauth/v2/authorization?response_type=code&scope=…&state=…
  → user approves (or cancels)
  → GET /api/integrations/linkedin/callback?code=…&state=…
      error=user_cancelled_*  → "cancelled"
      state ≠ cookie, other user, expired, or forged → "state_error" (nothing exchanged)
      POST /oauth/v2/accessToken (server only, with the secret)
      granted scopes lack w_member_social → "missing_permission" (nothing saved)
      GET /v2/userinfo → sub (member id), name, picture
      upsert linkedin_connections for the signed-in user, tokens encrypted
  → 303 /settings/integrations?connection=connected
```

One connection per user and platform (`UNIQUE (user_id, platform)`). Reconnecting replaces the tokens in the same row. Reconnecting as a *different* LinkedIn member turns auto-publishing off and cancels the user's scheduled publications (and in-flight ones whose create request was not sent yet), so nothing queued for the old member goes out as the new one.

**Disconnecting** deletes the tokens, turns auto-publishing off and cancels every `scheduled` publication for that platform (another platform's are untouched). The row stays as `disconnected` so earlier publications keep their history. Sign-in is untouched. TDC AI cannot revoke the grant on LinkedIn's side for a member app, so the page tells the user where to remove it (LinkedIn Settings → Data privacy → Permitted services).

### Publishing

All three ways go through one pipeline:

```
requestPublication   checks: post is the user's (via accounts.user_id), approved, not posted;
                     connection exists and is not expired → INSERT status 'scheduled'
claimPublication     UPDATE … SET status='publishing', attempts+1 WHERE status='scheduled' AND due
executePublication   checks everything again, then:
                       token (refreshed or marked expired)
                       image → POST /rest/images?action=initializeUpload, PUT bytes
                       metadata.postRequestedAt = now        ← from here the post may exist
                       POST /rest/posts → x-restli-id (urn:li:share:…)
                       status 'published', post URN, publishedAt; post_drafts.posted_at set
                       first comment → POST /rest/socialActions/{urn}/comments (best effort)
```

- **Publish now** (Posts, on an approved post): asks for confirmation, then requests, claims and publishes in the same request. The result shows at once: a "View post" link, or the error.
- **Schedule**: a date and time in the viewer's zone, sent as an instant. It must be at least a minute ahead and within a year. The worker publishes it when due and it can be cancelled until then.
- **Auto-publishing** (Settings → Integrations, off by default, asks for confirmation when turned on): every approved post *planned for today* on the Schedule page is queued at the chosen time in the chosen zone. It never publishes posts in review, never sweeps up a slot that passed before it was turned on (each save restarts that clock), and never touches a post that already has any publication (failed, cancelled or done). A slot the worker missed (server down, no cron call) is caught up if it runs within 2 hours of it, even after midnight: a 23:30 slot caught at 00:30 still publishes that day's posts. Turning it on is the only way to publish without a click per post.

A published post also gets `post_drafts.posted_at` (and a planned day if it had none), so the Schedule page shows it as Posted. Rejecting a post, or marking it posted on Schedule, cancels its scheduled publication; a post published (or being published) through the API cannot be rejected, and Schedule refuses "Not posted yet" for it. The text sent is exactly what Copy produces (`linkedInPostText`: the hook in Unicode bold, then body, call to action and hashtags), with LinkedIn's reserved characters escaped and hashtags kept as hashtags. Posts longer than 3,000 characters are refused before calling LinkedIn. WebP images are converted to PNG, since LinkedIn takes JPG, PNG and GIF.

### Deleting

- **Delete from LinkedIn** (beside "View post", while connected): asks for confirmation, then sends `DELETE /rest/posts/{urn}` with the same connection. Only the member the post went out as can delete it; after a reconnect as another member it is refused before calling LinkedIn. A 404 or 410 counts as already deleted. The publication sets `deleted_at` but stays `published`, so the one-live-publication index still keeps the post from going out again, and the post stays in the app as Posted.
- **Delete** on Posts deletes the post from the app for good. Its scheduled publication is cancelled, and the delete is refused while it is being published. For a published post the dialog can also delete it from LinkedIn first; if that fails, nothing is deleted. Its publications are not deleted: `linkedin_publications.draft_id` is `ON DELETE SET NULL`, so they stay as the record of what was published and where.
- **Hide** on Posts (`post_drafts.hidden_at`) only takes the post out of the review queue, under the Hidden filter. A scheduled publication still goes out.

## Duplicates, retries and failures

Creating a LinkedIn post is not idempotent, and a member token cannot read posts back (`r_member_social` is restricted), so a request that might have reached LinkedIn can never be verified afterwards. The rules:

1. **One live publication per post.** A partial unique index on `linkedin_publications(draft_id) WHERE status IN ('scheduled','publishing','published')` refuses a second one, from a double click, two tabs or a second worker. A published post can never be queued again, and Schedule will not undo its "posted".
2. **One worker per row.** Claiming is a conditional `UPDATE … WHERE status = 'scheduled'`; only one claimer gets the row back.
3. **Only certain failures are retried.** Up to 3 attempts, 1 then 5 minutes apart:

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
- **CSRF on the callback**: the state is random, kept in an httpOnly cookie that is HMAC-signed together with the user id and an expiry, and is single-use (the callback always deletes it). A callback is refused when the state differs from the cookie, the cookie is missing, forged or expired, or it belongs to another user. That last case covers an attacker sending a victim their own callback link to attach the attacker's LinkedIn to the victim's account.
- **Ownership**: every action takes only a post or publication id. The owner is always the session user, the post must belong to that user's identity, and the connection is looked up by that user's id, never by an id from the request. The worker checks the same at publish time, so even a row forged directly into the database cannot publish another user's post or use another user's connection (`tests/publishing.test.ts`, scenario 12).
- **Remote images** (stock or reviewer-pasted links) are fetched with `safeFetch`, which refuses private and internal addresses on every redirect.
- New actions and routes follow [the rules for new code](AUTHENTICATION.md#rules-for-new-code); `tests/auth-guards.test.ts` covers them.

## Setup

### 1. A LinkedIn app for publishing

1. In the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps), create an app (linked to a company Page you administer). Use a different app from the sign-in one (see [why](#sign-in-and-publishing-are-separate)).
2. Under **Products**, add **Share on LinkedIn** (grants `w_member_social`) and **Sign In with LinkedIn using OpenID Connect** (grants `openid` and `profile`, used to read the member's id, name and photo).
3. Under **Auth → OAuth 2.0 settings → Authorized redirect URLs**, add exactly the callback URL: `{BETTER_AUTH_URL}/api/integrations/linkedin/callback`, e.g. `https://app.example.com/api/integrations/linkedin/callback`, or `LINKEDIN_PUBLISH_REDIRECT_URI` when set.
4. Copy the **Client ID** and **Primary Client Secret**.

### 2. Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `LINKEDIN_PUBLISH_CLIENT_ID`, `LINKEDIN_PUBLISH_CLIENT_SECRET` | Yes, to enable publishing | The publishing app. Unset: Settings → Integrations says publishing is not set up, and Posts shows no publishing buttons. |
| `TOKEN_ENCRYPTION_KEY` | Yes, to enable publishing | `openssl rand -base64 32`. Changing it makes every stored token unreadable: each connection is marked expired when its token is next needed, and its user sees "reconnect". Keep it with the other production secrets. |
| `LINKEDIN_PUBLISH_REDIRECT_URI` | No | Defaults to `{BETTER_AUTH_URL}/api/integrations/linkedin/callback`. Must match the app's redirect URL exactly. |
| `LINKEDIN_PUBLISH_SCOPES` | No | Default `openid profile w_member_social`. Request only what the app has been granted; `openid profile` are needed for the member id. |
| `LINKEDIN_API_VERSION` | No | `LinkedIn-Version` header, default `202610`. Each version is supported for about a year; move it forward before it is sunset ([versions](https://learn.microsoft.com/linkedin/marketing/versioning)). |

The publishing app's id and secret identify **TDC AI**, not any member. Every user authorizes their own LinkedIn account, and only that user's token is used for their posts.

### 3. Database

Apply migrations `0036_linkedin_publishing` (two new tables and their indexes) and `0041_x_publishing` (a `platform` column on both, one connection per user and platform):

```bash
npm run db:migrate
```

**The Posts page reads `linkedin_publications`, so apply the migration before deploying this code**, or Posts fails with "relation does not exist".

### 4. The worker

- **Long-running server / `next dev`**: the scheduler runs a publishing pass every minute (`APP_ROLE` `all` or `worker`).
- **Vercel**: timers do not run. `/api/cron/jobs` runs a pass each time it is called, so scheduled posts go out as late as the calls are apart. Vercel Hobby cron runs once a day, so point an external pinger at it every 1–5 minutes (`Authorization: Bearer $CRON_SECRET`).

## Local development

LinkedIn accepts `http://localhost` redirect URLs for development apps, so the simplest setup is:

```bash
# .env (local only)
BETTER_AUTH_URL="http://localhost:3000"
LINKEDIN_PUBLISH_CLIENT_ID="…"
LINKEDIN_PUBLISH_CLIENT_SECRET="…"
TOKEN_ENCRYPTION_KEY="$(openssl rand -base64 32)"
# Register http://localhost:3000/api/integrations/linkedin/callback in the LinkedIn app.
```

If the app requires HTTPS, use a tunnel, and **open the app through the tunnel URL** (the session cookie and the state cookie belong to that host):

```bash
cloudflared tunnel --url http://localhost:3000     # or: ngrok http 3000
# then, with the https URL it prints:
BETTER_AUTH_URL="https://<tunnel-host>"
NEXT_PUBLIC_APP_URL="https://<tunnel-host>"
# Register https://<tunnel-host>/api/integrations/linkedin/callback in the LinkedIn app.
```

Google and LinkedIn sign-in redirect to `BETTER_AUTH_URL` too, so add the tunnel's sign-in callback URLs to those apps as well, or sign in with a passkey. Restart `next dev` after changing `.env`.

### Trying it end to end

1. Sign in (Google or LinkedIn) and open **Settings → Integrations** → **Connect LinkedIn**; approve on LinkedIn. You land back with "LinkedIn is connected" and your name and photo.
2. On **Posts**, approve a post. **Publish now** → confirm → "Published on LinkedIn" with a **View post** link. Use a test account: the post is public.
3. **Schedule** another approved post a few minutes ahead; it publishes within a minute of that time (`next dev` runs the worker).
4. Cancel on LinkedIn's consent screen to see the "cancelled" message; disconnect, reconnect, and so on.

## Tests

| Test | Needs | Covers |
| --- | --- | --- |
| `tests/publishing-units.test.ts` | nothing | encryption (round trip, tamper, wrong user/key), OAuth state (match, mismatch, other user, forged, expired: scenario 7), cancellation (scenario 6), scopes, the authorization URL and code exchange, little-text escaping, and which LinkedIn errors are retryable or ambiguous |
| `tests/publishing.test.ts` | `DATABASE_URL` with migration 0036 | scenarios 1–5 and 8–12 against a real database with LinkedIn stubbed: Google and LinkedIn sign-in users connecting and publishing, no connection, disconnect, reconnect, expired, revoked and refreshed tokens, API errors, scheduled publishing, retries without duplicates, concurrent claims, double clicks, crash recovery, auto-publishing rules, and user A against user B |
| `tests/auth-guards.test.ts` | nothing | the new actions start with `requireUser()`, the new routes with `getSessionUser()` |

The database test reads `DATABASE_URL` only from the environment, never `.env`. Use a scratch database:

```bash
docker exec tdc-linkedin-pg psql -U postgres -c 'CREATE DATABASE li_scratch'
export DATABASE_URL="postgresql://postgres:<password>@127.0.0.1:5433/li_scratch"
npx drizzle-kit migrate
npx tsx --test tests/publishing-units.test.ts tests/publishing.test.ts
docker exec tdc-linkedin-pg psql -U postgres -c 'DROP DATABASE li_scratch'
```

The real LinkedIn consent screen and Posts API cannot run in CI; check them by hand with a test account as above.

## Operating it

- **Who is connected**: `SELECT u.email, c.name, c.status, c.access_token_expires_at, c.auto_publish FROM linkedin_connections c JOIN auth_users u ON u.id = c.user_id;`
- **Stuck or failed publications**: `SELECT id, status, error_code, error, attempts, next_attempt_at FROM linkedin_publications WHERE status IN ('failed','publishing') ORDER BY updated_at DESC;`
- **`unknown_outcome`**: never retry these by editing the database. Ask the user to check their profile, then use Try again in the app.
- **Token lifetime**: LinkedIn member tokens last 60 days, and most apps get no refresh token. When one expires, the connection becomes `expired`, scheduled posts fail with "reconnect", and the user reconnects in Settings. If LinkedIn grants the app programmatic refresh tokens, they are used automatically.
- **API version**: move `LINKEDIN_API_VERSION` forward at least yearly. An unsupported version makes every call fail with 4xx.
