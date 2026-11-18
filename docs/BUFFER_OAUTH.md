# Buffer OAuth: one Buffer connection per user

LinkedIn, X, Threads, Facebook and Instagram publish through each user's own Buffer account ([PUBLISHING_X.md](PUBLISHING_X.md) explains why). Since 2026-11-13, a user connects their Buffer account **once**, in Settings → Integrations, on Buffer's consent screen. They then pick which Buffer channel each network publishes to. Nobody generates or pastes a Buffer API key any more.

Source of truth for every endpoint, parameter and field below: [developers.buffer.com → Authentication](https://developers.buffer.com/guides/authentication.html), [API reference](https://developers.buffer.com/reference.html) and [Rate limits](https://developers.buffer.com/guides/api-limits.html), checked on 2026-11-13.

## LinkedIn through Buffer (2026-11-16)

LinkedIn publishing moved from LinkedIn's own API to Buffer, so all five networks connect the same way: one Buffer connection, one channel picked per network. The LinkedIn developer app (`LINKEDIN_CLIENT_ID`) is used **only for signing in**. The direct LinkedIn publishing code (`src/lib/publishing/linkedin/`, `LINKEDIN_PUBLISH_*`, `LINKEDIN_API_VERSION`) and the per-platform `/api/integrations/[platform]` routes were removed.

- **Text:** plain, as written. No LinkedIn "little text" escaping.
- **First comment:** not sent. Buffer refuses `metadata.linkedin.firstComment` without a paid Buffer plan ("LinkedIn first comment requires a paid plan"), so LinkedIn posts go out without one; the post's first comment stays in the app to add by hand.
- **Image:** a signed link Buffer downloads (10 MB max; WebP is sent as JPEG).
- **Carousel:** several images in one post (up to 20, Buffer's and LinkedIn's limit), no longer a PDF document. `FORMATS['linkedin.post'].media.carousel.delivery` is `'images'`, which the slide-writing prompt and the publish checks follow.
- **Deleting a published post from LinkedIn through the app is no longer possible.** Buffer's API documents no delete for a post it has already sent, so `canDelete` is false and the button is hidden. Posts published directly before the switch keep their LinkedIn link (`postUrl` for `urn:li:` ids).
- **Migration `0050_linkedin_via_buffer`** (data only, idempotent) disconnects every direct LinkedIn publishing connection (tokens deleted, auto-publishing off) and cancels the LinkedIn posts still waiting to go out through one, with a message saying why. Posts already handed to LinkedIn and published history are untouched. Until it runs, a direct LinkedIn connection is refused at publish time with the same explanation (`assertCanPublish`).
- Users pick their LinkedIn profile or page on the Buffer card (**Publish here**). Connecting Buffer sets up the first usable LinkedIn channel for the active identity automatically.

## What changed

| Before | Now |
| --- | --- |
| Each network (X, Threads, Facebook, Instagram) ran its own Buffer consent flow, with its own grant and token, and its own callback (`/api/integrations/{x,threads,facebook,instagram}/callback`). | One Buffer grant per app user (`buffer_connections`), one callback: `/api/integrations/buffer/callback`. The networks borrow its token. |
| Without `BUFFER_CLIENT_ID`, users pasted a Buffer API key on each card. | Removed. Without `BUFFER_CLIENT_ID`, Buffer cannot be connected. |
| The channel list was fetched live from Buffer each time "Change account" was opened. | Channels are synced into `buffer_channels` on connect and on **Sync now**, and the pickers read them from there. |

**Existing connections keep working.** A network connection made the old way (its own Buffer OAuth token or pasted API key) still publishes with that credential. When its owner connects Buffer, every such connection whose channel is in the connected Buffer account moves onto the new connection automatically. It keeps the same channel, auto-publishing setting and scheduled posts, and its old credential is deleted. A connection whose channel is not in that Buffer account keeps its own credential until the user picks a channel for it.

## The flow

```
Settings → Integrations → "Connect Buffer"
  → GET /api/integrations/buffer/connect                     (signed-in user only)
      state  = 32 random bytes; cookie tdc_publish_state = HMAC-signed {user, identity, state, expiry 10 min}, flow "buffer"
      PKCE   = verifier HMAC(TOKEN_ENCRYPTION_KEY, state) (43 chars), challenge S256
  → 302 https://auth.buffer.com/auth?response_type=code&client_id&redirect_uri&scope&state&code_challenge&code_challenge_method=S256&prompt=consent
  → user allows (or denies)
  → GET /api/integrations/buffer/callback?code&state            (or ?error=access_denied)
      1. error            → "cancelled" (access_denied) or "failed"; no state needed, nothing changes
      2. state            → must match the cookie, the signed-in user, the "buffer" flow, within 10 min; else "state_error"
      3. code exchange    → POST https://auth.buffer.com/token (form body: grant_type=authorization_code, code,
                            redirect_uri, client_id, code_verifier, client_secret for a confidential client only)
      4. scopes           → the grant must include account:read and posts:write; else "missing_permission"
      5. read Buffer      → query Account { id name email avatar organizations { id } }, then
                            query Channels(organizationId) for each organization (all networks)
      6. save, in one DB transaction:
           buffer_connections   upsert on user_id: account info, tokens (encrypted), scopes, status connected
           buffer_channels      upsert every channel; ones Buffer no longer lists get removed_at
           linkedin_connections networks through this Buffer connection revived; older ones moved onto it;
                                 the active identity's networks without a working connection get the
                                 first usable channel of that network
  → 303 /settings/integrations?connection=connected&platform=buffer
```

Only the outcome's key goes back to the page. Tokens, codes and secrets never do.

## Scopes

Requested (`BUFFER_SCOPES`, default `account:read posts:read posts:write offline_access`):

| Scope | Used for | Required |
| --- | --- | --- |
| `account:read` | The Buffer account and its channels (connect, Sync now) | Yes |
| `posts:write` | Creating posts | Yes |
| `posts:read` | Following a post until Buffer has sent it (its link, or its error) | Asked; a grant without it still publishes |
| `offline_access` | The refresh token | Asked; without it the connection expires after about an hour |

`ideas:*`, `account:write`, `snippets:*` and `notes:*` are not requested.

## Tokens

- **At rest:** AES-256-GCM (`src/lib/publishing/token-crypto.ts`), with a random IV per value and the owner's user id bound in as associated data, so a ciphertext moved to another user's row fails to decrypt. The key is `BUFFER_TOKEN_ENCRYPTION_KEY`, or `TOKEN_ENCRYPTION_KEY` when that is unset. Both the access and the refresh token are encrypted.
- **Never sent to the browser:** `BufferSummary` and `ConnectionSummary` carry no token fields, and the tests check that the summary's JSON contains none.
- **Never logged:** error logs carry Buffer's `error_description` or our own message, never a request body, token, code or secret.
- **Refresh** (`src/lib/publishing/buffer/token.ts`, `usableBufferToken`): a token within 60 s of expiring is refreshed first. Buffer's refresh tokens are **single-use**, and reusing a spent one revokes the whole grant. So the refresh runs inside a transaction that holds the connection's row lock (`SELECT … FOR UPDATE`). A concurrent process (another worker, or Publish now) waits for the lock, then finds the new access token and uses it rather than refreshing again. The new access and refresh tokens replace the old ones in that same transaction. Tested with three concurrent callers: Buffer sees one refresh request.
- **Expiry:** the Buffer connection is marked `expired` when Buffer refuses the refresh (HTTP 400/401: revoked, spent or run out), when there is no refresh token, when the stored token cannot be decrypted, or when Buffer answers 401 while publishing or syncing. Every network publishing through it is marked expired with it, so Settings and the Publish controls say **Reconnect Buffer**. Network failures and Buffer 5xx during a refresh change nothing and are retried (`platform_unavailable`).
- **Revocation:** Buffer documents no revocation endpoint. **Disconnect** deletes the tokens and channels on our side. Revoking access on Buffer's side is done in the user's Buffer account settings (removing the app), which Buffer says invalidates all of the app's tokens. The next request then gets a 401, and the connection is marked expired.

## Database (migration `0049_buffer_oauth`)

Additive and idempotent: it creates two tables and one nullable column, and changes no existing data.

**`buffer_connections`**: one per app user (`UNIQUE (user_id)`; `user_id → auth_users ON DELETE CASCADE`).
`buffer_account_id`, `name`, `email`, `avatar_url`, `access_token` (encrypted), `access_token_expires_at`, `refresh_token` (encrypted), `scopes`, `status` (`connected | expired | disconnected`, checked), `last_error`, `connected_at`, `last_synced_at`, `created_at`, `updated_at`. Index on `buffer_account_id`. A disconnected row keeps its account info, with its tokens set to null.

**`buffer_channels`**: the channels of a connection, on every network Buffer supports (X, Threads, Facebook, Instagram, LinkedIn, TikTok, …).
`connection_id → buffer_connections ON DELETE CASCADE`, `user_id` (copied, so every query filters on the owner), `channel_id`, `organization_id`, `service`, `channel_type`, `name` (Buffer's name, usually the handle), `display_name`, `avatar_url`, `external_link`, `is_disconnected`, `is_locked`, `removed_at`, `last_synced_at`. `UNIQUE (connection_id, channel_id)`, plus an index on `(user_id, service)`.

**`linkedin_connections.buffer_connection_id`**: nullable, FK `linkedin_connections_buffer_connection_fk → buffer_connections ON DELETE SET NULL`, with a partial index. When it is set, the network connection publishes with that Buffer connection's token, `member_id` is the Buffer channel id, and its own token columns are null. Network connections stay one per identity and network: auto-publishing, scheduling and publication history are unchanged.

Apply it with `npm run db:migrate`, after checking that `DATABASE_URL` points where you mean it to.

## Code map

| Piece | Where |
| --- | --- |
| OAuth (authorize URL, code exchange, refresh, scopes) | `src/lib/publishing/buffer/oauth.ts` |
| State cookie and PKCE verifier | `src/lib/publishing/oauth-state.ts` |
| Token service (encrypt, usable token, locked refresh, expire) | `src/lib/publishing/buffer/token.ts` |
| Connection and channel sync service (connect, sync, pick channel, disconnect, summary) | `src/lib/publishing/buffer/connection.ts` |
| GraphQL client (account, channels, create post, post status) | `src/lib/publishing/buffer/api.ts` |
| Publishing provider per network (unchanged except the connect method) | `src/lib/publishing/buffer/provider.ts` |
| Where the engine gets a token (delegates to the Buffer connection) | `usableAccessToken`, `markExpired` in `src/lib/publishing/connection.ts` |
| Routes | `src/app/api/integrations/buffer/{connect,callback}/route.ts` |
| Server actions (`syncBuffer`, `selectBufferChannel`, `disconnectBufferAccount`) | `src/app/(app)/settings/integrations/actions.ts` |
| UI: the Buffer card (accounts, Publish here, Stop, other connections) and auto-publishing rows | `settings/integrations/{buffer-section,auto-publish-section}.tsx` |
| Config (`bufferConnectConfig`, `enabledBufferPlatforms`) | `src/lib/publishing/config.ts` |

The publishing engine, the post workspace, scheduling and auto-publishing were not changed.

## Edge cases

| Case | What happens |
| --- | --- |
| User denies on Buffer | `?error=access_denied`: "authorization was cancelled". Nothing changes. |
| Invalid, expired or swapped state | "could not be verified". Logged with the reason (`missing`/`invalid`/`mismatch`/`wrong_user`/`expired`), never the values. |
| Invalid or expired code | "could not be connected". Buffer's `error_description` is logged. |
| Duplicate callback (double load, back button) | The code is single-use, so the second exchange fails. If this user's Buffer connection was saved after this flow started, the result is "connected", not an error. The state cookie is cleared after every callback. |
| Repeated clicks on Connect | The button disables itself after the first click ("Opening Buffer…"). |
| Grant without `account:read` or `posts:write` | "permission … was not granted". Nothing is saved. |
| Reconnecting the same Buffer account | Tokens are replaced in place. Expired networks come back, keeping their channel. |
| Connecting a different Buffer account | Its channels replace the old ones. Networks whose channel is not in the new account are disconnected (scheduled posts cancelled). The connecting identity's networks are then set up on the new account's channels, with auto-publishing off. |
| Several users connect their own Buffer accounts | Each has their own row, tokens and channels. Every query filters on the signed-in user's id. A network row pointing at another user's Buffer connection is refused (`not_connected`, tested). |
| Several users connect the same Buffer account | Allowed: separate grants, separate rows. They share that Buffer account's rate limits. |
| Channel locked (over the plan's limit) or disconnected in Buffer | Listed with the reason, and cannot be picked. A network already on it shows a warning; publishing fails with Buffer's error. |
| Channel removed in Buffer | **Sync now** marks it `removed_at` and the network's card says it is gone. Syncing never disconnects a network on its own (that would cancel scheduled posts). |
| Rate limit (HTTP 429, `RATE_LIMIT_EXCEEDED`) | Retryable. The message gives Buffer's `Retry-After` (seconds or an HTTP date) in minutes, hours or days, and the error carries it as `retryAfterMs`; publishing waits that long before the next attempt (see PUBLISHING.md). Sync now is throttled to once per 30 s per user. |
| Buffer down (5xx, network) | Reads and refreshes are retried and nothing is marked expired. A post create that may have gone through is `unknown_outcome` and never retried automatically (unchanged). |
| Access revoked in Buffer | The next request gets a 401, and the connection and its networks are marked expired: "Reconnect Buffer". |
| Disconnect Buffer | Tokens and channels are deleted. Every Buffer network of every identity of the user is disconnected, with scheduled posts cancelled and auto-publishing off. The row stays, as `disconnected`. |

## Setup

### Buffer Developer Portal (manual, once per environment)

1. In Buffer, go to **Settings → API → App Clients → New Client** ([publish.buffer.com/settings/api](https://publish.buffer.com/settings/api)). On the free plan, each Buffer account can have 1 app client (3 on Essentials, 5 on Team).
2. Register the redirect URI **exactly** (scheme, host, port and path all count):
   - production: `https://<your-domain>/api/integrations/buffer/callback`, e.g. `https://tdc-ai-linked-in-content-generation.vercel.app/api/integrations/buffer/callback`
   - local: `https://localhost:3000/api/integrations/buffer/callback` (Buffer needs HTTPS, even locally)
3. Allow the scopes `account:read posts:read posts:write offline_access`.
4. Copy the client ID, and the client secret for a confidential client. A public client has no secret: leave `BUFFER_CLIENT_SECRET` unset, or Buffer refuses the token request.
5. The old per-network callbacks (`/api/integrations/{x,threads,facebook,instagram}/callback`) can be removed from the app client. Those routes now return 404.

### Environment variables

```env
TOKEN_ENCRYPTION_KEY="…"            # already set; also signs OAuth state and image links
BUFFER_CLIENT_ID="…"
BUFFER_CLIENT_SECRET="…"            # confidential client only; server only
BUFFER_REDIRECT_URI=""              # optional; only its origin is read. Default: {BETTER_AUTH_URL}/api/integrations/buffer/callback
BUFFER_SCOPES="account:read posts:read posts:write offline_access"
BUFFER_TOKEN_ENCRYPTION_KEY=""      # optional; openssl rand -base64 32. Default: TOKEN_ENCRYPTION_KEY
```

On Vercel, set them under Project → Settings → Environment Variables, then redeploy. Changing `BUFFER_TOKEN_ENCRYPTION_KEY` (or `TOKEN_ENCRYPTION_KEY` while the Buffer key is unset) makes saved Buffer connections unreadable: they are marked expired on first use, and users reconnect.

### Local

```bash
npm run dev:https                  # https://localhost:3000; sign in there (the cookies belong to that origin)
# .env.local: BUFFER_CLIENT_ID, BUFFER_CLIENT_SECRET, BETTER_AUTH_URL="https://localhost:3000"
# Buffer downloads post images from PUBLISHING_MEDIA_URL: a public tunnel, e.g.
cloudflared tunnel --url http://localhost:3000   # put its https://….trycloudflare.com address in PUBLISHING_MEDIA_URL
npm run db:migrate                 # applies 0049_buffer_oauth to the DB in DATABASE_URL
```

Then open Settings → Integrations → **Connect Buffer**.

## Tests

- `tests/buffer-oauth.test.ts` (no database): the authorization URL (S256 challenge, scopes, no secret or verifier in it); state validation (another flow, another user, expired, forged); code exchange for confidential and public clients; refresh; refusal messages without secrets; required scopes; encryption with the Buffer key, bound to the user; reading the account and channels; 429 with `Retry-After`; 401; 503.
- `tests/buffer-connection.test.ts` (real Postgres, Buffer stubbed, including single-use refresh tokens): connect (encrypted tokens, every channel, networks set up); publishing with the OAuth token; refresh and rotation; three concurrent refreshes making one Buffer request; a refused refresh expiring everything; reconnecting; a 401 while publishing; picking and switching channels (scheduled posts cancelled, other networks' channels and locked channels refused); sync (added, removed, renamed, throttled); isolation between users; moving an older API-key connection onto Buffer; connecting a different Buffer account; disconnecting.

Run the DB suite only against a scratch database (it never reads `.env`):

```bash
DATABASE_URL=postgresql://…/scratch npx tsx --conditions=react-server --test tests/buffer-connection.test.ts
```

## Limitations (from Buffer's documentation)

- **No revocation endpoint.** Disconnect forgets the grant on our side only. Users remove the app in Buffer's settings to revoke it there.
- **No webhook** for a grant revoked in Buffer, or for channels added or removed. Both show up on the next request or on Sync now.
- **Rate limits:** an app client gets 100 requests per 15 min, 500 per 24 h and 15,000 per 30 days, plus 10, 25 and 100 per authorized user (only the first 1,000 users count). A publish uses about 2 to 5 requests and a sync 1 plus one per Buffer organization.
- Networks Buffer supports that the app writes no posts for (TikTok, Pinterest, …) are listed for reference only.
- The token response's `expires_in` is used as given. Buffer's example shows 3600 s, but its documentation states no fixed lifetime.
- Whether Buffer revokes an earlier grant when the same client is authorized again is not documented. This design no longer depends on it, since there is one grant per user.
