-- A post deleted from its platform through the app can be published again:
-- its deleted publication (status 'published', deleted_at set) stays as the
-- record, but no longer counts as the post's one live publication. The new
-- condition is weaker than the old one, so existing rows always fit it.
-- Idempotent.
DROP INDEX IF EXISTS "linkedin_publications_one_live_per_draft_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "linkedin_publications_one_live_per_draft_uq" ON "linkedin_publications" USING btree ("draft_id") WHERE status in ('scheduled', 'publishing', 'published') and deleted_at is null;
--> statement-breakpoint
-- Posts deleted from their platform before this change are unlocked the same
-- way deletePublishedPost now does it: no longer posted, and off their old
-- day, unless they went out again since. Re-running changes nothing new.
UPDATE "post_drafts" SET "posted_at" = NULL, "planned_for" = NULL, "updated_at" = now()
WHERE "posted_at" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "linkedin_publications" p WHERE p."draft_id" = "post_drafts"."id" AND p."deleted_at" IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "linkedin_publications" p WHERE p."draft_id" = "post_drafts"."id" AND p."status" IN ('publishing', 'published') AND p."deleted_at" IS NULL);
