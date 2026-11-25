-- Videos are recorded on the server now (src/lib/video/render); the AI-clip
-- path (Veo) is gone. A clip a model was still making can never finish, so
-- it is failed; the columns only that path used are dropped. Safe to run
-- again, and on a database that never had them.
UPDATE "post_videos" SET "status" = 'failed', "error" = 'This video was being made by a video model the app no longer uses. Record it again.', "completed_at" = now(), "updated_at" = now() WHERE "status" = 'finishing' OR ("status" = 'generating' AND "provider" <> 'recorder');--> statement-breakpoint
DROP INDEX IF EXISTS "post_videos_one_running_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_videos_one_running_uq" ON "post_videos" USING btree ("draft_id") WHERE "post_videos"."status" = 'generating';--> statement-breakpoint
ALTER TABLE "post_videos" DROP COLUMN IF EXISTS "operation";--> statement-breakpoint
ALTER TABLE "post_videos" DROP COLUMN IF EXISTS "direction";--> statement-breakpoint
ALTER TABLE "post_videos" DROP COLUMN IF EXISTS "estimated_cost_usd";--> statement-breakpoint
ALTER TABLE "post_videos" DROP COLUMN IF EXISTS "cost_usd";
