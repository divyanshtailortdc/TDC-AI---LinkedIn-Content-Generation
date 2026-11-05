-- How well each idea achieves the goal it was written for (its reader, its
-- message, its action) and why, from the goal review. Additive: ideas from
-- before it keep null. IF NOT EXISTS: an earlier local build of this change
-- (as 0031_idea_goal_fit) already added them to some development databases.
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "goal_fit_score" integer;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN IF NOT EXISTS "goal_fit_note" text;