# Automated AI Content Intelligence: Implementation Plan

**Status:** Proposal, awaiting approval. No code has been changed.
**Branch inspected:** `feat/linkedin` at `fdf6e91` (2026-10-27)

One dedicated mailbox receives newsletters. The app reads it on a schedule, extracts the stories and their links, fetches and cleans the articles, deduplicates them and stores them in a searchable knowledge base. Runs then use that knowledge base (RAG) to propose fresh ideas with source references. Approved ideas become platform-specific posts, which can be edited, regenerated and approved.

---

## 1. What's in the codebase today

**Stack:** Next.js 16.3 (App Router, Server Actions), React 19 and TypeScript. Data is in Drizzle and Postgres 16 with pgvector; sign-in is Better Auth (Google, LinkedIn, passkeys, admin plugin). AI calls go through AI SDK v7: Sonnet 5.5 for ideation and drafting, Haiku 4.5 for extraction (`src/lib/models.ts`). Embeddings go through the AI Gateway (`openai/text-embedding-3-small`, 1536 dimensions). Serper handles search; Jina Reader plus cheerio handle scraping. Scheduled work uses node-cron. Deployment is Cloud Run through Terraform (`terraform/`): one always-on instance, with an optional `separate_worker` service (`APP_ROLE=worker`).

Most of what this feature needs already exists, so the plan extends those parts rather than adding infrastructure:

| Need | Existing piece to reuse |
|---|---|
| Scheduled jobs | `src/jobs/scheduler.ts` (node-cron, 5-minute tick), `src/instrumentation.ts`, `runsJobsHere()` in `src/jobs/role.ts` (the `APP_ROLE` split) |
| Retries and crash recovery | Conditional-update claims, heartbeats and stale-claim takeover in `src/lib/ai/pipeline/drafting-claim.ts` and `src/lib/ai/run-lifecycle.ts`; lease-style claims in `src/jobs/schedule-claim.ts` |
| Safe URL fetching | `scrapeUrl` in `src/lib/scraper.ts` (Jina, then cheerio, with `looksLikePlaceholderPage`); `safeFetch` in `src/lib/safe-url.ts` (SSRF check on every redirect hop); `stripTrackingParams`, `normalizeUrlForCompare`, `isGenericPage` in `src/lib/urls.ts` |
| Chunking, embedding, vector search | `src/lib/ai/chunking.ts`, `src/lib/ai/embeddings.ts` (HNSW cosine index on `document_chunks`) |
| LLM calls | The skill framework in `src/lib/ai/run-skill.ts` (structured output, salvage of near-miss answers, cost accounting); the knowledge-extraction skill (summary, topics, verbatim-quote claims, heuristic fallback) |
| RAG to ideas with sources | `buildGroundingCorpus` in `src/lib/ai/pipeline/grounding-corpus.ts`; the ideation guard checks every claim against a quote. Ideas store `supportingEvidence[]` with URL, title, date and quote, and `run-idea-card.tsx` already renders them as links |
| Edit, approve, reject posts | `updateDraft` (re-runs the checks), `approveDraft`, `rejectDraft` (writes feedback) in `src/app/(app)/posts/actions.ts` |
| Copy protection | The linter's `copied_source_text` rule (8 words in a row from a source) in `src/lib/lint/` |
| Access control | `requireUser`, `requireAdmin`, `requireIdentityId` and the ownership guards; `tests/auth-guards.test.ts` checks that every Server Action and API route starts with a session check |

**What's missing:**

- No email ingestion of any kind.
- The knowledge base is per identity and filled by hand. `loadGenerationContext` loads *every* knowledge document of the identity into each run, and `buildGroundingCorpus` puts all their summaries and claims into the corpus, so newsletters cannot simply be added as knowledge documents.
- No article deduplication.
- No way to regenerate a post's text (only its image).
- Posts are LinkedIn-only: the drafting prompt, the 3,000-character limit, the preview and the first-comment link strategy all assume LinkedIn.
- `CRON_SECRET` is defined in `src/env.ts` but nothing reads it, and there is no `src/app/api/cron/` route yet.
- `requireAdmin()` exists in `src/lib/session.ts` but no page uses it yet.
- Sign-up is open to any Google or LinkedIn account. This matters for who can read a shared corpus (§15).

---

## 2. Recommended architecture

Add a new `intel` area inside the same app, database and worker. The only new external dependency is the mailbox.

