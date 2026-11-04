# Inbound mail through Cloudflare Email Routing

The other way identity addresses receive mail, besides our own IMAP server (`mailserver/README.md`). Cloudflare receives every email sent to `anything@INBOUND_EMAIL_DOMAIN`, and a catch-all rule hands each one to this Email Worker. The worker posts it, signed, to the app's `POST /api/mail/inbound`. There is no server to run, no port 25, and no polling: an email shows up in the inbox seconds after it is sent.

The two ways in can run side by side. Each one stores into the same `mail_messages` rows, parsed by the same code (`src/lib/mail/parse-message.ts`). When an email has already arrived one way, its Message-ID stops it from being stored again the other way.

| File | What it is |
| --- | --- |
| `src/index.ts` | The worker: the `email` handler and what it does with each answer |
| `src/deliver.ts` | Reading, signing and posting with retries; tested by the app's `tests/inbound-webhook.test.ts` |
| `wrangler.jsonc` | Worker settings; `WEBHOOK_URL` for production |
| `.dev.vars.example` | Local settings (copy to `.dev.vars`, which git ignores) |
| `src/app/api/mail/inbound/route.ts` (app) | The webhook: size cap, signature, validation |
| `src/lib/mail/webhook.ts` (app) | Routing to the identity and storing |

## What happens to an email

1. Cloudflare accepts the email (at most 25 MiB) and runs the worker once per recipient, with the envelope sender and recipient.
2. The worker reads at most the first 1.5 MB, the same amount IMAP sync downloads. The text comes first, so only late attachments are lost, and the stored email is marked `truncated`. It posts `{ to, from, rawSize, raw (base64) }` with `X-Mail-Timestamp` and `X-Mail-Signature: v1=<HMAC-SHA256 of "<timestamp>.<body>">`.
3. The app refuses a body over its cap (413), a bad signature or a timestamp more than 5 minutes off (401), and a malformed payload (400). It then reads the local part of `to` (`test` in `test@inbox.tdcai.com`) and looks it up in `inbound_addresses`. Current and replaced addresses both deliver, as with IMAP.
4. What the app answers decides what the sender sees:

| App answer | Worker | Sender sees |
| --- | --- | --- |
| `stored`, `duplicate` | accepts | delivered |
| `unrouted` (no identity has the address) | `setReject("Unknown recipient")` | a bounce, at once |
| 5xx, 429, timeout, network error | 3 tries (after 1 s, then 3 s) | temporary failure if all fail; the sender retries for days |
| other 4xx (setup problem) | no retry | temporary failure; the sender retries while you fix it |

The worker never uses `setReject` for a failure on our side, because that would bounce the email for good. It throws instead, and Cloudflare turns that into a temporary SMTP error. It also awaits the post inside the handler (not `ctx.waitUntil`), so the sender hears the real outcome.

**Duplicates.** Webhook mail is filed under its own `mail_sync_state` row (`cloudflare-email-routing`), which no IMAP pass touches. Its UID is a 53-bit SHA-256 digest of the recipient and the source, so the unique indexes do the work:
- `(mailbox, UIDVALIDITY, UID)` refuses the same delivery posted twice, for example a worker retry after a lost response.
- `(identity, Message-ID)` refuses an email the sender sent again, or one that already came in through IMAP.
- `(identity, content_hash)` refuses the same email without a `Message-ID`, or resent under a new one (sender, subject and both bodies as stored; see `contentHashOf` in `src/lib/mail/parse-message.ts`).

**Logs.** These never include content or addresses:
- App: `Inbound mail: stored, 4052979 bytes, 22 ms.`, plus a line for each refusal with its reason.
- Worker: `{"event":"delivered","outcome":"stored",…}` or `{"event":"failed","status":401,…}`.

## Settings

| Where | Variable | Local | Production |
| --- | --- | --- | --- |
| App | `INBOUND_EMAIL_DOMAIN` | `in.tdc.test` | the apex of a domain on Cloudflare used only for this, e.g. `tdcinbox.com` (see Production, step 3) |
| App | `MAIL_WEBHOOK_SECRET` | `openssl rand -base64 32` | a new value, in Vercel's environment variables |
| Worker | `WEBHOOK_URL` | `.dev.vars`: `http://localhost:3000/api/mail/inbound` | `wrangler.jsonc` `vars` |
| Worker | `WEBHOOK_SECRET` | `.dev.vars`: the app's `MAIL_WEBHOOK_SECRET` | `npx wrangler secret put WEBHOOK_SECRET` |

The `MAIL_IMAP_*` variables are independent. Leave them set to keep IMAP sync running too, or unset them to receive only through Cloudflare; the inbox then has nothing to pull, and Refresh just reloads. With `MAIL_WEBHOOK_SECRET` unset, `/api/mail/inbound` answers 404. Use a different secret for local and production.

## Local

