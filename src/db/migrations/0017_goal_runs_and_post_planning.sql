-- Goals replace content pillars as what a run is about, and the Schedule page
-- plans when each post goes out. Additive only: preferences.pillars and
-- ideas.pillar keep their data but are no longer read.
ALTER TABLE "post_drafts" ADD COLUMN "planned_for" date;--> statement-breakpoint
ALTER TABLE "ideas" ADD COLUMN "goal_snapshot" jsonb;--> statement-breakpoint
CREATE INDEX "post_drafts_account_planned_idx" ON "post_drafts" USING btree ("account_id","planned_for");--> statement-breakpoint
-- Existing ideas keep their goal's message if that goal is deleted later.
UPDATE "ideas" SET "goal_snapshot" = jsonb_build_object(
  'title', "goals"."title",
  'objective', "goals"."objective",
  'keyMessage', "goals"."key_message",
  'desiredAction', "goals"."desired_action",
  'targetUrl', "goals"."target_url",
  'linkStrategy', "goals"."link_strategy"
) FROM "goals" WHERE "goals"."id" = "ideas"."goal_id" AND "ideas"."goal_snapshot" IS NULL;--> statement-breakpoint
-- Runs made with one goal list it as their only selected goal.
UPDATE "runs" SET "goal_ids" = jsonb_build_array("goal_id"::text)
WHERE "goal_id" IS NOT NULL AND ("goal_ids" IS NULL OR "goal_ids" = '[]'::jsonb);