| Decision | Recommendation | Why, and the alternatives |
|---|---|---|
| Mailbox access | IMAP over TLS, read-only, using `imapflow` and `mailparser` behind a `MailSource` interface | Works with any provider, polling fits the existing scheduler, and no tokens sit in the database. The Gmail API needs a restricted scope and Google verification, and refresh tokens expire after 7 days in Testing mode. An inbound webhook (Postmark, SendGrid) is a good later option but adds a vendor and DNS work. |
| Job queue | The tables themselves: each message and article row carries `status`, `attempts`, `next_attempt_at` and `locked_at`, and workers claim rows with a conditional `UPDATE` / `FOR UPDATE SKIP LOCKED` | Same pattern as the run queue and the drafting claims, the state is visible in the UI, and there is no Redis or pg-boss. |
| Corpus scope | One shared intelligence corpus with no `account_id`. Each identity retrieves from it using its own goals | Matches "one dedicated email account". Needs your confirmation (§15). |
| New tables vs. `knowledge_documents` | Separate `intel_*` tables | `knowledge_documents` is per identity, hand-curated, loaded whole into every run and graded "verified". Newsletter content is third-party and must be graded "sourced", like web results. Mixing them would flood the corpus and weaken the ownership filters and grounding rules. |
| Vector store | The existing pgvector setup with the same embedding model | No new infrastructure. |
| Search | Postgres full-text search for the UI (generated `tsvector` with a GIN index), vectors for RAG, hybrid search in Phase 4 | Cheap, and no new service. |
| Article extraction | A new `scrapeArticle()` in `src/lib/scraper.ts`: fetch the HTML directly first (to read the canonical URL, date and author), fall back to Jina. `scrapeUrl` stays unchanged | Readability with jsdom is heavy, and paid extractors are not needed for an MVP. |
| Models | Haiku 4.5 (the existing `extraction` stage) for newsletter digests and article enrichment; ideation and drafting stay on Sonnet 5.5 | Keeps cost down. |
| Multiple platforms | The LinkedIn draft stays the master; other platforms are adaptations of it, written by a new `post-adaptation` skill | Leaves the tuned LinkedIn pipeline and the idea state machine untouched, and keeps facts consistent across platforms. |

---

## 3. Workflow

```
Newsletter senders ──email──▶ Dedicated mailbox (IMAP, read-only)
                                   │  scheduler (every 15 min), POST /api/cron/ingest,
                                   │  or "Sync now" (admin)
                                   ▼
[1] SYNC     imapflow: fetch UIDs after the saved cursor → intel_messages (pending)
             dedup: (mailbox, Message-ID)
[2] PARSE    mailparser + cheerio → clean text with [n] link markers; drop footer,
             unsubscribe, social and tracking pixels; find or create the source; DKIM check
[3] DIGEST   newsletter-digest skill (Haiku) → items {headline, blurb, link, sponsored}
             → intel_articles (pending, keyed by canonical URL) + intel_mentions
[4] FETCH    resolve tracking redirects (safeFetch on every hop) → canonical URL → scrapeArticle
             dedup: canonical URL → content hash → (Phase 4) embedding similarity
             transient error → retry with backoff; permanent → use the newsletter blurb
[5] ENRICH   knowledge-extraction skill (Haiku) → summary, topics, verbatim claims
[6] INDEX    chunkText → embedMany → intel_chunks (pgvector) + tsvector
                                   │
             Intelligence knowledge base ──▶ /intelligence (search, filter, sources)
                                   │
[7] IDEATE   existing run, per identity (scheduled, manual, or "Generate ideas from these articles"):
             goals → retrieveIntelPassages (recent) + knowledge base + web
             → buildGroundingCorpus (new origin 'newsletter') → ideation skill → guard
             → ideas with source references + idea_intel_sources
                                   │
             Human gate: approve or reject ideas (existing /ideas)
                                   ▼
[8] DRAFT    existing drafting queue → LinkedIn master draft (checks, image)
             → post-adaptation skill → X and other platform drafts
             → /posts: edit · regenerate (with instruction) · adapt · approve · schedule
```

Nothing is published automatically, as today.

---

## 4. Database schema

### Migration `0026_intelligence` (Phase 1): new tables only

```
intel_mailboxes — sync state for the inbox; credentials stay in env / Secret Manager
  id uuid pk · address text unique
  uid_validity bigint · last_uid bigint                 -- IMAP cursor
  last_synced_at · last_error text · consecutive_failures int
  lease_until timestamptz                               -- one ingestion pass at a time
  sync_requested_at timestamptz                         -- "Sync now" from the web service
  created_at · updated_at

intel_sources — one row per sender, created automatically on its first email
  id · sender_key text unique                           -- List-Id header, else lower(from address)
  name · from_address · domain
  status varchar(20) 'pending'|'active'|'muted'
  fetch_links boolean default true                      -- false = newsletter text only (paywalls)
  dkim_verified boolean · message_count int · last_received_at
  created_at · updated_at

intel_messages — one row per email (queue for stage 1)
  id · mailbox_id fk cascade · source_id fk set null
  message_id text (RFC 5322) · imap_uid bigint · subject · from_address · received_at
  auth_passed boolean                                   -- from the Authentication-Results header
  html_body text (size-capped; cleared by retention) · text_body text (cleaned, [n] markers)
  status 'pending'|'processing'|'processed'|'ignored'|'failed'
  attempts · next_attempt_at · locked_at · last_error · item_count
  UNIQUE(mailbox_id, message_id) · idx(status, next_attempt_at) · idx(source_id, received_at)

intel_articles — the deduplicated unit of knowledge (queue for stage 2)
  id · kind 'web_article'|'newsletter_item'
  canonical_url text · content_hash varchar(64) · duplicate_of_id fk self set null
  title · site_name · author · published_at (falls back to email received_at) · first_seen_at
  content text (≤50k chars) · summary · topics jsonb · key_claims jsonb   -- same shapes as knowledge_documents
  word_count · mention_count int                        -- how many newsletters linked it
  status 'pending'|'fetching'|'fetched'|'indexed'|'skipped'|'failed'|'duplicate'|'excluded'
  attempts · next_attempt_at · locked_at · last_error
  search_tsv tsvector GENERATED (title A, summary B, content C)
  UNIQUE(canonical_url) WHERE NOT NULL · idx(content_hash) · idx(status, next_attempt_at)
  idx(published_at desc) · GIN(search_tsv)

intel_mentions — where each article appeared (links messages and articles)
  id · article_id fk cascade · message_id fk cascade · source_id fk set null
  headline · blurb (the newsletter's own summary, also the fallback content)
  position int · is_sponsored boolean · created_at
  UNIQUE(message_id, article_id) · idx(article_id)

intel_chunks — embeddings, mirroring document_chunks
  id · article_id fk cascade · chunk_index · content · embedding vector(1536) · embedding_model
  published_at (copied here for recency filters) · created_at
  HNSW(embedding vector_cosine_ops) · UNIQUE(article_id, chunk_index) · idx(published_at)

intel_ingestion_runs — one row per pass, for the status page
  id · trigger 'schedule'|'cron'|'manual' · status 'running'|'completed'|'partial'|'failed'
  started_at · finished_at · stats jsonb · token_counts jsonb · cost_usd numeric(10,4)
  errors jsonb [{stage, ref, message}] (capped)

idea_intel_sources — which articles each idea drew on
  idea_id fk cascade · article_id fk cascade · PK(idea_id, article_id) · idx(article_id)
```

