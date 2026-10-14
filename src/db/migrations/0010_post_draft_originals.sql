-- post_drafts.original_hook / original_body keep the AI's output as generated.
-- Written to be safe to re-run: a database that already has the columns (an
-- earlier feedback-loop migration added them) is left alone, and one with
-- existing drafts gets them backfilled from the current hook and body.
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "original_hook" text;--> statement-breakpoint
ALTER TABLE "post_drafts" ADD COLUMN IF NOT EXISTS "original_body" text;--> statement-breakpoint
UPDATE "post_drafts" SET "original_hook" = "hook" WHERE "original_hook" IS NULL;--> statement-breakpoint
UPDATE "post_drafts" SET "original_body" = "body" WHERE "original_body" IS NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ALTER COLUMN "original_hook" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "post_drafts" ALTER COLUMN "original_body" SET NOT NULL;
