# Inbound mail server

Our own receive-only mail server for identity addresses: every email sent to `anything@INBOUND_DOMAIN` (in production `inbox.tdcai.com`, e.g. `test@inbox.tdcai.com`) lands in one mailbox, `catchall@INBOUND_DOMAIN`, which the app reads over IMAP. It runs [docker-mailserver](https://github.com/docker-mailserver/docker-mailserver) 16.0.1 (Postfix for SMTP, Dovecot for IMAP, Rspamd for spam). It never sends mail.

Cloudflare Email Routing can deliver to the same inbox instead, or as well, without a server: see `cloudflare/email-worker/README.md`.

| File | What it is |
| --- | --- |
| `compose.yaml` | The server, for local use: SMTP on 2525, IMAPS on 9993, a self-signed certificate |
| `compose.prod.yaml` | Production overrides: ports 25 and 993, Let's Encrypt, Fail2Ban |
| `mailserver.env` | Receive-only settings (no secrets) |
| `setup.sh` | One-time setup: catch-all rule, local certificate, the mailbox, then start |
| `$MAIL_DATA_DIR` (default `~/.tdc-mailserver`) | Mail, accounts, certificates and logs. Kept outside the repository: they hold email and secrets, and the app's build reads the repository's files |

## How an email finds its identity

1. Postfix accepts mail for any address at the domain and rewrites it (`$MAIL_DATA_DIR/config/postfix-regexp.cf`):
   `test@inbox.tdcai.com` → `catchall+test@inbox.tdcai.com`
2. Dovecot stores it in the `catchall` mailbox and adds `Delivered-To: catchall+test@inbox.tdcai.com`.
3. The app reads the part after `+` (`test`) and looks it up in `inbound_addresses` to find the workspace. This works when the newsletter's own `To:` shows a list address instead (BCC-style sending), because `Delivered-To` comes from the SMTP envelope.

Dovecot only adds `Delivered-To` when a delivery has one recipient, so Postfix delivers each recipient separately (`lmtp_destination_recipient_limit = 1` in `$MAIL_DATA_DIR/config/postfix-main.cf`, written by `setup.sh`). An email sent to several identities at once then becomes one copy per identity.

Mail for other domains is refused (`Relay access denied`), and so is mail from sender domains that do not exist in DNS.

## Local

```bash
cd mailserver
./setup.sh in.tdc.test
```

It prints the app's settings for `.env` (see [Connecting the app](#connecting-the-app)), including the mailbox password, which is shown only once. The server is reachable at:

- SMTP `localhost:2525`: send test mail here.
- IMAPS `localhost:9993`, user `catchall@in.tdc.test`. The certificate is for `mail.tdc.test` and `localhost`, signed by the local CA `~/.tdc-mailserver/config/ssl/demoCA/cacert.pem`, which the app trusts through `MAIL_IMAP_TLS_CA_FILE`. Certificate checks stay on.

Send a test email (the sender's domain must exist in DNS, or Postfix refuses it):

```bash
python3 - <<'EOF'
import smtplib
from email.message import EmailMessage
m = EmailMessage()
m["From"], m["To"], m["Subject"] = "news@substack.com", "test@in.tdc.test", "Hello"
m.set_content("Test issue")
with smtplib.SMTP("localhost", 2525) as s:
    s.send_message(m)
EOF
```

To test with real newsletter content, send an issue built from a newsletter's public RSS feed. Its stories link to real articles, so extraction, the Knowledge base and ideas have real material to work on:

```bash
python3 mailserver/send-test-issue.py example@in.tdc.test https://www.modernretail.co/feed/ "Modern Retail"
python3 mailserver/send-test-issue.py example@in.tdc.test https://oliverpatel.substack.com/feed "Enterprise AI Governance" --post   # one long post, as Substack sends it
```

Use your own address from the Inbox page. The email appears after the next sync (within a minute, or press Refresh). If your `.env` receives through the Cloudflare webhook instead of IMAP, run the worker's simulator (`cloudflare/email-worker/README.md`, Local) and add `--worker`: the email then arrives at once.

Useful commands:

```bash
docker logs -f tdc-mailserver                                  # server log
docker exec tdc-mailserver tail -f /var/log/mail/mail.log      # each delivery
docker exec tdc-mailserver postmap -q someone@in.tdc.test pcre:/etc/postfix/regexp   # test the rewrite
docker compose up -d --force-recreate                          # apply changed config or certificates
docker compose down                                            # stop (mail is kept)
docker compose down && sudo rm -rf ~/.tdc-mailserver           # start over (files are owned by the container's users)
```

## Connecting the app

Put the values `setup.sh` printed in the app's `.env` (documented in `.env.example`):

| Variable | Local | Production |
| --- | --- | --- |
| `INBOUND_EMAIL_DOMAIN` | `in.tdc.test` | `inbox.tdcai.com` |
| `MAIL_IMAP_HOST` | `localhost` | `mail.tdcai.com` |
| `MAIL_IMAP_PORT` | `9993` | `993` |
| `MAIL_IMAP_USER` | `catchall@in.tdc.test` | `catchall@inbox.tdcai.com` |
| `MAIL_IMAP_PASSWORD` | printed by `setup.sh` | printed by `setup.sh`; keep it in a secret store |
| `MAIL_IMAP_TLS_CA_FILE` | `~/.tdc-mailserver/config/ssl/demoCA/cacert.pem` (full path) | unset (Let's Encrypt is trusted) |

Then restart the app. What it does:

- **Addresses** (`src/lib/mail/addresses.ts`). Opening Inbox gives the workspace an address named after the person who owns it, from the name and email they sign in with, never from the LinkedIn identity, so editing that identity leaves the address alone. For test Sisodia the app tries `test`, then `test.sisodia`, the username of her sign-in email, other forms of her name, and only then `test.sisodia2` and so on. There are no random characters. The page shows the address with Copy and Change: Change picks another name at the domain (`marketing@inbox.tdcai.com`). The old address keeps delivering to the same workspace. An address is never given to another workspace, not after a change and not after its workspace is deleted, because newsletters send sign-in links to it. A workspace can hold 5 addresses. Mail-system names (`postmaster`, `abuse`, `catchall`, …) and the names certificate authorities email (`admin`, `webmaster`, `hostmaster`, …) are reserved. Only the part before the @ is stored, so changing `INBOUND_EMAIL_DOMAIN` moves every address to the new domain.
- **Sync** (`src/lib/mail/sync.ts`): every minute, and on **Refresh**, one pass reads the new UIDs of `INBOX` (read-only), parses each email and stores it in `mail_messages` for the identity named in its `Delivered-To`. A copy for an address no identity has is skipped and stays on the server. The cursor and the last outcome are in `mail_sync_state`; a failed pass shows its reason in the inbox and retries after 1 minute, doubling up to an hour.
- **Duplicates** are refused by the database: the same UID twice, the same `Message-ID` for the same identity (which also covers re-reading the mailbox after a UIDVALIDITY change), or the same content for the same identity: a SHA-256 of the sender, subject and both bodies as stored (`content_hash`), which catches an email without a `Message-ID` delivered again or one resent under a new `Message-ID`. Only an exact copy matches, so two different issues are never taken for one.
- **Extraction** (`src/lib/intel/`), after each sync and on the same minute tick (on Vercel, through `/api/cron/jobs` and Refresh):
  1. Each new email is cleaned. Hidden preview text, tracking pixels and the footer are dropped, and its links are numbered.
  2. The `newsletter-digest` skill (Haiku) tells newsletters from confirmations, welcome emails and promotions. For a newsletter it lists the stories, each with the newsletter's own words, copied word for word, and its link. Without an AI key, each link becomes a story.
  3. Each story's link is followed through click-tracker redirects, without the reader's tokens. Unsubscribe, confirm, account, share and social links are never followed.
  4. The article is read once for all workspaces (`intel_articles`, one row per address) and summarised with verbatim claims (the `knowledge-extraction` skill).
  5. Each story is embedded (headline, the newsletter's words and the article summary), so a run can take the stories closest to its goals (`src/lib/intel/retrieval.ts`). This needs `AI_GATEWAY_API_KEY`; without it, stories are matched by the words they share with the goals.
  - **Knowledge base → From newsletters** (Account Setup → Knowledge, `?view=newsletters`): every story with its article, searchable. Nothing needs saving: runs use a story automatically while it is recent (30 days), not sponsored, from a newsletter still received, and relevant to the run's goals. Each story has **Keep**, which uses it past that as long as it is relevant (an evergreen report), and **Don't use**, which keeps it out of ideas for good. Both are a setting on the story (`intel_mentions.use_in_ideas`), so nothing is copied. `/library` redirects here.
  - **New versions of an issue:** an email from the same newsletter within 3 days of another, with at least 60% of their stories the same (by article, link or headline), is a new version of that issue: a correction, a resend, or the issue at a second address. Both emails stay in the inbox, the older one notes the newer, and a story both carry is kept once, with the newer version's words. A story only the older one has stays with it. Daily or weekly issues share only recurring sections, so they are left alone. Articles are read once and not refreshed, and a story saved to the Knowledge base keeps the text that was saved.
  - **Dropped or skipped:** pages that are gone, not web pages, or too thin to read (paywalls, sign-in pages) are skipped, and the story keeps the newsletter's words.
  - **The same article from several newsletters** is stored and read once: one row per address, after redirects and without tracking parameters. A page with the same text at another address, or one that names or redirects to an address already read, becomes a duplicate: its stories move to the first copy, its text is not kept, and the model is not called for it. Two copies read at the same moment are checked again under a lock, so only one is kept. Each newsletter keeps its own story (its words about the article), but a run takes the article once, and the Knowledge base and a run's evidence treat `https://www.x.com/a/` and `x.com/a?utm_source=…` as the same article.
  - **Retries:** an email or article that fails is tried again after 5 minutes, doubling up to 12 hours. A failure that may pass (the AI model timed out, rate-limited, overloaded, down or out of budget, or a site down) is tried for about a week (20 attempts); the inbox shows the reason and "Trying again automatically". On the last attempt a busy model is done without: the email gets the heuristic digest (each link a story) and the article a heuristic summary, rather than nothing. Any other error marks it failed after 5 attempts, with Try again in the inbox.
  - **Unreadable emails:** an email whose source cannot be parsed is listed from its envelope and shown as failed with the reason; retrying cannot help, as the same bytes fail the same way.
  - **Embeddings:** with the embedding model down or busy, stories wait for the next pass and are matched by words meanwhile. When the model works but refuses a story, the others are embedded one by one and the refused one is matched by words; a new model tries it again.
  - **Unsubscribing:** "I unsubscribed" under an email marks its sender (the exact address) as unsubscribed for the workspace. Nothing is deleted: its emails stay in the inbox, its stories in the Knowledge base (labelled "Unsubscribed: not used for ideas"), and a story kept with Keep is still used; normal retention removes the rest in time. From then on, runs do not use its stories, and an email that still arrives from it is listed but not read (no model call). Undo makes its stories count again and reads the emails skipped meanwhile from the last 30 days. The Newsletters page's "Mark as Unsubscribed" only records the status: a discovered newsletter is not tied to the address its mail comes from.
  - **Storage:** only what something uses is kept. A story is embedded only while a run can take it: not sponsored and from the freshness window (30 days), or kept, and never one marked Don't use. Once a day (`src/lib/intel/tidy.ts`):
    - embeddings of stories past that window by more than 15 days, or sponsored, are dropped unless the story is kept, and always for one marked Don't use (the story stays, searchable by its words);
    - an article no story has pointed to for 7 days is deleted with its copies;
    - an email's HTML is cleared 30 days after it arrived, once it is extracted and has a text version: the inbox then shows the text, and its stories stay;
    - an article's full text is cleared 180 days after it was read: its title, summary, quoted claims and link stay, which is all ideas use.

    No email, story or Knowledge base document is deleted. The limits are `RETENTION_SETTINGS` in `src/lib/intel/settings.ts`.
  - **Old news in the Knowledge base:** an article saved from the former Library ("Save to Knowledge base", now replaced by Keep) is stored as `newsletter`, not `url`. 180 days after it was published (or saved, without a date) it stays in the Knowledge base, labelled "Over 6 months old · not used for ideas", but no generation reads it any more, so old figures and "latest" claims do not pass for current ones. Documents added by hand are never aged.
  - **In the inbox:** the reading pane shows the summary, topics and stories, with a Try again button after a failure.
  - **Cost:** about 1 cent of Haiku for each email's digest, and about 1 cent for each article read for the first time.
- **Isolation.** The inbox reads only the signed-in user's own identity's mail.

## Production

1. **A server** with a static public IP that accepts inbound port 25: a small VM is enough (e.g. GCP `e2-small`). Cloud Run cannot receive SMTP, and home or office connections usually block port 25. Outbound port 25 is not needed: nothing is sent.
2. **DNS** for `tdcai.com` (its own MX records, if any, are not touched):

   ```
   mail.tdcai.com     A    <server's static IP>
   inbox.tdcai.com    MX   10 mail.tdcai.com
   inbox.tdcai.com    TXT  "v=spf1 -all"
   ```

   - The MX must name a host with an A record, not a CNAME.
   - Remove any other MX record for `inbox.tdcai.com`. In particular, remove a "null MX" (`0 .`): parked domains often have one, and it tells every sender the domain takes no mail.
   - A wildcard record (`*.tdcai.com`) does not replace the explicit `mail` A record.
   - The SPF record says nothing is ever sent from the inbox domain, which is true: it only receives.
   - On Cloudflare, set the A record to **DNS only** (grey cloud): its proxy carries web traffic only, not mail.
3. **Firewall**:
   - 25 open to everyone (mail arrives here).
   - 993 open only to the app's servers. Vercel's functions have no fixed addresses, so with the app on Vercel it stays open to all, protected by TLS, the mailbox password and Fail2Ban.
   - 80 open while certbot issues or renews the certificate.
   - Everything else closed.
4. **Certificate** on the host: `sudo certbot certonly --standalone -d mail.tdcai.com`. Certbot renews it by itself, and the server picks up the renewed certificate.
5. **Start**: `MAIL_HOSTNAME=mail.tdcai.com MAIL_DATA_DIR=/srv/mailserver ./setup.sh inbox.tdcai.com --production` (pass the same `MAIL_DATA_DIR` to later `docker compose` commands), then put the printed settings in the app's environment (a secret store, not a file).
6. **Sync trigger, when the app runs on Vercel**: it has no timers, so the inbox only syncs on Refresh or when `/api/cron/jobs` is called (daily in `vercel.json`). Call it every 2 minutes from the mail server, with the app's `CRON_SECRET`:

   ```bash
   (crontab -l 2>/dev/null; echo '*/2 * * * * curl -fsS -m 60 -H "Authorization: Bearer <CRON_SECRET>" https://<app-url>/api/cron/jobs >/dev/null') | crontab -
   ```

7. **Check from outside**:
   - `dig +short MX inbox.tdcai.com` shows only `10 mail.tdcai.com.`, and `dig +short A mail.tdcai.com` shows the server's IP.
   - `nc -vz mail.tdcai.com 25` answers.
   - Mail sent from a Gmail account to your own address (shown in Inbox) arrives there after the next sync.
   - Mail to another domain is refused (`Relay access denied`).

### Running it

- **Backups**: back up `$MAIL_DATA_DIR` (at least `mail-data/` and `config/`).
- **Updates**: bump the pinned image tag after reading the upstream changelog, then `docker compose -f compose.yaml -f compose.prod.yaml up -d`.
- **Downtime**: sending servers retry for about 4–5 days, so short downtime loses no mail; longer downtime does. Monitor port 25 and the container's health (`docker inspect -f '{{.State.Health.Status}}' tdc-mailserver`).
- **Disk**: the app keeps its own copy of every email. Mail on the server can be pruned once it is synced; a retention rule is not set up yet.