The `tsvector` column is declared in Drizzle with a small `customType` and `.generatedAlwaysAs(sql\`…\`)`. The migration is generated with `npm run db:generate` and renamed, as the earlier ones were.

### Migration `0027_post_platforms` (Phase 3): additive changes to existing tables

```
post_drafts  + platform varchar(20) NOT NULL DEFAULT 'linkedin'   -- existing rows backfill to linkedin
             + parent_draft_id uuid fk self set null              -- which master this draft adapts
             + thread_parts jsonb string[] null                   -- X threads
             UNIQUE(parent_draft_id, platform) WHERE parent_draft_id IS NOT NULL
post_revisions (new) id · draft_id fk cascade · hook · body · first_comment
                     · origin 'ai'|'human' · instruction · created_at
ideas        + target_platforms jsonb default '["linkedin"]'
runs.research_config gains a seedArticleIds key (jsonb, so no migration)
```

### Relationships

```
intel_mailboxes 1─* intel_messages *─1 intel_sources
intel_messages  1─* intel_mentions *─1 intel_articles 1─* intel_chunks
intel_articles  1─* idea_intel_sources *─1 ideas
post_drafts     1─* post_drafts (through parent_draft_id), and post_drafts 1─* post_revisions
```

---

## 5. APIs

No public REST API is needed. The app is built on Server Actions. Every new action starts with `requireUser()`; admin actions then check the admin role (see "Access-test changes" below).

| Action | File | Who | Purpose |
|---|---|---|---|
| `loadMoreArticles(cursor, filters)` | `src/app/(app)/intelligence/actions.ts` | user | Paginated feed and full-text search. The first page loads through `intelligence-data.ts`, as the Posts page does |
| `getArticleDetail(id)` | same | user | Content, claims, which newsletters mentioned it, which ideas used it |
| `generateIdeasFromArticles({articleIds, goalIds})` | same | identity owner | Queues a run with `seedArticleIds`, reusing `enqueueRun` and `processRunImmediately` |
| `syncInboxNow()` | `src/app/(app)/settings/intelligence/actions.ts` | admin | Sets `sync_requested_at`; the worker's next tick (within a minute) starts a pass. When this process runs jobs (`runsJobsHere()`), it also starts the pass at once with `after()`. The lease prevents two passes overlapping |
| `getIngestionStatus()` | same | admin | Mailbox state, recent passes and queue counts, for polling |
| `updateSource(id, {name, status, fetchLinks})` | same | admin | Approve, mute or rename a sender |
| `retryIntelItem(kind, id)`, `excludeArticle(id)` | same | admin | Reset an item to pending, or keep it out of RAG |
| `triggerNewRun(goalIds, {seedArticleIds?})` | `src/app/(app)/runs/actions.ts` (extend) | owner | Optional seed articles for a run |
| `draftSelectedIdeas({…, platforms})` | `src/app/(app)/ideas/actions.ts` (extend) | owner | Phase 3 |
| `regenerateDraft(id, {instruction?})`, `adaptDraft(id, platform)` | `src/app/(app)/posts/actions.ts` | owner | Phase 3 |

**Route handler:** a new `POST /api/cron/ingest` (`src/app/api/cron/ingest/route.ts`) runs `runIngestionPass({ trigger: 'cron' })` for an external scheduler (for example Cloud Scheduler if the worker is ever not always-on). It requires `Authorization: Bearer <CRON_SECRET>`, compared in constant time, and answers 404 when `CRON_SECRET` is unset. An inbound-email webhook route could come later if you switch from polling to push.

