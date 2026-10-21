-- An idea can serve several of the goals picked for its run; goal_id stays
-- its main goal. Additive: existing ideas list their one goal.
ALTER TABLE "ideas" ADD COLUMN "goal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "ideas" SET "goal_ids" = jsonb_build_array("goal_id"::text) WHERE "goal_id" IS NOT NULL;
