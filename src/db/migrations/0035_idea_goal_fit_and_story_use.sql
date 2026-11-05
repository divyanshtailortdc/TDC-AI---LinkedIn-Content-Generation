-- Two additive changes, written to run whether or not a database already has
-- them: they were first built locally as 0034_idea_goal_fit and
-- 0035_story_use_in_ideas, before 0034_newsletter_removed_status took 0034.
--
-- How well each idea achieves the goal it was written for (its reader, its
-- message, its action) and why, from the goal review. Ideas from before it
-- keep null.
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "goal_fit_score" integer;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "goal_fit_note" text;--> statement-breakpoint
-- Whether ideas may use a newsletter story: automatically while it is recent
-- (every story so far), kept past that, or never; set from the Knowledge
-- base's "From newsletters" view. Nothing is copied to keep or exclude one.
ALTER TABLE "intel_mentions" ADD COLUMN IF NOT EXISTS "use_in_ideas" varchar(10) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "intel_mentions" DROP CONSTRAINT IF EXISTS "intel_mentions_use_in_ideas_check";--> statement-breakpoint
ALTER TABLE "intel_mentions" ADD CONSTRAINT "intel_mentions_use_in_ideas_check" CHECK ("intel_mentions"."use_in_ideas" in ('auto', 'keep', 'never'));