**Access-test changes:** `tests/auth-guards.test.ts` currently requires every action to call `requireUser()` first and every API route to call `getSessionUser()` first. Two small updates keep it meaningful:

- Accept `requireAdmin()` as a first call (it calls `requireUser()` itself).
- Exempt `src/app/api/cron/**` with a stated reason, and instead assert that those routes check `CRON_SECRET` first.

**Internal modules:**

```
src/lib/intel/
  settings.ts          INTEL_SETTINGS (caps and windows, like RESEARCH_SETTINGS), isIntelConfigured
  mail/source.ts       MailSource interface: fetchNew(cursor) → RawMessage[]
  mail/imap.ts         imapflow: read-only EXAMINE, UID search, size caps, timeouts
  mail/parse.ts        mailparser → headers, html, text, List-Id, List-Unsubscribe, auth results
  email-content.ts     cheerio: HTML → clean text with [n] link markers
  sources.ts           find-or-create sender, status rules
  links.ts             link filtering, redirect resolution through safeFetch, canonical URLs
  article-fetch.ts     scrapeArticle + sorting errors into transient and permanent
  dedup.ts             text normalisation, content hash, near-duplicates (Phase 4)
  claims.ts            claim due rows, backoff, mark transient / permanent failure
  index-article.ts     chunk + embed (shares a helper extracted from embeddings.ts)
  retrieval.ts         retrieveIntelPassages(ctx, {freshnessDays, seedArticleIds})
  search.ts            full-text search (hybrid in Phase 4)
src/lib/ai/skills/newsletter-digest/   index · prompt · schema · guard · fallback (same layout as other skills)
src/lib/ai/skills/post-adaptation/     Phase 3
src/lib/platforms.ts                   Phase 3 platform registry
src/jobs/ingestion.ts                  runIngestionPass: lease → sync → digest → fetch → enrich/index → record
```

The scheduler gets a second tick that runs every minute and starts a pass when one is due: 15 minutes since the last pass, or `sync_requested_at` set. Like the existing tick, it only runs where `runsJobsHere()` is true.

---

## 6. Integrations and configuration

**New dependencies:** `imapflow` and `mailparser` (plus `@types/mailparser`). Both are MIT-licensed and maintained by the Nodemailer author. Add them with pnpm: `pnpm-lock.yaml` is the lockfile the Dockerfile uses.

**New environment variables** go in `src/env.ts`, `.env.example` and the Terraform secrets (`optional_secrets` in `terraform/main.tf`):

- `INTEL_IMAP_HOST`
- `INTEL_IMAP_PORT=993`
- `INTEL_IMAP_USER`
- `INTEL_IMAP_PASSWORD` (a secret)
- `INTEL_IMAP_FOLDER=INBOX`
- `JINA_API_KEY` (optional; Jina is rate-limited without a key)

When the IMAP values are unset the feature is off, the same way `isWebSearchConfigured` works for search. `CRON_SECRET` already exists in `src/env.ts` and only needs a value.

**Existing services it reuses:** Anthropic, the AI Gateway, Jina, pgvector, Cloud SQL and Secret Manager. Embeddings need `AI_GATEWAY_API_KEY`; without it, RAG falls back to full-text search.

**Mail providers:**

- Gmail / Google Workspace: use an app password. This requires 2-Step Verification, and Workspace admins can turn app passwords off.
- Microsoft 365: password-based IMAP no longer works, so it needs OAuth2 (XOAUTH2). imapflow supports this, but it would be a Phase 4 adapter.

**Cost:** estimated from the rates in `src/lib/ai/usage.ts` (Haiku 4.5 at $1 / $5 per million tokens). At 20 newsletters a day producing about 100 unique articles, digest plus extraction comes to roughly $1–2 a day. Embeddings cost very little, and ideation cost barely changes.

---

## 7. Ingestion: cleaning, deduplication, retries and errors

### Cleaning

- **Emails:**
  - Remove hidden preheader text, zero-width characters, 1×1 tracking pixels and "view in browser" links.
  - Cut the footer: everything after "unsubscribe", "you received this because" or "manage preferences".
  - Number the remaining links as `[n]` with their anchor text.
- **Link filtering:**
  - Drop `mailto:`/`tel:` links, social profiles, app stores and image-only links.
  - Drop the URLs in the `List-Unsubscribe` header.
  - Drop anything whose text or URL matches unsubscribe, preferences, confirm, referral, sponsor or advertise.
  - Drop homepages (`isGenericPage`).
  - Keep at most 25 links per email.
- **Digest skill:** the guard keeps only link numbers that exist and blurbs that appear in the email text. A heuristic fallback (headings and the links next to them) covers the case where no AI is configured.
- **Articles:**
  - Resolve redirects with `safeFetch`, GET only, raising its `maxRedirects` from the default 3 to about 6 (newsletter trackers often chain several hops). Strip tracking parameters, and prefer `rel=canonical` or `og:url`.
  - Prefer the text in `article`, `main` or `[itemprop=articleBody]`.
  - Read the date from `article:published_time`, JSON-LD or `<time>`.
  - Run the existing `looksLikePlaceholderPage` check.

### Deduplication, in four layers