Needs Node 22 or later. Cloudflare is not involved: `wrangler dev` runs the worker on your machine and simulates incoming mail.

```bash
# The app: add to .env, then restart `npm run dev`
INBOUND_EMAIL_DOMAIN="in.tdc.test"
MAIL_WEBHOOK_SECRET="<openssl rand -base64 32>"

# The worker
cd cloudflare/email-worker
npm install
cp .dev.vars.example .dev.vars     # set WEBHOOK_SECRET to the same value
npm run dev                        # http://localhost:8787
```

Open Inbox once, so your workspace gets its address (for example `test@in.tdc.test`), then send an email to it:

```bash
curl -X POST 'http://localhost:8787/cdn-cgi/local/email' \
  --url-query 'from=news@substack.com' --url-query 'to=test@in.tdc.test' \
  --data-binary $'From: news@substack.com\r\nSubject: Hello\r\nMessage-ID: <t1@substack.com>\r\n\r\nTest issue'
```

`Worker successfully processed email` means it was stored (check Inbox). A made-up address gives `Worker rejected email … Unknown recipient`. The local simulator needs a `from` and a `Message-ID`. Tests: `npx tsx --test tests/inbound-webhook.test.ts` (no database needed) and `cd cloudflare/email-worker && npm run typecheck`.

## Production

1. **The app** (Vercel → Settings → Environment Variables, Production): set `INBOUND_EMAIL_DOMAIN` and `MAIL_WEBHOOK_SECRET`, then redeploy. Check with `curl -i -X POST https://<app>/api/mail/inbound`: it should answer `401` (404 means the secret is not set). If Vercel Deployment Protection covers production, the worker cannot reach the route, so leave production unprotected or add a bypass.
2. **The worker**: check `WEBHOOK_URL` in `wrangler.jsonc`. It is the production app's URL; change it if the app has its own domain. Then:

   ```bash
   cd cloudflare/email-worker
   npx wrangler login
   npx wrangler secret put WEBHOOK_SECRET      # the same value as the app's MAIL_WEBHOOK_SECRET
   npm run deploy
   ```

   It has no web route (`workers_dev: false`), so only Email Routing can run it.
3. **Cloudflare Email Routing**. Catch-all rules work only on a zone's apex domain, not on a subdomain ([Cloudflare docs](https://developers.cloudflare.com/email-routing/setup/subdomains/)). So `INBOUND_EMAIL_DOMAIN` must be the apex of a zone on Cloudflare, used only for inbound mail: either a domain of its own (e.g. `tdcinbox.com`), or `tdcai.com` itself if nothing else receives mail there. The worker refuses every address that is not an identity's, so a domain that also has people's mailboxes would bounce their mail.
   - The domain's nameservers must be Cloudflare's (dashboard → Add a domain, then change the nameservers at the registrar).
   - Email → Email Routing → enable it. Cloudflare adds its MX and SPF records and asks you to remove any other MX record, including a null MX (`0 .`). Remove it.
   - Routing rules → Catch-all address: set the action to **Send to a Worker**, pick `tdc-inbound-mail`, and turn it on. No destination addresses are needed.
4. **Check**:
   - `dig +short MX <domain>` shows only Cloudflare's hosts (`route1/2/3.mx.cloudflare.net`).
   - Send from Gmail to your own address (shown in Inbox). It appears within seconds.
   - Email Routing → Activity log shows it as *Delivered*. `npm run tail` and the app's logs show `stored`.
   - An email to a made-up address bounces with *Unknown recipient*.

### Switching from the IMAP server

Mail goes wherever the MX record points, so the switch is the DNS change in step 3.
- Senders that looked up the old MX keep delivering to `mail.tdcai.com` for up to the record's TTL, and senders retrying earlier failures do so for days. Keep the mail server and IMAP sync running for about a week, so those emails still arrive. Duplicates between the two are refused.
- Then unset `MAIL_IMAP_*` and stop the server.
- To switch back, restore the old MX record and turn off the catch-all rule. Nothing in the database changes either way.

### Running it

- **Failures** show in Email Routing's Activity log, in the worker's logs (`npm run tail`, or Workers → `tdc-inbound-mail` → Logs, kept because `observability` is on), and as `Inbound mail webhook …` lines in the app's logs.
  - A run of 401s means the two secrets differ.
  - 5xx means the app or the database failed; senders retry for days.
- **Rotating the secret**: set the new value on the worker (`wrangler secret put`) and on the app, then redeploy the app. Emails that fail in between get a temporary failure and are retried, so nothing is lost.
- **Limits**: Email Routing accepts emails up to 25 MiB; the app keeps the first 1.5 MB (`MAIL_SYNC_SETTINGS.maxSourceBytes`, and `MAX_SOURCE_BYTES` in `src/deliver.ts`; change them together). An email runs one short worker invocation, well inside the Workers free plan.
