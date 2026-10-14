-- Only adds the two profile columns. Columns the schema no longer declares
-- (goals, preferences, schedules) are left for the deferred cleanup migration.
-- IF NOT EXISTS: some databases got these columns from an earlier, renumbered
-- version of this migration.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "industry" text;