1. **Email:** a unique key on `(mailbox, Message-ID)` plus the IMAP UID cursor, with `ON CONFLICT DO NOTHING`. Re-syncing never creates duplicates.
2. **URL:** a unique canonical URL. A story linked by five newsletters becomes one article with five mentions, and `mention_count` doubles as a trending signal.
3. **Content:** a sha256 hash of the normalised text. The same article at another URL (AMP, syndication) is marked `duplicate` and its mentions move to the original.
4. **Near-duplicates (Phase 4):** embedding similarity of about 0.92 or more within 14 days groups coverage of the same story from different outlets.

### Retries and errors

- **Claims:** each stage claims due rows with a conditional `UPDATE` / `SKIP LOCKED`. A claim older than 10 minutes can be taken over, the same idea as `DRAFTING_CLAIM_TTL_MS`.
- **Transient errors** (timeouts, network errors, 429 with `Retry-After` honoured, 5xx, model timeouts or quota): back off 5 min × 2^(attempts−1), capped at 12 hours. After 5 attempts the item is marked `failed`, and the admin page offers a Retry button.
- **Permanent errors** (404/410, `UnsafeUrlError`, placeholder pages, non-HTML responses, pages that are too short, paywalls): mark the item `skipped`. The story still reaches the knowledge base through its newsletter blurb.
- **Pass limits:** a lease on `intel_mailboxes` (the `claimScheduleSlot` pattern, renewed by a heartbeat) allows one pass at a time across processes. Each pass handles at most 50 emails, 40 page fetches and 40 LLM calls within an 8-minute deadline; leftover work carries over. A failure in one stage never blocks the others.
- **IMAP:** the cursor only moves forward after messages are committed. If `UIDVALIDITY` changes, the pass re-reads the last 7 days by date and the Message-ID key absorbs the repeats. The mailbox itself is never modified.
- **Visibility:** `intel_ingestion_runs` plus the mailbox's `last_error` show on the admin page. A banner appears if no email has arrived for 48 hours or three passes in a row fail. Email bodies never go into logs.
- **Load:** at most 3 page fetches at once (1 per domain) and 2 LLM calls at once. Ingestion yields while both run slots in `src/jobs/worker.ts` are busy. Once ingestion is live in production, set Terraform's `separate_worker = true` so it cannot slow page requests on the single vCPU (about $55 a month more, per `terraform/README.md`).

---

## 8. RAG: turning the knowledge base into ideas

- **Retrieval:** `retrieveIntelPassages(ctx)` runs one query per selected goal, reusing `buildRetrievalQueries`.
  - It only searches articles from the last 14 days, skips `excluded` and `duplicate` articles and muted or pending sources, and interleaves results across sources so one prolific newsletter cannot dominate.
  - Articles this identity has already used are ranked lower. Seed articles always come first.
- **Where it runs:** inside the existing `Promise.all` in `ideation-run.ts` (today `[research, passages]`), alongside web research and knowledge-base retrieval.
- **Grounding:** `buildGroundingCorpus` gets a fourth evidence list with origin `'newsletter'`. Each entry's quote is the passage itself, with the canonical URL, title, date and freshness attached. Newsletter passages are capped at about 8 per run.
- **Grading (important):** `factTypeFor` in `src/lib/ai/skills/ideation/guard.ts` must grade `'newsletter'` evidence as `sourced`, the same as web results. Otherwise third-party claims would show as "verified".
- **Prompt:** one new line telling the model to treat newsletter evidence as reporting to build a point of view on, not to restate. In seeded runs, every idea must cite at least one seed article.
- **Records:** after ideas are saved, write `idea_intel_sources`, and save the passages as `research_findings` with `provider = 'newsletter'` so Run Details shows them. The research step also records how many newsletter passages it used.
- Scheduled runs pick this up automatically, with no schedule changes.

---

## 9. Platform-specific posts (Phase 3)

- **Platform registry** (`src/lib/platforms.ts`): for each platform, the character limit, hashtag norms, link handling, thread support, preview component and which checks to skip. The LinkedIn entry is exactly today's behaviour.
- **X** is the first addition: a single post of up to 280 characters or a thread of up to 6 parts, with the link in the last part and 0–2 hashtags. Facebook and Instagram come later.
- **post-adaptation skill:** takes the master draft's current text, the idea's evidence, the voice and the platform profile. The output goes through the existing checks with the platform's limit (`runLinter` already accepts `maxChars` and `hashtagRange`). It reuses the master's image.
- **Two ways to create adaptations:**
  - Platform checkboxes in the "Create posts" dialog. The drafting queue writes the LinkedIn master, then the adaptations. The unique index on `(parent_draft_id, platform)` makes retries safe.
  - "Adapt for X" on any existing post.
- **Regenerate:**
  - The current version moves to `post_revisions`. The text is rewritten, with your optional instruction ("shorter", "more data-led"), and the new output becomes both the current text and the `original_*` fields.
  - The post goes back to `draft` and the checks re-run.
  - The instruction is saved to `feedback` so later drafts learn from it.
  - It runs inside the Server Action with a timeout below Cloud Run's request timeout, tracked in the browser the same way `posts/media-jobs.ts` tracks image generation. If it proves slower than about a minute, move it onto the drafting queue's claim pattern instead.
