# Per-post AI cost

Each post shows what it cost in AI: a chip on its card in the Posts list, and an **AI cost for this post** card on its page with a breakdown by kind of work. The figures come from the usage ledger (`ai_usage`), where every model call made for a post is tagged with that post's id.

## What is counted

Every call made to write or change one post: drafting, the revision pass, image planning and checks, the image, carousel slides, the video, and every rewrite or regeneration after that. Research and ideation serve a whole run, not one post, so they are not attributed to any post. They still count on the dashboard and against the spending limits.

Posts drafted before 2026-11-20 show "No AI usage recorded". There is no backfill.

## How calls are tagged

`ai_usage.draft_id` (migration `0057_ai_usage_draft`) is set from the spend scope (`src/lib/ai/spend.ts`):

- **Work on an existing post** (post actions and routes for rewrites, images, slides and video, and the video finisher) runs in `withAiSpend({ …, draftId })`.
- **Drafting** runs a whole idea in one scope, so each post's work is wrapped in `withDraftSpend(draftId, …)`. For that to work, drafting picks each post's id **before** its first model call (`asNewPost` in `src/lib/ai/pipeline/drafting-run.ts`), and `makeCarousel` and `planPostImage` take that id rather than making their own.

`draft_id` has **no foreign key**, on purpose. Drafting records its calls before the post row exists, and a deleted post's spend must still count against the limits. Indexed by `ai_usage_draft_idx`.

## How it is shown

`loadPostsPage` (`src/app/(app)/posts/posts-data.ts`) sums the identity's rows per post and stage, filtered by `account_id` as well, since a post id says nothing about its owner. `summarizePostUsage` (`src/lib/post-usage.ts`) turns those rows into totals and stages, costliest first. The chip and card are in `src/components/post-cost.tsx`. When any row's cost was an estimate (for example a video, see [SHORT_VIDEOS.md](SHORT_VIDEOS.md#cost)), the card says "some costs are estimates".

## Deploying

Apply `0057_ai_usage_draft` **before** deploying this code. Every AI call writes `draft_id`, and the Posts page reads it, so without the column both fail. The migration is idempotent.

## Tests

`tests/post-usage.test.ts` (summing and labels), and `tests/ai-spend.test.ts` (`DATABASE_URL`; it applies 0057 itself inside its rolled-back transaction), which checks that a scoped call records its `draft_id`.
