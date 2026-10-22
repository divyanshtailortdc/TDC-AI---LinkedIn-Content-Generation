-- Each chosen day of a schedule now has its own goals. A schedule that named
-- goals (goal_ids) gets them on every day it already ran; one that named none
-- keeps serving every active goal, so it has no day_goals.
ALTER TABLE "schedules" ADD COLUMN "day_goals" jsonb;--> statement-breakpoint
UPDATE "schedules" SET "day_goals" = (
  SELECT jsonb_object_agg(day::text, "schedules"."goal_ids")
  FROM jsonb_array_elements_text("schedules"."days_of_week") AS day
)
WHERE "goal_ids" IS NOT NULL AND "days_of_week" IS NOT NULL AND jsonb_array_length("days_of_week") > 0;