- **Edit and approve** stay as they are. Approving one platform's version does not approve its siblings. Nothing is published automatically.

---

## 10. UI changes

- **Sidebar:** a new Intelligence item between Goals and Ideas in `src/components/sidebar.tsx`.
- **`/intelligence`:**
  - A sync status chip and a search box, with filters for source, topic, date and "used in ideas".
  - Article cards showing the summary, topics and "in 3 newsletters". A detail drawer shows the claims, the newsletters that mentioned it and the ideas that used it.
  - Select articles, then **Generate ideas** opens the existing `GenerateRunDialog`.
- **Settings → Newsletter inbox** (admins only, in `settings-tabs.tsx`): mailbox status, Sync now, recent passes, a senders table (approve, mute, fetch links on or off), and failed items with Retry. The settings layout's description ("Your account and how you sign in.") needs a small update.
- **Ideas and Run Details:** evidence from newsletters gets a "Newsletter" badge. Source links already show.
- **Posts:** platform filter and badges, an "Adapt for…" menu, Regenerate with an optional instruction, revision history, and an X preview next to `linkedin-preview.tsx`.

---

## 11. Security

- **Credentials:** kept only in Secret Manager or env, never in the database, logs or browser. IMAP uses TLS on port 993 and opens the mailbox read-only. Use a dedicated mailbox, not someone's personal one.
- **Email is untrusted input:**
  - Email HTML is never rendered in the app; only cleaned text is shown. This prevents stored XSS.
  - Hidden text (white-on-white, `display:none`, zero-width characters) is stripped before any model sees it.
- **Prompt injection:**
  - Newsletter text only goes to skills that have no tools, wrapped as data.
  - Outputs are validated with zod, and the guard requires quotes to match the evidence.
  - Ideas need human approval before anything is drafted.
  - Newsletter text is never sent to the research agent, which does have tools.
- **Knowledge-base poisoning:** anyone can email the address, so new senders start as `pending` until an admin approves them. Content from pending or muted senders is never retrieved. Optionally, auto-approve only senders whose DKIM passes on an allow-listed domain.
- **Link safety:**
  - The SSRF check runs on every redirect hop. `safe-url.ts` already documents one gap: DNS rebinding.
  - Fetches are GET only. Unsubscribe, confirm and account links are never followed, and images and pixels are never loaded.
  - Each domain is rate-limited, and every fetch has size and time caps.
- **Links with login tokens:** some links ("view in browser", magic logins) carry tokens. Only canonical URLs are stored long-term, and raw HTML is deleted after 30 days.
- **Cron route:** `POST /api/cron/ingest` requires the bearer `CRON_SECRET` (constant-time compare) and is disabled when it is unset.
- **Who can do what:**
  - Any signed-in user can read the feed (see §15, since sign-up is open).
  - Generating ideas uses `requireIdentityId`, so it only works on your own identity.
  - Managing the mailbox and senders requires the admin role.
  - The updated `auth-guards` test covers the new actions and the cron route.
- **Cost limits:** per-pass and per-day caps on emails, fetches and LLM calls, with spend recorded on every pass.
- **Copyright:** article text stays internal and is only used for retrieval. Posts cite their sources, and the existing `copied_source_text` check also runs against newsletter evidence.
- **Retention:** raw HTML is kept for 30 days and article text for 180 days (configurable). Chunks are deleted along with their article.

---

## 12. Phased plan

Effort estimates are rough and assume one developer who knows this codebase.

### Phase 0: decisions and setup (½–1 day)

Answer the questions in §15. Create the mailbox and its app password, and subscribe to the newsletters. Collect 10–20 real `.eml` files from different senders to check the parser against.

### Phase 1: ingestion pipeline (about 5–6 days)

- Read the Next 16 docs in `node_modules/next/dist/docs/`, as `AGENTS.md` requires.
- Migration 0026, env settings and Terraform secrets.
- IMAP source, email parsing, cleaning and senders.
- Digest skill with its fallback, link handling and `scrapeArticle`.
- Deduplication layers 1–3.
- Enrichment (reusing the extraction skill) and indexing.
- `runIngestionPass` with lease, claims, backoff, caps and pass records; the scheduler tick and the cron route.
- **Done when:** real emails become indexed articles, re-running a sync creates no duplicates, and failures retry.

### Phase 2: knowledge-base UI and RAG ideas (about 4–5 days). The MVP is complete here.

- The `/intelligence` page, search, filters and sidebar item.
- The admin Newsletter inbox tab.
- Newsletter retrieval, the `'newsletter'` evidence origin and its "sourced" grading, and the prompt line.
- `idea_intel_sources` and the run step statistics.
- Seeded runs from selected articles.
- **Done when:** scheduled and manual runs produce ideas that cite newsletter articles, and the existing LinkedIn edit and approve flow works unchanged.

### Phase 3: platform-specific posts and regenerate (about 4–5 days)

- Migration 0027 and the platform registry.
- Checks per platform, the adaptation skill and the X preview.
- Platform choice in "Create posts", Adapt, Regenerate with revisions, and the platform filter.
- **Done when:** one approved idea produces LinkedIn and X drafts, each of which can be edited, regenerated and approved.

