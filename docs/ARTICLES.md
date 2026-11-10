# Articles

An approved idea can become a **post** (`post_drafts`, the existing flow) or a
**long-form article** (`articles`), or both. Each card on the Ideas page offers
**Generate Post** and **Generate Article** once the idea is approved. A drafted
idea (it already has a post) still offers Generate Article, and an idea with an
article links to it with **Open article**.

```
Ideas → approved idea → Generate Post    → drafting queue → Posts (review, publish via API)
                      → Generate Article → article claim  → /articles/[id] (review, publish by hand)
                                                            └→ Share as a link post → Posts → publish via API
```

## Data

| Table | What it holds |
| --- | --- |
| `articles` | One per idea (`idea_id` is unique). Title, subtitle, `content` (structured blocks), call to action, cover image, the model's cover suggestion and promo post, sources, quality checks, the model's original output, the version a regeneration replaced, cumulative AI `usage`, and the manual publishing record. |
| `post_drafts.article_id`, `link_url`, `link_title`, `link_description` | An **article-link post**: a post that shares a web page as a link card. Null for every other post. |

The two formats are told apart by table: `post_drafts` holds POST content and
`articles` holds ARTICLE content (`CONTENT_TYPES` in `src/lib/articles/status.ts`).
Both point at the idea they came from and at the identity (`account_id`), so every
query is scoped by identity, as posts are.

An article has two statuses:

- `generation_status` (`generating` → `ready` | `failed`) tracks the AI generation.
  `generation_started_at` is the claim token.
- `status` (`draft` | `published`) tracks publishing. It becomes `published` only
  when the reviewer marks it, because native articles are published by hand.

Generating an article never changes the idea's own status. The idea's status
belongs to the post pipeline (approved → drafting → drafted).

Migration: `0040_articles_and_link_posts` (additive, idempotent; it follows `0039_multi_platform_formats`).

## Generation

- **Claim** (`src/lib/articles/claim.ts`): `claimArticleForIdea` inserts the
  article as `generating`, and the unique `idea_id` turns a second insert into a
  no-op. It can also take over an article that failed or whose claim went stale
  (`ARTICLE_GENERATION_STALE_MS`, 8 minutes). `claimArticleRegeneration` does the
  same for an existing article. Double clicks, two tabs and retries therefore never
  start a second model call or a second article.
- **Run** (`src/lib/ai/pipeline/article-run.ts`, after the request answers via
  `after()`):
  1. `loadIdeaContext`: the same identity, voice, goals, audience, offerings,
     guardrails and review history a post gets.
  2. The knowledge-base passages closest to the idea: embeddings through the
     gateway, or keyword overlap on summaries when embeddings aren't available.
  3. One structured call (`src/lib/ai/skills/article-drafting`, stage
     `article_drafting`, schema-validated).
  4. The article checks, with one revision pass when a blocking check fails and
     time allows.
  5. `saveGeneratedArticle`, which writes only while the claim still holds and
     keeps the replaced text in `previous_version`.
- **Prompts**: they share the context blocks (`src/lib/ai/context-blocks.ts`) with
  post drafting and keep their own format rules and schema. The truth rules match
  the post's: only figures from the evidence, the knowledge passages or the author's
  details, and the source named in the sentence.
- **Checks** (`src/lib/lint/article-linter.ts`): the post's truth and writing
  detectors (unsupported figures, banned words and topics, vague attribution,
  sweeping claims, unverified experience, copied source text) plus the article's
  own checks: word count, sections, title length, duplicate headings, repeated
  paragraphs and markdown leakage. Writing-habit thresholds scale with length. The
  checks run again on every save.

## Editing

`/articles/[id]` uses a contentEditable editor (`src/components/rich-text-editor.tsx`)
with headings, subheadings, paragraphs, lists, quotes, bold, italic and links. It
offers edit and preview modes, cover image upload, link or AI generation in brand
colours (16:9), alt text, call to action, regenerate with direction, restore the
previous version, and delete.

The editor's HTML is reduced to blocks by one shared walker
(`src/lib/articles/html-blocks.ts`). The browser runs it through the DOM for
preview, copy and export, and the server runs it through cheerio on every save, so
what is stored is always safe to render.

## Publishing

Verified against LinkedIn's Posts API docs (version 2026-10):

- **Native LinkedIn articles cannot be created through the API.** The Posts API
  has no long-form article content type, and `w_member_social` only covers posts,
  comments and likes. TDC AI therefore offers no direct-publish button for
  articles. The editor's **Publish on LinkedIn** panel opens LinkedIn's article
  editor and copies the title and the formatted body; the reviewer then marks the
  article published, optionally with its link. Markdown, HTML and text downloads
  are also available.
- **Article-link posts** use the existing Posts API integration. `content.article`
  takes `source`, `title`, `description` and a `thumbnail` image URN. LinkedIn does
  not scrape the URL ("The Posts API does not support URL scraping for article post
  creation"), so the card shows exactly these fields. **Share as a link post**
  creates a `post_drafts` row with the article's promo post as its text, the link
  card fields, and a copy of the cover as its image. It goes through Posts (review,
  approve, Publish now or Schedule) like any post. The engine sends
  `content.article`, with the uploaded image as the thumbnail, only when the post
  has a `link_url`. Every other post sends exactly the request it did before.

## Cost and usage

Each generation, revision and cover image is recorded as a step on the idea's run
(`article_drafting`, or `media` with `phase: 'article_cover'`). That step carries
`contentType: 'article'`, `articleId`, model and token usage. The run's totals,
the dashboard's usage cards (an "Articles" stage) and the run's cost panel all add
it up. The article row also keeps its own cumulative `usage`, shown as "AI cost"
in the editor. The app only creates ideas inside runs, so every article has a run
to charge.

## Tests

- `tests/article-units.test.ts` (no database): block rendering and sanitising,
  conversion of model output, sources, prompts carrying identity, voice and
  knowledge, checks, link-post validation and commentary, and the `createPost`
  request body for link and plain posts.
- `tests/articles.test.ts` (needs `DATABASE_URL`; never reads `.env`): one article
  per idea under racing requests, in-place regeneration with the previous version
  kept, stale take-over and failure handling, cross-user isolation, run spend
  totals, link-post publishing through the engine, plain posts unchanged, and
  native articles not publishable. With `ARTICLE_LIVE_TEST=1` and
  `AI_GATEWAY_API_KEY` it also writes a real post and article from one idea (this
  costs AI credits).