### Phase 4: hardening and quality (about 3–5 days, in any order)

- Story clustering and "trending this week".
- Hybrid search.
- The retention job, alerts and a cost dashboard.
- Enforcing DKIM.
- An OAuth / Gmail mail adapter.
- Facebook and Instagram.
- Per-identity sender filters.

---

## 13. Files to create and change

### Phase 1

**Create**

| File | Purpose |
|---|---|
| `src/db/migrations/0026_intelligence.sql` (+ `meta/` snapshot) | The `intel_*` tables (generated by drizzle-kit) |
| `src/lib/intel/settings.ts` | `INTEL_SETTINGS` caps and windows, `isIntelConfigured` |
| `src/lib/intel/mail/source.ts` | `MailSource` interface and `RawMessage` type |
| `src/lib/intel/mail/imap.ts` | imapflow adapter: read-only, UID cursor, size caps, timeouts |
| `src/lib/intel/mail/parse.ts` | mailparser wrapper: headers, html, text, List-Id, List-Unsubscribe, auth results |
| `src/lib/intel/email-content.ts` | HTML → clean text with `[n]` link markers; footer and hidden-text removal |
| `src/lib/intel/sources.ts` | Find-or-create sender by `sender_key`, status rules |
| `src/lib/intel/links.ts` | Link filtering, redirect resolution, canonical URLs |
| `src/lib/intel/article-fetch.ts` | Calls `scrapeArticle`, sorts errors into transient and permanent |
| `src/lib/intel/dedup.ts` | Text normalisation and content hash |
| `src/lib/intel/claims.ts` | Claim due rows, backoff, mark failed / skipped |
| `src/lib/intel/index-article.ts` | Chunk and embed into `intel_chunks` |
| `src/lib/ai/skills/newsletter-digest/{index,prompt,schema,guard,fallback}.ts` | Email → story items |
| `src/jobs/ingestion.ts` | `runIngestionPass` and `runIngestionPassIfDue` |
| `src/app/api/cron/ingest/route.ts` | `POST`, bearer `CRON_SECRET` |

**Change**

| File | Change |
|---|---|
| `src/db/schema.ts`, `src/db/relations.ts` | New tables, relations and inferred types |
| `src/env.ts`, `.env.example` | `INTEL_IMAP_*`, `JINA_API_KEY` |
| `terraform/main.tf`, `variables.tf`, `terraform.tfvars.example`, `README.md` | New secrets and variables |
| `package.json`, `pnpm-lock.yaml` | `imapflow`, `mailparser`, `@types/mailparser` |
| `src/lib/scraper.ts` | New `scrapeArticle()` (canonical URL, date, author, article body); Jina sends `JINA_API_KEY` when set. `scrapeUrl` unchanged |
| `src/lib/ai/embeddings.ts` | Extract a shared chunk-and-embed helper used by both knowledge documents and articles |
| `src/lib/ai.ts` | New `newsletter_digest` stage (fast model, low effort) |
| `src/jobs/scheduler.ts` | Every-minute tick calling `runIngestionPassIfDue()` |
| `tests/auth-guards.test.ts` | Accept `requireAdmin()`; exempt `api/cron/**` and check `CRON_SECRET` there instead |

### Phase 2

**Create**

| File | Purpose |
|---|---|
| `src/lib/intel/retrieval.ts` | `retrieveIntelPassages` |
| `src/lib/intel/search.ts` | Full-text search with filters and cursor pagination |
| `src/app/(app)/intelligence/{page,intelligence-client,intelligence-data,actions,loading}.tsx/.ts` | Library page |
| `src/components/intel-article-card.tsx`, `src/components/intel-article-drawer.tsx` | Card and detail drawer |
| `src/app/(app)/settings/intelligence/{page,actions,inbox-status,sources-table}.tsx/.ts` | Admin Newsletter inbox tab |

**Change**

| File | Change |
|---|---|
| `src/components/sidebar.tsx` | Intelligence nav item |
| `src/app/(app)/settings/settings-tabs.tsx`, `settings/layout.tsx` | Admin-only tab; header description |
| `src/lib/ai/pipeline/ideation-run.ts` | Third retrieval in the `Promise.all`; newsletter findings; `idea_intel_sources`; seeded runs |
| `src/lib/ai/pipeline/grounding-corpus.ts` | Fourth evidence list, origin `'newsletter'`, cap |
| `src/lib/ai/skills/ideation/guard.ts` | `'newsletter'` in the origin union; `factTypeFor` → `sourced` |
| `src/lib/ai/skills/ideation/prompt.ts` | Newsletter label, the "build a point of view" line, the seeded-run rule |
| `src/jobs/queue.ts` | `seedArticleIds` in `EnqueueRunOptions` → `researchConfig` |
| `src/app/(app)/runs/actions.ts` | `triggerNewRun` accepts `seedArticleIds` |
| `src/components/generate-run-dialog.tsx` | Accepts seed articles |
| `src/components/run-idea-card.tsx`, `src/components/idea-card.tsx` | "Newsletter" evidence badge |

### Phase 3

**Create**

| File | Purpose |
|---|---|
| `src/db/migrations/0027_post_platforms.sql` | Platform columns, `post_revisions`, `ideas.target_platforms` |
| `src/lib/platforms.ts` | Platform registry |
| `src/lib/ai/skills/post-adaptation/{index,prompt,schema,guard}.ts` | Master draft → platform draft |
| `src/components/x-preview.tsx` | X post / thread preview |

**Change**

| File | Change |
|---|---|
| `src/db/schema.ts` | `post_drafts.platform`, `parent_draft_id`, `thread_parts`; `post_revisions`; `ideas.target_platforms` |
| `src/lib/ai.ts` | `post_adaptation` stage |
| `src/lib/ai/pipeline/post-lint.ts` | Lint options from the platform profile |
| `src/lib/ai/pipeline/drafting-run.ts` | After the master draft, write the target platforms' adaptations |
| `src/lib/ai/pipeline/draft-selection.ts` | Carry `platforms` through the claim |
| `src/app/(app)/ideas/actions.ts` | `draftSelectedIdeas` accepts `platforms` |
| `src/app/(app)/posts/actions.ts` | `regenerateDraft`, `adaptDraft`; revisions on edit |
| `src/app/(app)/posts/{posts-client,posts-data}.tsx/.ts` | Platform filter and badges, Adapt menu, Regenerate, revision history |
| `src/app/(app)/posts/media-jobs.ts` (or a sibling `draft-jobs.ts`) | Browser-side tracking for regenerate |

---

## 14. Verification

Kept light by default:

- `npx tsc --noEmit`, `npm run lint` and the existing `npm test` suite after each phase. `auth-guards` must keep passing with its two updates.
- A real end-to-end check per phase against the dedicated mailbox and the saved `.eml` files: mailbox → article → run → idea → LinkedIn and X drafts. Then re-run a sync to confirm no duplicates appear.

Optional unit tests, worth adding only where a phase proves fragile:

- Email cleaning and link filtering against `.eml` files from Substack, beehiiv, Mailchimp and ConvertKit.
- Claim and lease races, in the style of `tests/drafting-claim.test.ts`.
- Newsletter evidence grading, by extending `tests/ideation-evidence.test.ts`.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Provider blocks IMAP passwords (Microsoft 365, or Workspace policy) | Choose the provider in Phase 0; the `MailSource` interface leaves room for an OAuth adapter |
| Tracking links hide unsubscribe or confirm actions, causing accidental unsubscribes | Filter by surrounding text before resolving, cut the footer, block `List-Unsubscribe` URLs, GET only |
| Paywalls, bot walls and JavaScript-only pages give thin articles | Fall back to the newsletter blurb; `fetch_links = false` per sender; optional Jina key |
| Prompt injection or a poisoned knowledge base | §11: tool-less skills, guard checks, sender approval, human approval |
| Newsletter evidence crowds out your own knowledge base and offerings | Existing interleaving, plus a cap of about 8 newsletter passages per run |
| Ingestion competes with runs on 1 vCPU | Per-pass caps, yielding while run slots are busy, `separate_worker` |
| No AI Gateway key means no embeddings | Fall back to full-text search |
| Publish dates are unreliable, so old claims look fresh | Fall back to the received date, with a hard age cap |
| Adding platforms degrades LinkedIn quality | LinkedIn path left untouched; platform defaults to `linkedin` |
| Regenerate inside a request is cut off by a closed tab | Same trade-off as image regenerate today; move to the drafting queue if needed |
| Copyright and terms of service | Internal-only storage, citations, the copy check, retention limits |
| The shared corpus is visible to every user, and sign-up is open | Confirm this is acceptable, restrict sign-up to your domain, or restrict reading to admins |

---

## 16. Missing requirements and decisions needed

The first three block Phase 1. Each has a default that will be used if there is no preference.

1. **Mail provider** for the dedicated inbox (Gmail, Google Workspace, Microsoft 365, other)? Default: Gmail or Workspace with an app password.
2. **Corpus scope:** one shared corpus for all identities, or separate inboxes per identity (for example `inbox+identity@`)? Default: shared.
3. **Platforms** besides LinkedIn, and is X a single post, a thread, or both? Default: LinkedIn and X (both); automatic publishing stays out of scope.
4. **Volume:** roughly how many newsletters a day? This sets the caps and the cost.
5. **Sender trust:** should new senders need admin approval? Default: yes.
6. **Retention** for raw emails and article text, and your legal position on storing full article text. Default: 30 days for raw email, 180 for articles.
7. **Freshness window** for newsletter evidence. Default: 14 days.
8. **Which runs use it:** every run, or only runs started from articles? Default: every run, plus seeded runs.
9. **Worker split:** turn on `separate_worker` in production when ingestion goes live? Default: yes, once the event-loop delay log shows contention.
10. **Who can read the feed:** any signed-in user, or admins only? Sign-up is currently open to any Google or LinkedIn account. Default: any signed-in user, after restricting sign-up to your domain.
11. **Languages:** English only? The writing checks are English-only.
12. **Regenerate behaviour:** keep revision history, and reset approval? Default: yes to both.
13. **Failure alerts:** in-app banner only, or email or Slack too? Default: banner only for the MVP.
